/**
 * Catálogo de lo que una plantilla de contrato puede usar: variables, listas
 * y bloques. Lo lee la pantalla de plantillas (para mostrarlo) y la API (para
 * validar `#cada` y para probar que el armador de variables no emite nada
 * que el catálogo no documente). Las descripciones viven en los textos de la web.
 */

/** Datos de una persona; valen para cada prefijo de persona y cada elemento de lista. */
export const TEMPLATE_PERSON_FIELDS = [
  'nombre',
  'apellido',
  'nombreCompleto',
  'documento',
  'dniConPuntos',
  'cuit',
  'telefono',
  'email',
  'domicilio',
  'estadoCivil',
  'nacionalidad',
] as const;

/** Personas de una sola ocurrencia: `inquilino.nombreCompleto` es el primer locatario. */
export const TEMPLATE_PERSON_PREFIXES = ['inquilino', 'locador', 'propietario', 'garante', 'comprador'] as const;

/** Listas que se recorren con `{{#cada}}`, con los campos de cada elemento. */
export const TEMPLATE_LISTS = {
  inquilinos: TEMPLATE_PERSON_FIELDS,
  locadores: [...TEMPLATE_PERSON_FIELDS, 'capacidad', 'porcentaje'],
  garantes: TEMPLATE_PERSON_FIELDS,
  apoderados: [...TEMPLATE_PERSON_FIELDS, 'poderdante', 'alcances', 'firma'],
} as const satisfies Record<string, readonly string[]>;

export type TemplateListName = keyof typeof TEMPLATE_LISTS;

export const TEMPLATE_LIST_NAMES = Object.keys(TEMPLATE_LISTS) as TemplateListName[];

/** Variables propias de cada elemento mientras se recorre una lista. */
export const TEMPLATE_LOOP_FIELDS = ['n', 'total', 'primero', 'ultimo'] as const;

/** Además de los campos, cada lista tiene estas variables sueltas: `garantes.cantidad`. */
export const TEMPLATE_LIST_SUMMARIES = ['cantidad', 'nombres', 'lista'] as const;

export interface TemplateVariableGroup {
  id: 'contrato' | 'propiedad' | 'garantia' | 'inmobiliaria' | 'fecha';
  variables: readonly string[];
}

export const TEMPLATE_VARIABLE_GROUPS: readonly TemplateVariableGroup[] = [
  {
    id: 'contrato',
    variables: [
      'contrato.tipo',
      'contrato.estado',
      'contrato.fechaInicio',
      'contrato.fechaFin',
      'contrato.fechaInicioLarga',
      'contrato.fechaFinLarga',
      'contrato.fechaInicioEnLetras',
      'contrato.fechaFinEnLetras',
      'contrato.fechaFirma',
      'contrato.fechaFirmaLarga',
      'contrato.fechaFirmaEnLetras',
      'contrato.monto',
      'contrato.montoEnLetras',
      'contrato.montoInicial',
      'contrato.montoInicialEnLetras',
      'contrato.moneda',
      'contrato.deposito',
      'contrato.depositoEnLetras',
      'contrato.tipoAjuste',
      'contrato.periodoAjuste',
      'contrato.notas',
    ],
  },
  {
    id: 'propiedad',
    variables: [
      'propiedad.titulo',
      'propiedad.direccion',
      'propiedad.direccionCompleta',
      'propiedad.piso',
      'propiedad.depto',
      'propiedad.ciudad',
      'propiedad.provincia',
      'propiedad.codigoPostal',
      'propiedad.tipo',
      'propiedad.superficie',
      'propiedad.ambientes',
      'propiedad.dormitorios',
      'propiedad.banos',
      'propiedad.descripcion',
      'propiedad.catastro',
      'propiedad.cuentaRentas',
      'propiedad.unidadAguas',
    ],
  },
  {
    id: 'garantia',
    variables: ['garantia.tipo', 'garantia.descripcion', 'garantia.monto', 'garantia.emisor', 'garantia.poliza'],
  },
  {
    id: 'inmobiliaria',
    variables: [
      'inmobiliaria.nombre',
      'inmobiliaria.cuit',
      'inmobiliaria.provincia',
      'inmobiliaria.matricula',
      'inmobiliaria.domicilio',
    ],
  },
  { id: 'fecha', variables: ['fecha.hoy', 'fecha.hoyLarga', 'fecha.hoyEnLetras'] },
];

/** Bloques del motor, con un ejemplo de cada uno para mostrar en la pantalla. */
export const TEMPLATE_BLOCKS = [
  { id: 'si', example: '{{#si contrato.deposito}}Deposito: {{contrato.deposito}}.{{/si}}' },
  { id: 'sino', example: '{{#si garantes.cantidad > 1}}Los garantes{{#sino}}El garante{{/si}}' },
  { id: 'cada', example: '{{#cada garantes como g}}{{g.nombreCompleto}}, DNI {{g.dniConPuntos}}.\n{{/cada}}' },
  { id: 'escape', example: '\\{{texto que queda tal cual}}' },
] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (items: readonly string[]) => items.map(escapeRe).join('|');

const KNOWN_VARIABLE = new RegExp(
  '^(?:' +
    [
      // variables sueltas
      alt(TEMPLATE_VARIABLE_GROUPS.flatMap((g) => g.variables)),
      // inquilino.nombre, garante2.cuit, locador.porcentaje
      `(?:${alt(TEMPLATE_PERSON_PREFIXES)})\\d*\\.(?:${alt([...TEMPLATE_PERSON_FIELDS, 'capacidad', 'porcentaje'])})`,
      // garantia2.tipo
      `garantia\\d+\\.(?:${alt(['tipo', 'descripcion', 'monto', 'emisor', 'poliza'])})`,
      // garantes.cantidad, locadores.lista
      `(?:${alt(TEMPLATE_LIST_NAMES)})\\.(?:${alt(TEMPLATE_LIST_SUMMARIES)})`,
      // inquilinos.2.nombreCompleto
      ...TEMPLATE_LIST_NAMES.map(
        (name) => `${name}\\.\\d+\\.(?:${alt(TEMPLATE_LISTS[name])})`,
      ),
    ].join('|') +
    ')$',
);

/** Si el nombre es una variable que el motor conoce (para probar que el catálogo no quedó atrás). */
export function isKnownTemplateVariable(name: string): boolean {
  return KNOWN_VARIABLE.test(name);
}
