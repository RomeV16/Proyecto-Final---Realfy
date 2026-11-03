import {
  extractTemplateVariables,
  renderTemplatePlain,
  TemplateSyntaxError,
  validateTemplate,
  type TemplateLists,
} from './template-blocks';

/** El motor anterior (solo variables), copiado para comparar con él la salida de plantillas viejas. */
function legacyRender(template: string, values: Record<string, string>): string {
  const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g;
  return template.replace(regex, (full, name: string) => (name in values ? values[name] : full));
}

const VALUES: Record<string, string> = {
  'contrato.monto': '590.000,00',
  'contrato.deposito': '590.000,00',
  'contrato.sinDeposito': '0,00',
  'inquilino.nombreCompleto': 'Ana Prueba',
  'garantes.cantidad': '2',
  'inquilinos.cantidad': '1',
  vacia: '',
  'propiedad.direccion': 'Calle Ficticia 123',
};

const LISTS: TemplateLists = {
  garantes: [
    { nombreCompleto: 'Beto Uno', dniConPuntos: '10.000.001', cuit: '20-10000001-3' },
    { nombreCompleto: 'Carla Dos', dniConPuntos: '10.000.002' },
  ],
  inquilinos: [],
};

const render = (t: string, v = VALUES, l = LISTS) => renderTemplatePlain(t, v, l);

function syntaxError(fn: () => unknown): TemplateSyntaxError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TemplateSyntaxError);
    return e as TemplateSyntaxError;
  }
  throw new Error('no falló');
}

describe('renderTemplatePlain: plantillas viejas (solo variables)', () => {
  const OLD = [
    'Sin etiquetas',
    'Hola {{inquilino.nombreCompleto}}',
    'Con espacios {{ contrato.monto }} y {{  propiedad.direccion  }}',
    'Sin valor queda: {{contrato.noExiste}} y {{ otra.noExiste }}',
    'Llaves tres {{{contrato.monto}}} y {{ no es variable }} y {{}} y {{1abc}}',
    'Un valor con & < > " \' no se escapa: {{x}}',
    '{{contrato.monto}}{{contrato.monto}}\n\n  {{inquilino.nombreCompleto}}  \n',
    'Una barra suelta \\ sin llaves y {{inquilino.nombreCompleto}}',
    'Llave sola { y } y {{',
    'Dos renglones\r\n{{contrato.monto}}\r\nfin',
  ];

  it.each(OLD)('sale igual que con el motor anterior: %s', (template) => {
    const values = { ...VALUES, x: 'a & b < c' };
    expect(render(template, values)).toBe(legacyRender(template, values));
  });

  it('una variable definida como cadena vacía se reemplaza por vacío', () => {
    expect(render('[{{vacia}}]')).toBe('[]');
  });

  it('no toma propiedades heredadas como variables', () => {
    expect(render('{{constructor}} {{toString}}')).toBe('{{constructor}} {{toString}}');
  });
});

describe('renderTemplatePlain: condicionales', () => {
  it('muestra el bloque si la variable tiene valor', () => {
    expect(render('A{{#si contrato.deposito}} con depósito {{contrato.deposito}}{{/si}}.')).toBe(
      'A con depósito 590.000,00.',
    );
  });

  it('lo omite si la variable no existe, está vacía, es 0 o false', () => {
    for (const name of ['contrato.noExiste', 'vacia', 'contrato.sinDeposito']) {
      expect(render(`A{{#si ${name}}}X{{/si}}B`)).toBe('AB');
    }
    expect(render('A{{#si f}}X{{/si}}B', { f: 'false' })).toBe('AB');
    expect(render('A{{#si f}}X{{/si}}B', { f: '0' })).toBe('AB');
    expect(render('A{{#si f}}X{{/si}}B', { f: 'No' })).toBe('AXB');
  });

  it('#sino da la alternativa', () => {
    const t = '{{#si contrato.deposito}}deja{{#sino}}no deja{{/si}} depósito';
    expect(render(t)).toBe('deja depósito');
    expect(render(t, {})).toBe('no deja depósito');
  });

  it('"no" niega la condición', () => {
    expect(render('{{#si no contrato.deposito}}sin{{/si}}', {})).toBe('sin');
    expect(render('{{#si no contrato.deposito}}sin{{/si}}')).toBe('');
  });

  it('compara con números y con texto entre comillas', () => {
    expect(render('{{#si garantes.cantidad > 1}}los garantes{{#sino}}el garante{{/si}}')).toBe('los garantes');
    expect(render('{{#si garantes.cantidad >= 2}}a{{/si}}{{#si garantes.cantidad <= 1}}b{{/si}}')).toBe('a');
    expect(render('{{#si garantes.cantidad == 2}}a{{/si}}{{#si garantes.cantidad != 2}}b{{/si}}')).toBe('a');
    expect(render('{{#si garantes.cantidad < 3}}a{{/si}}')).toBe('a');
    expect(render('{{#si inquilino.nombreCompleto == "Ana Prueba"}}es Ana{{/si}}')).toBe('es Ana');
    expect(render('{{#si inquilino.nombreCompleto != "Ana Prueba"}}no{{#sino}}sí{{/si}}')).toBe('sí');
    expect(render('{{#si no garantes.cantidad > 5}}pocos{{/si}}')).toBe('pocos');
    expect(render('{{#si x == 1,5}}a{{/si}}', { x: '1.5' })).toBe('a');
  });

  it('una comparación de orden con algo que no es número da falso; una variable ausente es vacío', () => {
    expect(render('{{#si inquilino.nombreCompleto > 1}}x{{/si}}')).toBe('');
    expect(render('{{#si noExiste == "a"}}x{{/si}}')).toBe('');
    expect(render('{{#si noExiste != "a"}}x{{/si}}')).toBe('x');
  });

  it('se anidan', () => {
    const t = '{{#si a}}A{{#si b}}B{{#sino}}b{{/si}}{{#sino}}a{{/si}}';
    expect(render(t, { a: '1', b: '1' })).toBe('AB');
    expect(render(t, { a: '1' })).toBe('Ab');
    expect(render(t, {})).toBe('a');
  });
});

describe('renderTemplatePlain: listas', () => {
  it('repite el bloque por cada elemento, con el alias indicado', () => {
    expect(render('{{#cada garantes como g}}[{{g.nombreCompleto}}]{{/cada}}')).toBe('[Beto Uno][Carla Dos]');
  });

  it('sin alias usa "item"', () => {
    expect(render('{{#cada garantes}}{{item.dniConPuntos}};{{/cada}}')).toBe('10.000.001;10.000.002;');
  });

  it('da n, total, primero y último de cada elemento, para separadores', () => {
    const t = '{{#cada garantes como g}}{{g.n}}/{{g.total}}:{{g.nombreCompleto}}{{#si g.ultimo}}.{{#sino}}, {{/si}}{{/cada}}';
    expect(render(t)).toBe('1/2:Beto Uno, 2/2:Carla Dos.');
    expect(render('{{#cada garantes como g}}{{/cada}}'.replace(' as ', ' como '))).toBe('');
    expect(render('{{#cada garantes}}{{#si item.primero}}P{{/si}}{{/cada}}')).toBe('P');
  });

  it('una lista vacía no genera nada', () => {
    expect(render('A{{#cada inquilinos}}X{{/cada}}B')).toBe('AB');
  });

  it('dentro del bloque siguen valiendo las variables del contrato, y las de un campo ausente quedan como etiqueta', () => {
    expect(render('{{#cada garantes como g}}{{g.nombreCompleto}} ({{contrato.monto}}) {{g.cuit}}|{{/cada}}')).toBe(
      'Beto Uno (590.000,00) 20-10000001-3|Carla Dos (590.000,00) {{g.cuit}}|',
    );
    expect(render('{{#cada garantes como g}}{{#si g.cuit}}CUIT {{g.cuit}}{{#sino}}sin CUIT{{/si}};{{/cada}}')).toBe(
      'CUIT 20-10000001-3;sin CUIT;',
    );
  });

  it('se anidan listas y condicionales, con alias distintos', () => {
    const lists: TemplateLists = { a: [{ v: '1' }, { v: '2' }], b: [{ w: 'x' }, { w: 'y' }] };
    expect(render('{{#cada a como p}}{{#cada b como q}}{{p.v}}{{q.w}} {{/cada}}{{/cada}}', {}, lists)).toBe(
      '1x 1y 2x 2y ',
    );
  });

  it('una lista que no existe es un error', () => {
    const e = syntaxError(() => render('{{#cada fiadores}}x{{/cada}}'));
    expect(e.code).toBe('UNKNOWN_LIST');
  });

  it('con la lista de nombres válidos, la valida sin datos', () => {
    const e = syntaxError(() => validateTemplate('{{#cada fiadores}}x{{/cada}}', { lists: ['garantes'] }));
    expect(e.code).toBe('UNKNOWN_LIST');
    expect(e.message).toContain('garantes');
    expect(() => validateTemplate('{{#cada garantes}}x{{/cada}}', { lists: ['garantes'] })).not.toThrow();
  });
});

describe('renderTemplatePlain: renglones y escapes', () => {
  it('una etiqueta de bloque sola en su renglón no deja renglón vacío', () => {
    const t = 'Antes\n{{#si contrato.deposito}}\nDepósito {{contrato.deposito}}\n{{#sino}}\nSin depósito\n{{/si}}\nDespués';
    expect(render(t)).toBe('Antes\nDepósito 590.000,00\nDespués');
    expect(render(t, {})).toBe('Antes\nSin depósito\nDespués');
  });

  it('también con sangría y fin de renglón de Windows', () => {
    expect(render('A\r\n  {{#cada garantes como g}}  \r\n- {{g.nombreCompleto}}\r\n  {{/cada}}\r\nZ')).toBe(
      'A\r\n- Beto Uno\r\n- Carla Dos\r\nZ',
    );
  });

  it('en el mismo renglón que otro texto, el bloque no come saltos', () => {
    expect(render('x {{#si contrato.deposito}}y{{/si}}\nz')).toBe('x y\nz');
    expect(render('{{#si contrato.deposito}}y{{/si}} fin\nz')).toBe('y fin\nz');
  });

  it('una etiqueta de bloque al final del texto sin salto de renglón también cuenta como sola', () => {
    expect(render('A\n{{#si contrato.deposito}}\nB\n{{/si}}')).toBe('A\nB\n');
  });

  it('la barra invertida deja la etiqueta como texto', () => {
    expect(render('\\{{contrato.monto}} y {{contrato.monto}}')).toBe('{{contrato.monto}} y 590.000,00');
    expect(render('\\{{#si x}}texto\\{{/si}}')).toBe('{{#si x}}texto{{/si}}');
    expect(render('\\{{ con espacios }}')).toBe('{{ con espacios }}');
  });

  it('el texto de un valor no se interpreta como etiqueta', () => {
    expect(render('{{x}}', { x: '{{#si y}}' })).toBe('{{#si y}}');
  });

  it('el espacio dentro de las llaves es libre', () => {
    expect(render('{{ #si   contrato.deposito }}ok{{ /si }}')).toBe('ok');
  });
});

describe('renderTemplatePlain: plantilla mal formada', () => {
  const cases: Array<[string, string, string, number, number]> = [
    ['bloque sin cerrar', 'Hola\n  {{#si contrato.deposito}}texto', 'UNCLOSED_BLOCK', 2, 3],
    ['lista sin cerrar', '{{#cada garantes}}x', 'UNCLOSED_BLOCK', 1, 1],
    ['cierre sin apertura', 'texto {{/si}}', 'UNEXPECTED_CLOSE', 1, 7],
    ['cierre de otro tipo', '{{#si a}}x{{/cada}}', 'UNEXPECTED_CLOSE', 1, 11],
    ['sino suelto', '{{#sino}}', 'MISPLACED_ELSE', 1, 1],
    ['sino dentro de una lista', '{{#cada garantes}}{{#sino}}{{/cada}}', 'MISPLACED_ELSE', 1, 19],
    ['dos sino', '{{#si a}}x{{#sino}}y{{#sino}}z{{/si}}', 'DUPLICATE_ELSE', 1, 21],
    ['condición vacía', '{{#si}}x{{/si}}', 'BAD_CONDITION', 1, 1],
    ['condición con código', '{{#si a.b() > 1}}x{{/si}}', 'BAD_CONDITION', 1, 1],
    ['comparación sin literal', '{{#si a > b}}x{{/si}}', 'BAD_CONDITION', 1, 1],
    ['lista sin nombre', '{{#cada}}x{{/cada}}', 'BAD_LOOP', 1, 1],
    ['alias mal escrito', '{{#cada garantes como g h}}x{{/cada}}', 'BAD_LOOP', 1, 1],
    ['etiqueta desconocida', '{{#sis a}}x{{/sis}}', 'UNKNOWN_BLOCK', 1, 1],
    ['cierre desconocido', '{{#si a}}x{{/fin}}', 'UNKNOWN_BLOCK', 1, 11],
  ];

  it.each(cases)('%s', (_name, template, code, line, column) => {
    const e = syntaxError(() => render(template));
    expect(e.code).toBe(code);
    expect(e.line).toBe(line);
    expect(e.column).toBe(column);
    expect(e.message).toContain(`línea ${line}, columna ${column}`);
  });

  it('el error de cierre cruzado dice qué bloque estaba abierto y dónde', () => {
    const e = syntaxError(() => render('{{#cada garantes}}\n{{/si}}'));
    expect(e.message).toContain('{{#cada}}');
    expect(e.message).toContain('línea 1');
  });

  it('limita el anidamiento', () => {
    const deep = '{{#si a}}'.repeat(8) + 'x' + '{{/si}}'.repeat(8);
    expect(syntaxError(() => render(deep)).code).toBe('TOO_DEEP');
    const deepLoop = '{{#cada garantes}}'.repeat(8) + 'x' + '{{/cada}}'.repeat(8);
    expect(syntaxError(() => render(deepLoop)).code).toBe('TOO_DEEP');
    const ok = '{{#si a}}'.repeat(5) + 'x' + '{{/si}}'.repeat(5);
    expect(render(ok, { a: '1' })).toBe('x');
  });

  it('limita el tamaño del documento', () => {
    const lists: TemplateLists = { big: Array.from({ length: 1000 }, () => ({ t: 'x'.repeat(100) })) };
    const e = syntaxError(() => render('{{#cada big como b}}{{#cada big como c}}{{b.t}}{{/cada}}{{/cada}}', {}, lists));
    expect(e.code).toBe('TOO_LARGE');
  });

  it('un texto con llaves que no es del motor no es un error', () => {
    expect(render('Dice {{ esto no }} y {{x y}} y {{ }}')).toBe('Dice {{ esto no }} y {{x y}} y {{ }}');
  });
});

describe('extractTemplateVariables', () => {
  it('junta las variables del texto y de las condiciones, sin repetir', () => {
    const t = '{{a}} {{#si b.c > 1}}{{a}}{{d}}{{/si}} {{#si no e}}x{{/si}}';
    expect(extractTemplateVariables(t).sort((x, y) => x.localeCompare(y))).toEqual(['a', 'b.c', 'd', 'e']);
  });

  it('deja afuera los campos del elemento de una lista, pero no las variables del contrato', () => {
    const t = '{{#cada garantes como g}}{{g.nombreCompleto}} {{#si g.cuit}}{{contrato.monto}}{{/si}}{{/cada}}';
    expect(extractTemplateVariables(t)).toEqual(['contrato.monto']);
    expect(extractTemplateVariables('{{#cada garantes}}{{item.cuit}}{{/cada}}')).toEqual([]);
  });

  it('lanza el error de sintaxis de una plantilla mal formada', () => {
    expect(syntaxError(() => extractTemplateVariables('{{#si a}}')).code).toBe('UNCLOSED_BLOCK');
  });
});
