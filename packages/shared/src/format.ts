/** Campos de dirección de una propiedad que se usan para armar su etiqueta. */
export interface PropertyLabelInput {
  title?: string | null;
  street?: string | null;
  number?: string | null;
  floor?: string | null;
  apartment?: string | null;
}

/** Nombre y apellido de una persona. */
export interface PersonNameInput {
  firstName?: string | null;
  lastName?: string | null;
}

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * Etiqueta legible de una propiedad: el título si lo tiene; si no, calle y
 * número, y la unidad (piso y departamento) separada por coma. Devuelve ''
 * cuando no hay ningún dato, para que cada pantalla elija su texto vacío.
 */
export function propertyLabel(property: PropertyLabelInput | null | undefined): string {
  if (!property) return '';
  const title = clean(property.title);
  if (title) return title;

  const street = [clean(property.street), clean(property.number)].filter(Boolean).join(' ');
  const floor = clean(property.floor);
  const unit = [floor ? `piso ${floor}` : '', clean(property.apartment)].filter(Boolean).join(' ');
  return [street, unit].filter(Boolean).join(', ');
}

/** Importes aceptados: número, texto o un Decimal de Prisma. */
export type MoneyLike = string | number | { toString(): string };

/**
 * Importe con separador de miles y dos decimales al estilo argentino
 * ("1.234,50"). Solo da formato: no aplica reglas de redondeo de negocio.
 */
export function formatMoneyAR(amount: MoneyLike): string {
  return Number(String(amount)).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Período como "marzo de 2025". Los períodos se guardan como fecha sin hora
 * (medianoche UTC), así que se lee en UTC para que el mes no retroceda.
 */
export function formatPeriodAR(period: Date | string): string {
  return new Date(period).toLocaleDateString('es-AR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Período como "03/2025" (mes y año en UTC). */
export function formatPeriodShortAR(period: Date | string): string {
  const date = new Date(period);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

/** "Nombre Apellido"; '' si la persona no tiene ninguno de los dos. */
export function personName(person: PersonNameInput | null | undefined): string {
  if (!person) return '';
  return [clean(person.firstName), clean(person.lastName)].filter(Boolean).join(' ');
}

/** Número de recibo con ceros a la izquierda: 42 -> "00000042". */
export function formatReceiptNumber(seq: number): string {
  return String(seq).padStart(8, '0');
}
