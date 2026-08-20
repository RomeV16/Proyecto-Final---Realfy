import { Injectable, Logger } from '@nestjs/common';
import {
  AiPriorityItemSchema,
  type AiPriorityItem,
  type AiPriorityUrgency,
} from '@realfy/shared';
import { DailyContextService } from './daily-context.service';
import {
  toModelFacts,
  type DailyContext,
  type DailyContextFact,
  type DailyContextItem,
  type DailyContextTotals,
  type PriorityKind,
} from './daily-context';
import { LanguageModelClient, parseJsonObject } from './language-model.client';
import { rankByRules } from './priority-rules';

/** Quién decidió el orden de la lista. */
export type PrioritySource = 'model' | 'rules';

export interface DailyPriority {
  ref: string;
  kind: PriorityKind;
  entityId: string;
  title: string;
  subtitle: string | null;
  urgency: AiPriorityUrgency;
  reason: string;
  action: string;
  amount: number | null;
  currency: string | null;
  daysOverdue: number | null;
  daysToDue: number | null;
  slaHoursOverdue: number | null;
  unassigned: boolean;
  ticketPriority: string | null;
  status: string | null;
  daysSinceContact: number | null;
}

export interface DailyPrioritiesResult {
  generatedAt: string;
  /** Se expone a propósito: la interfaz tiene que poder decir de dónde salió el orden. */
  source: PrioritySource;
  /** Modelo que ordenó la lista, o `null` cuando la ordenaron las reglas. */
  model: string | null;
  /** Hay una consulta al modelo en curso: vale la pena volver a preguntar. */
  modelPending: boolean;
  totals: DailyContextTotals;
  priorities: DailyPriority[];
}

/** Cuántas prioridades se devuelven como máximo. */
const MAX_PRIORITIES = 10;

/** El contexto se recalcula seguido, pero no una vez por pintada de panel. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Largos que acepta el esquema compartido para los textos de cada entrada. */
const MAX_REASON_CHARS = 240;
const MAX_ACTION_CHARS = 160;

/**
 * Recorta los textos de una entrada a los largos acordados.
 *
 * El modelo se pasa de largo de vez en cuando y eso es cosmético: el valor de la
 * respuesta es el orden y el motivo, no el caracter 241. Recortar es preferible a
 * descartar la entrada, y lo que no sea un objeto se deja pasar tal cual para que
 * lo rechace la validación con su propio mensaje.
 */
function clampPriorityText(entry: unknown): unknown {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const { reason, action, ...rest } = entry as Record<string, unknown>;
  return {
    ...rest,
    ...(typeof reason === 'string' ? { reason: reason.trim().slice(0, MAX_REASON_CHARS) } : { reason }),
    ...(typeof action === 'string' ? { action: action.trim().slice(0, MAX_ACTION_CHARS) } : { action }),
  };
}

const SYSTEM_PROMPT = [
  'Sos el asistente de priorización de una inmobiliaria argentina.',
  'Recibís los pendientes del día ya anonimizados: cada uno llega con una referencia',
  'opaca y datos objetivos, sin ningún dato de las personas involucradas.',
  'Tu tarea es ordenarlos de más a menos urgente y explicar cada uno en una línea.',
  'Respondés únicamente con un objeto JSON, sin texto alrededor y sin bloques de código.',
].join(' ');

/** Instrucciones y hechos del día, en el formato que después valida Zod. */
function buildUserPrompt(facts: DailyContextFact[], totals: DailyContextTotals): string {
  return [
    'Pendientes del día:',
    JSON.stringify(facts),
    '',
    'Totales de la cartera:',
    JSON.stringify(totals),
    '',
    'Devolvé este JSON exacto:',
    '{"priorities":[{"ref":"C1","urgency":"alta","reason":"...","action":"..."}]}',
    '',
    'Reglas:',
    '- Usá sólo las referencias que aparecen arriba; no inventes ninguna.',
    `- Devolvé como máximo ${MAX_PRIORITIES} entradas: las más urgentes, de más a menos urgente.`,
    '- "urgency" es exactamente "alta", "media" o "baja".',
    '- "reason" explica por qué es urgente, en castellano rioplatense, hasta 240 caracteres.',
    '- "action" es el próximo paso concreto, en infinitivo, hasta 160 caracteres.',
    '- No repitas la referencia en el texto ni intentes nombrar a las personas.',
  ].join('\n');
}

/**
 * Prioridades del día.
 *
 * El panel se responde siempre con el orden por reglas propias, que no depende de
 * nadie más. Si hay un modelo de lenguaje configurado, su orden se pide en
 * segundo plano y queda en el cache para la lectura siguiente: la consulta al
 * proveedor tardaba una decena de segundos y el panel es lo primero que se abre a
 * la mañana. Las dos ramas devuelven la misma estructura, `source` dice cuál
 * ordenó y `modelPending` avisa que hay una consulta en curso.
 *
 * Si el modelo no contesta, contesta tarde, o su respuesta no cumple el esquema,
 * el panel simplemente sigue mostrando el orden por reglas.
 *
 * Lo que sale del servidor hacia el modelo pasa antes por `toModelFacts`, que
 * deja únicamente la referencia opaca y los datos objetivos de cada pendiente.
 * Los títulos y las contrapartes se reponen acá, contra el contexto local, una
 * vez que la respuesta volvió.
 */
@Injectable()
export class AiPrioritiesService {
  private readonly logger = new Logger(AiPrioritiesService.name);
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: DailyPrioritiesResult }
  >();

  /** Consultas al modelo en vuelo, por inmobiliaria. */
  private readonly enCurso = new Map<string, Promise<void>>();

  constructor(
    private readonly context: DailyContextService,
    private readonly languageModel: LanguageModelClient,
  ) {}

  /**
   * Prioridades del día, sin esperar nunca al modelo.
   *
   * El panel se responde con el orden por reglas, que sale de datos propios y
   * tarda lo que tarda una consulta. Si hay un modelo configurado, su versión se
   * pide en segundo plano y queda en el cache para la próxima lectura: pedirla en
   * línea agregaba una decena de segundos a la primera carga del día.
   */
  async getDailyPriorities(tenantId: string): Promise<DailyPrioritiesResult> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const context = await this.context.build();
    const porReglas = this.byRules(context);
    this.cache.set(tenantId, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value: porReglas,
    });

    const pendiente = this.refineWithModel(tenantId, context);
    return { ...porReglas, modelPending: pendiente };
  }

  /** Descarta lo cacheado de una inmobiliaria. */
  bust(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  /**
   * Espera la consulta al modelo que haya quedado en curso, si hay alguna.
   * El panel no la usa —justamente no espera— pero sirve para quien necesite el
   * orden del modelo de forma sincrónica, y para poder verificarlo en las pruebas
   * sin depender de temporizadores.
   */
  async awaitModelRefresh(tenantId: string): Promise<void> {
    await this.enCurso.get(tenantId);
  }

  // ─── Private ──────────────────────────────────────────

  /** Orden por reglas propias, sin salir del sistema. */
  private byRules(context: DailyContext): DailyPrioritiesResult {
    return {
      generatedAt: context.generatedAt,
      totals: context.totals,
      source: 'rules',
      model: null,
      modelPending: false,
      priorities:
        context.items.length === 0
          ? []
          : this.rehydrate(rankByRules(context.items), context.items),
    };
  }

  /**
   * Pide el orden al modelo en segundo plano y lo deja en el cache.
   * Devuelve si quedó una consulta en curso, para que la interfaz sepa que vale
   * la pena volver a preguntar.
   */
  private refineWithModel(tenantId: string, context: DailyContext): boolean {
    // Un día sin pendientes no necesita que nadie lo ordene.
    if (context.items.length === 0) return false;
    if (!this.languageModel.isEnabled) return false;
    // Varias pintadas del panel dentro de la misma ventana no tienen que
    // disparar varias consultas: se paga y se espera una sola.
    if (this.enCurso.has(tenantId)) return true;

    const tarea = this.askModel(context)
      .then((fromModel) => {
        if (!fromModel) return;
        const priorities = this.rehydrate(fromModel.priorities, context.items);
        if (priorities.length === 0) {
          this.logger.warn(
            'El modelo no devolvió ninguna referencia del contexto; queda el orden por reglas',
          );
          return;
        }
        this.cache.set(tenantId, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          value: {
            generatedAt: context.generatedAt,
            totals: context.totals,
            source: 'model',
            model: fromModel.model,
            modelPending: false,
            priorities,
          },
        });
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `La consulta al modelo en segundo plano fallo: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        this.enCurso.delete(tenantId);
      });

    this.enCurso.set(tenantId, tarea);
    return true;
  }

  private async askModel(
    context: DailyContext,
  ): Promise<{ model: string; priorities: AiPriorityItem[] } | null> {
    if (!this.languageModel.isEnabled) return null;

    const facts = toModelFacts(context.items);
    const answer = await this.languageModel.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(facts, context.totals) },
      ],
      { json: true },
    );
    if (!answer) return null;

    const payload = parseJsonObject(answer.text);
    if (payload === null) {
      this.logger.warn('La respuesta del modelo no contenía un objeto JSON');
      return null;
    }

    // Se validan las entradas de a una: el valor de la respuesta es el orden, y
    // una sola entrada mal formada —un texto más largo del acordado, una urgencia
    // escrita distinto— no justifica descartar el ranking completo y volver a las
    // reglas. Lo que no valida se cae solo, y lo que se descarta queda registrado.
    const entries = Array.isArray((payload as { priorities?: unknown }).priorities)
      ? ((payload as { priorities: unknown[] }).priorities)
      : null;
    if (!entries) {
      this.logger.warn('La respuesta del modelo no traía la lista de prioridades');
      return null;
    }

    const priorities: AiPriorityItem[] = [];
    const descartes: string[] = [];
    for (const [index, entry] of entries.entries()) {
      const parsed = AiPriorityItemSchema.safeParse(clampPriorityText(entry));
      if (parsed.success) {
        priorities.push(parsed.data);
        continue;
      }
      const issue = parsed.error.issues[0];
      descartes.push(`#${index} ${issue.path.join('.') || 'raíz'}: ${issue.message}`);
    }

    if (descartes.length > 0) {
      this.logger.warn(
        `El modelo devolvió ${descartes.length} de ${entries.length} entradas invalidas: ${descartes
          .slice(0, 3)
          .join(' | ')}`,
      );
    }

    if (priorities.length === 0) {
      this.logger.warn('Ninguna entrada de la respuesta del modelo resultó utilizable');
      return null;
    }

    return { model: answer.model, priorities };
  }

  /**
   * Repone los datos locales de cada referencia.
   * Una referencia que no salió de este contexto se descarta en silencio: el
   * orden puede venir de afuera, los datos nunca.
   */
  private rehydrate(
    entries: Array<{ ref: string; urgency: AiPriorityUrgency; reason: string; action: string }>,
    items: DailyContextItem[],
  ): DailyPriority[] {
    const byRef = new Map(items.map((item) => [item.ref, item]));
    const seen = new Set<string>();
    const priorities: DailyPriority[] = [];

    for (const entry of entries) {
      const item = byRef.get(entry.ref);
      if (!item || seen.has(entry.ref)) continue;
      seen.add(entry.ref);

      priorities.push({
        ref: item.ref,
        kind: item.kind,
        entityId: item.entityId,
        title: item.title,
        subtitle: item.subtitle,
        urgency: entry.urgency,
        reason: entry.reason,
        action: entry.action,
        amount: item.amount,
        currency: item.currency,
        daysOverdue: item.daysOverdue,
        daysToDue: item.daysToDue,
        slaHoursOverdue: item.slaHoursOverdue,
        unassigned: item.unassigned,
        ticketPriority: item.ticketPriority,
        status: item.status,
        daysSinceContact: item.daysSinceContact,
      });

      if (priorities.length === MAX_PRIORITIES) break;
    }

    return priorities;
  }
}
