/**
 * Motor de plantillas de texto plano (contratos): variables, condicionales y listas.
 *
 *   {{variable}}                      valor de una variable; sin valor queda tal cual
 *   {{#si cond}}…{{#sino}}…{{/si}}    condicional (el bloque `#sino` es opcional)
 *   {{#cada lista [como alias]}}…{{/cada}}   repite el bloque por cada elemento de una lista
 *   \{{texto}}                        la barra invertida saca la etiqueta del motor: sale `{{texto}}`
 *
 * No evalúa código: una condición es una variable, una variable negada con `no`,
 * o una comparación de una variable contra un número o un texto entre comillas.
 * Una etiqueta de bloque sola en su renglón no deja renglón vacío.
 */

export class TemplateSyntaxError extends Error {
  constructor(
    readonly code: TemplateSyntaxCode,
    message: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${message} (línea ${line}, columna ${column})`);
    this.name = 'TemplateSyntaxError';
  }
}

export type TemplateSyntaxCode =
  | 'UNKNOWN_BLOCK'
  | 'BAD_CONDITION'
  | 'BAD_LOOP'
  | 'UNCLOSED_BLOCK'
  | 'UNEXPECTED_CLOSE'
  | 'MISPLACED_ELSE'
  | 'DUPLICATE_ELSE'
  | 'UNKNOWN_LIST'
  | 'TOO_DEEP'
  | 'TOO_LARGE';

export type TemplateListItem = Record<string, string>;
export type TemplateLists = Record<string, TemplateListItem[]>;

export interface TemplateOptions {
  /** Nombres de listas válidos; con ellos, `#cada` sobre otro nombre es un error. */
  lists?: readonly string[];
}

const MAX_DEPTH = 6;
const MAX_OUTPUT = 2_000_000;
const NAME = '[a-zA-Z_][a-zA-Z0-9_.]*';
const TAG = /(\\?)\{\{([^{}]{0,300})\}\}/g;
const VARIABLE = new RegExp(`^\\s*(${NAME})\\s*$`);
const CONDITION = new RegExp(
  `^(no\\s+)?(${NAME})(?:\\s*(==|!=|>=|<=|>|<)\\s*("[^"]*"|-?\\d+(?:[.,]\\d+)?))?$`,
);
const LOOP = /^([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+como\s+([a-zA-Z_][a-zA-Z0-9_]*))?$/;
const NUMBER = /^-?\d+(?:[.,]\d+)?$/;
const ZERO = /^-?0+(?:[.,]0+)?$/;

type Operator = '==' | '!=' | '>=' | '<=' | '>' | '<';

interface Condition {
  negate: boolean;
  name: string;
  op?: Operator;
  literal?: string;
}

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string; raw: string }
  | { kind: 'if'; cond: Condition; then: Node[]; otherwise: Node[]; at: number }
  | { kind: 'each'; list: string; alias: string; body: Node[]; at: number };

interface Frame {
  kind: 'root' | 'si' | 'cada';
  nodes: Node[];
  node?: Extract<Node, { kind: 'if' | 'each' }>;
  inElse?: boolean;
  at: number;
}

function position(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  return { line, column: index - before.lastIndexOf('\n') };
}

function fail(source: string, index: number, code: TemplateSyntaxCode, message: string): never {
  const { line, column } = position(source, index);
  throw new TemplateSyntaxError(code, message, line, column);
}

function parseCondition(source: string, at: number, expr: string): Condition {
  const m = CONDITION.exec(expr.trim());
  if (!m) {
    fail(source, at, 'BAD_CONDITION', `Condición no válida en {{#si ${expr.trim()}}}: se espera una variable, "no variable" o una comparación como variable > 1`);
  }
  const [, no, name, op, literal] = m;
  return { negate: Boolean(no), name, op: op as Operator | undefined, literal };
}

/** Etiqueta de bloque sola en su renglón: devuelve dónde sigue el texto después de ella. */
function standaloneEnd(source: string, from: number, start: number, end: number): number | null {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  if (lineStart < from || source.slice(lineStart, start).trim() !== '') return null;
  const after = /^[ \t]*(\r?\n|$)/.exec(source.slice(end));
  return after ? end + after[0].length : null;
}

function parse(source: string, options: TemplateOptions): Node[] {
  const root: Frame = { kind: 'root', nodes: [], at: 0 };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1];
  const target = (): Node[] => {
    const f = top();
    if (f.kind === 'si') return f.inElse ? (f.node as Extract<Node, { kind: 'if' }>).otherwise : (f.node as Extract<Node, { kind: 'if' }>).then;
    if (f.kind === 'cada') return (f.node as Extract<Node, { kind: 'each' }>).body;
    return f.nodes;
  };
  const pushText = (text: string) => {
    if (text) target().push({ kind: 'text', text });
  };

  let pos = 0;
  for (const m of source.matchAll(TAG)) {
    const start = m.index;
    const end = start + m[0].length;
    const inner = m[2].trim();
    const raw = m[0].slice(m[1].length);

    if (m[1]) {
      // Etiqueta escapada: sale literal, sin la barra.
      pushText(source.slice(pos, start) + raw);
      pos = end;
      continue;
    }

    if (VARIABLE.test(inner)) {
      pushText(source.slice(pos, start));
      target().push({ kind: 'var', name: inner, raw });
      pos = end;
      continue;
    }

    if (!inner.startsWith('#') && !inner.startsWith('/')) continue; // texto que no es del motor: queda igual

    let tagEnd = end;
    let textEnd = start;
    const alone = standaloneEnd(source, pos, start, end);
    if (alone !== null) {
      textEnd = source.lastIndexOf('\n', start - 1) + 1;
      tagEnd = alone;
    }
    pushText(source.slice(pos, textEnd));
    pos = tagEnd;

    const word = /^[#/]\s*(\S*)\s*(.*)$/s.exec(inner) as RegExpExecArray;
    const tag = inner[0] + word[1];
    const arg = word[2];

    if (tag === '#si') {
      if (stack.length > MAX_DEPTH) fail(source, start, 'TOO_DEEP', `Los bloques están anidados a más de ${MAX_DEPTH} niveles`);
      const node = { kind: 'if' as const, cond: parseCondition(source, start, arg), then: [], otherwise: [], at: start };
      target().push(node);
      stack.push({ kind: 'si', nodes: [], node, at: start });
    } else if (tag === '#cada') {
      if (stack.length > MAX_DEPTH) fail(source, start, 'TOO_DEEP', `Los bloques están anidados a más de ${MAX_DEPTH} niveles`);
      const loop = LOOP.exec(arg.trim());
      if (!loop) fail(source, start, 'BAD_LOOP', `Repetición no válida en {{#cada ${arg.trim()}}}: se espera {{#cada lista}} o {{#cada lista como alias}}`);
      if (options.lists && !options.lists.includes(loop[1])) {
        fail(source, start, 'UNKNOWN_LIST', `La lista "${loop[1]}" no existe; las listas son: ${options.lists.join(', ')}`);
      }
      const node = { kind: 'each' as const, list: loop[1], alias: loop[2] ?? 'item', body: [], at: start };
      target().push(node);
      stack.push({ kind: 'cada', nodes: [], node, at: start });
    } else if (tag === '#sino') {
      const f = top();
      if (f.kind !== 'si') fail(source, start, 'MISPLACED_ELSE', '{{#sino}} solo va dentro de un bloque {{#si}}');
      if (f.inElse) fail(source, start, 'DUPLICATE_ELSE', 'El bloque {{#si}} ya tiene un {{#sino}}');
      f.inElse = true;
    } else if (tag === '/si' || tag === '/cada') {
      const f = top();
      const expected = tag === '/si' ? 'si' : 'cada';
      if (f.kind === 'root') fail(source, start, 'UNEXPECTED_CLOSE', `{{${tag}}} no tiene un bloque abierto`);
      if (f.kind !== expected) {
        fail(source, start, 'UNEXPECTED_CLOSE', `{{${tag}}} cierra un bloque {{#${expected}}}, pero el abierto es {{#${f.kind}}} (línea ${position(source, f.at).line})`);
      }
      stack.pop();
    } else {
      fail(source, start, 'UNKNOWN_BLOCK', `Etiqueta no reconocida {{${inner}}}; las de bloque son #si, #sino, /si, #cada y /cada`);
    }
  }
  pushText(source.slice(pos));

  if (stack.length > 1) {
    const f = top();
    fail(source, f.at, 'UNCLOSED_BLOCK', `El bloque {{#${f.kind}}} no se cierra con {{/${f.kind}}}`);
  }
  return root.nodes;
}

// ─── Evaluación ─────────────────────────────────────────

interface Scope {
  values: Record<string, string>;
  lists: TemplateLists;
  items: Map<string, TemplateListItem>;
}

function lookup(scope: Scope, name: string): string | undefined {
  const dot = name.indexOf('.');
  if (dot > 0) {
    const item = scope.items.get(name.slice(0, dot));
    const field = item?.[name.slice(dot + 1)];
    if (field !== undefined) return field;
  }
  return Object.hasOwn(scope.values, name) ? scope.values[name] : undefined;
}

/** Falso: sin valor, vacío, "0", "false" o un cero con decimales ("0,00"). */
function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim();
  return v !== '' && v.toLowerCase() !== 'false' && !ZERO.test(v);
}

function toNumber(text: string): number {
  return Number(text.replace(',', '.'));
}

function compare(value: string | undefined, op: Operator, literal: string): boolean {
  const left = (value ?? '').trim();
  const quoted = literal.startsWith('"');
  const right = quoted ? literal.slice(1, -1) : literal;
  if (!quoted && NUMBER.test(left)) {
    const a = toNumber(left);
    const b = toNumber(right);
    return { '==': a === b, '!=': a !== b, '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b }[op];
  }
  if (op === '==') return left === right;
  if (op === '!=') return left !== right;
  return false;
}

function evaluate(cond: Condition, scope: Scope): boolean {
  const value = lookup(scope, cond.name);
  const result = cond.op ? compare(value, cond.op, cond.literal as string) : truthy(value);
  return cond.negate ? !result : result;
}

function render(nodes: Node[], scope: Scope, source: string, budget: { left: number }): string {
  let out = '';
  for (const node of nodes) {
    let piece = '';
    if (node.kind === 'text') piece = node.text;
    else if (node.kind === 'var') piece = lookup(scope, node.name) ?? node.raw;
    else if (node.kind === 'if') piece = render(evaluate(node.cond, scope) ? node.then : node.otherwise, scope, source, budget);
    else {
      const list = Object.hasOwn(scope.lists, node.list) ? scope.lists[node.list] : undefined;
      if (!list) fail(source, node.at, 'UNKNOWN_LIST', `La lista "${node.list}" no existe`);
      const parts = list.map((entry, i) => {
        const item: TemplateListItem = {
          ...entry,
          n: String(i + 1),
          total: String(list.length),
          primero: i === 0 ? '1' : '0',
          ultimo: i === list.length - 1 ? '1' : '0',
        };
        const items = new Map(scope.items).set(node.alias, item);
        return render(node.body, { ...scope, items }, source, budget);
      });
      piece = parts.join('');
    }
    budget.left -= piece.length;
    if (budget.left < 0) fail(source, 0, 'TOO_LARGE', 'El documento generado supera el tamaño máximo permitido');
    out += piece;
  }
  return out;
}

// ─── API ────────────────────────────────────────────────

/**
 * Renderiza una plantilla de texto plano (sin escapar HTML). Una variable sin
 * valor queda como está (`{{x}}`) para verla en la vista previa. Una plantilla
 * mal formada lanza `TemplateSyntaxError` con la línea y la columna.
 */
export function renderTemplatePlain(
  template: string,
  values: Record<string, string>,
  lists: TemplateLists = {},
  options: TemplateOptions = {},
): string {
  if (!template.includes('{{')) return template;
  const nodes = parse(template, options);
  return render(nodes, { values, lists, items: new Map() }, template, { left: MAX_OUTPUT });
}

/** Revisa la sintaxis de una plantilla sin datos; lanza `TemplateSyntaxError` si está mal formada. */
export function validateTemplate(template: string, options: TemplateOptions = {}): void {
  parse(template, options);
}

/**
 * Variables que usa una plantilla (en texto y en condiciones), sin las de un
 * elemento de lista (`alias.campo`) y sin repetir. Lanza `TemplateSyntaxError`
 * si la plantilla está mal formada.
 */
export function extractTemplateVariables(template: string, options: TemplateOptions = {}): string[] {
  const names = new Set<string>();
  const visit = (nodes: Node[], aliases: readonly string[]) => {
    const add = (name: string) => {
      if (!aliases.includes(name.split('.')[0])) names.add(name);
    };
    for (const node of nodes) {
      if (node.kind === 'var') add(node.name);
      else if (node.kind === 'if') {
        add(node.cond.name);
        visit(node.then, aliases);
        visit(node.otherwise, aliases);
      } else if (node.kind === 'each') visit(node.body, [...aliases, node.alias]);
    }
  };
  visit(parse(template, options), []);
  return Array.from(names);
}
