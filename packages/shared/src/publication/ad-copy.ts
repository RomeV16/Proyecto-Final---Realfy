import { PropertyOperationType, PropertyType } from '../enums';
import { MICROSITE_PORTAL_KEY } from './settings';

/**
 * Límites de referencia por portal. Son valores conservadores para que el aviso entre
 * sin recortes; se confirman con quien publica y se ajustan acá.
 */
export interface AdLimits {
  title: number;
  description: number;
  photos: number;
}

export const DEFAULT_AD_LIMITS: AdLimits = { title: 70, description: 2000, photos: 20 };

export const PORTAL_AD_LIMITS: Record<string, AdLimits> = {
  zonaprop: { title: 70, description: 4000, photos: 30 },
  argenprop: { title: 70, description: 3000, photos: 20 },
  mercadolibre: { title: 60, description: 5000, photos: 25 },
  lavoz: { title: 80, description: 2000, photos: 20 },
  [MICROSITE_PORTAL_KEY]: { title: 100, description: 5000, photos: 50 },
};

export function adLimitsFor(portal: string): AdLimits {
  return PORTAL_AD_LIMITS[portal] ?? DEFAULT_AD_LIMITS;
}

const TYPE_LABELS: Record<string, string> = {
  [PropertyType.Departamento]: 'Departamento',
  [PropertyType.Casa]: 'Casa',
  [PropertyType.PH]: 'PH',
  [PropertyType.Duplex]: 'Dúplex',
  [PropertyType.Triplex]: 'Tríplex',
  [PropertyType.Local]: 'Local comercial',
  [PropertyType.Oficina]: 'Oficina',
  [PropertyType.Consultorio]: 'Consultorio',
  [PropertyType.Galpon]: 'Galpón',
  [PropertyType.Deposito]: 'Depósito',
  [PropertyType.Terreno]: 'Terreno',
  [PropertyType.Lote]: 'Lote',
  [PropertyType.Campo]: 'Campo',
  [PropertyType.Cochera]: 'Cochera',
  Quincho: 'Quincho',
  Hotel: 'Hotel',
  Fondo_de_comercio: 'Fondo de comercio',
  Edificio: 'Edificio',
  Otro: 'Inmueble',
};

const AMENITY_LABELS: Record<string, string> = {
  Pileta: 'Pileta',
  Cochera: 'Cochera',
  Balcon: 'Balcón',
  Ascensor: 'Ascensor',
  Seguridad: 'Seguridad',
  Gimnasio: 'Gimnasio',
  SUM: 'SUM',
  Terraza: 'Terraza',
  Jardin: 'Jardín',
  Laundry: 'Lavadero',
  AC: 'Aire acondicionado',
  Calefaccion: 'Calefacción',
  Parrilla: 'Parrilla',
};

const OPERATION_LABELS: Record<string, string> = {
  [PropertyOperationType.Venta]: 'venta',
  [PropertyOperationType.Alquiler]: 'alquiler',
  [PropertyOperationType.Temporario]: 'alquiler temporario',
};

export interface AdPhotoInput {
  id: string;
  url: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface AdCopyInput {
  type: string;
  operationType: string;
  price?: number | string | null;
  currency?: string | null;
  city?: string | null;
  province?: string | null;
  street?: string | null;
  number?: string | null;
  area?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  garages?: number | null;
  age?: number | null;
  orientation?: string | null;
  amenities?: string[];
  description?: string | null;
  photos?: AdPhotoInput[];
}

export interface AdCopyOptions {
  portal: string;
  hideExactAddress: boolean;
}

export type AdCopyWarning =
  | 'title_shortened'
  | 'description_truncated'
  | 'contact_data_removed'
  | 'photos_over_limit'
  | 'no_photos'
  | 'no_price'
  | 'exact_address_shown';

export interface AdCopyResult {
  portal: string;
  operationType: string;
  title: string;
  description: string;
  limits: AdLimits;
  /** Las fotos que el portal admite, en el orden en que conviene subirlas. */
  photos: { id: string; url: string; position: number }[];
  omittedPhotos: number;
  warnings: AdCopyWarning[];
}

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL_RE = /\b(?:https?:\/\/|www\.|wa\.me\/)\S+/gi;
// Teléfonos: 7 o más dígitos, con espacios, guiones, puntos, paréntesis o prefijo.
const PHONE_RE = /\+?\d[\d\s().-]{5,}\d/g;

/** Saca de un texto libre mails, links y teléfonos: el aviso no lleva datos de contacto de terceros. */
export function stripContactData(text: string): { text: string; removed: boolean } {
  let removed = false;
  let out = text;
  for (const re of [EMAIL_RE, URL_RE, PHONE_RE]) {
    out = out.replace(re, () => {
      removed = true;
      return '';
    });
  }
  out = out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: out, removed };
}

const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });

function humanizeAmenity(key: string): string {
  return AMENITY_LABELS[key] ?? key.replaceAll('_', ' ').trim();
}

function pluralize(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Corta en el último espacio que entra en `max`, sin dejar una palabra partida. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const base = lastSpace > max * 0.5 ? slice.slice(0, lastSpace) : slice;
  return base.replace(/[\s,.;:-]+$/, '');
}

function zoneOf(input: AdCopyInput): string {
  return input.city?.trim() || input.province?.trim() || '';
}

function buildTitle(input: AdCopyInput, max: number): { title: string; shortened: boolean } {
  const type = TYPE_LABELS[input.type] ?? 'Inmueble';
  const op = OPERATION_LABELS[input.operationType] ?? 'alquiler';
  const zone = zoneOf(input);
  const rooms = input.rooms ? pluralize(input.rooms, 'ambiente', 'ambientes') : null;
  const area = input.area ? `${nf.format(input.area)} m²` : null;
  const where = zone ? ` - ${zone}` : '';
  const candidates = [
    [type, rooms, area, `en ${op}`].filter(Boolean).join(' ') + where,
    [type, rooms, `en ${op}`].filter(Boolean).join(' ') + where,
    `${type} en ${op}${where}`,
    `${type} en ${op}`,
  ];
  const fits = candidates.find((c) => c.length <= max);
  if (fits) return { title: fits, shortened: fits !== candidates[0] };
  return { title: cutAtWord(candidates[candidates.length - 1], max), shortened: true };
}

function buildFeatures(input: AdCopyInput): string[] {
  const features: string[] = [];
  if (input.rooms) features.push(pluralize(input.rooms, 'ambiente', 'ambientes'));
  if (input.bedrooms) features.push(pluralize(input.bedrooms, 'dormitorio', 'dormitorios'));
  if (input.bathrooms) features.push(pluralize(input.bathrooms, 'baño', 'baños'));
  if (input.area) features.push(`${nf.format(input.area)} m² totales`);
  if (input.garages) features.push(pluralize(input.garages, 'cochera', 'cocheras'));
  return features;
}

function locationLine(input: AdCopyInput, hideExact: boolean): string | null {
  const zone = [input.city?.trim(), input.province?.trim()].filter(Boolean).join(', ');
  if (hideExact) return zone ? `Ubicación: ${zone}.` : null;
  const street = [input.street?.trim(), input.number?.trim()].filter(Boolean).join(' ');
  const full = [street, zone].filter(Boolean).join(', ');
  return full ? `Ubicación: ${full}.` : null;
}

/** Fotos en el orden en que se suben: la portada primero, después por orden manual y, a igual orden, por id. */
export function orderPhotos(photos: AdPhotoInput[]): AdPhotoInput[] {
  return [...photos].sort(
    (a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) ||
      a.sortOrder - b.sortOrder ||
      a.id.localeCompare(b.id),
  );
}

function buildStructured(input: AdCopyInput, options: AdCopyOptions, warnings: AdCopyWarning[]): string {
  const type = TYPE_LABELS[input.type] ?? 'Inmueble';
  const op = OPERATION_LABELS[input.operationType] ?? 'alquiler';
  const zone = zoneOf(input);
  const blocks: string[] = [`${capitalize(type)} en ${op}${zone ? ` en ${zone}` : ''}.`];

  const features = buildFeatures(input);
  if (features.length > 0) blocks.push(`Características: ${features.join(', ')}.`);

  const extra: string[] = [];
  if (input.age != null) extra.push(`Antigüedad: ${pluralize(input.age, 'año', 'años')}.`);
  if (input.orientation?.trim()) extra.push(`Orientación: ${input.orientation.trim()}.`);
  if (extra.length > 0) blocks.push(extra.join(' '));

  const amenities = (input.amenities ?? []).map(humanizeAmenity).filter(Boolean);
  if (amenities.length > 0) {
    blocks.push(`Comodidades: ${amenities.sort((a, b) => a.localeCompare(b, 'es')).join(', ')}.`);
  }

  const price = input.price == null ? null : Number(input.price);
  if (price != null && Number.isFinite(price) && price > 0) {
    const perMonth = input.operationType === PropertyOperationType.Venta ? '' : ' por mes';
    blocks.push(`Precio: ${input.currency ?? 'ARS'} ${nf.format(price)}${perMonth}.`);
  } else {
    warnings.push('no_price');
  }

  const location = locationLine(input, options.hideExactAddress);
  if (location) blocks.push(location);
  if (!options.hideExactAddress && (input.street || input.number)) warnings.push('exact_address_shown');

  return blocks.join('\n');
}

function buildDescription(
  structured: string,
  freeText: string | null | undefined,
  max: number,
  warnings: AdCopyWarning[],
): string {
  let description = structured;
  if (freeText?.trim()) {
    const stripped = stripContactData(freeText);
    if (stripped.removed) warnings.push('contact_data_removed');
    const room = max - structured.length - 2;
    if (room >= 40) {
      const body = cutAtWord(stripped.text, room);
      if (body.length < stripped.text.length) warnings.push('description_truncated');
      if (body) description = `${structured}\n\n${body}`;
    } else if (stripped.text) {
      warnings.push('description_truncated');
    }
  }
  if (description.length > max) {
    description = cutAtWord(description, max);
    if (!warnings.includes('description_truncated')) warnings.push('description_truncated');
  }
  return description;
}

/**
 * Aviso para copiar y pegar en un portal, a partir de los datos estructurados de la
 * propiedad. Determinista: la misma ficha da siempre el mismo texto. No usa el título
 * interno de la ficha ni ningún dato de propietarios o inquilinos.
 */
export function buildAdCopy(input: AdCopyInput, options: AdCopyOptions): AdCopyResult {
  const limits = adLimitsFor(options.portal);
  const warnings: AdCopyWarning[] = [];

  const { title, shortened } = buildTitle(input, limits.title);
  if (shortened) warnings.push('title_shortened');

  const structured = buildStructured(input, options, warnings);
  const description = buildDescription(structured, input.description, limits.description, warnings);

  const ordered = orderPhotos(input.photos ?? []);
  if (ordered.length === 0) warnings.push('no_photos');
  const kept = ordered.slice(0, limits.photos);
  if (ordered.length > kept.length) warnings.push('photos_over_limit');

  return {
    portal: options.portal,
    operationType: input.operationType,
    title,
    description,
    limits,
    photos: kept.map((p, i) => ({ id: p.id, url: p.url, position: i + 1 })),
    omittedPhotos: ordered.length - kept.length,
    warnings,
  };
}
