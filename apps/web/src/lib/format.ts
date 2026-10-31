/**
 * Formatos de dinero, fechas y porcentajes: un solo lugar para toda la web.
 *
 * Fechas de solo día vs. instantes
 * --------------------------------
 * La API devuelve las fechas de solo día (vencimientos, inicio y fin de
 * contrato, períodos) como ISO a medianoche UTC: `2026-11-01T00:00:00.000Z`.
 * Mostrarlas en la zona horaria del navegador corre el día para quien está al
 * oeste de Greenwich (en Argentina saldría 31/10). Por eso `formatDate` lee el
 * día calendario en UTC. Los instantes reales (`createdAt`, `paidAt`) se
 * muestran con `formatLocalDate` / `formatDateTime`, en la zona del usuario.
 */

const DEFAULT_LOCALE = 'es-AR';

/** Locale de Intl para cada locale de la aplicación. */
const INTL_LOCALES: Record<string, string> = { es: 'es-AR', en: 'en-US' };

/** Traduce el locale de next-intl (`es`, `en`) al de Intl; acepta uno de Intl tal cual. */
export function intlLocale(locale?: string): string {
  if (!locale) return DEFAULT_LOCALE;
  return INTL_LOCALES[locale] ?? locale;
}

const EMPTY = '—';

/* ──────────── Dinero ──────────── */

export interface MoneyOptions {
  /** `auto`: de 0 a 2 decimales. Un número fija esa cantidad de decimales. */
  decimals?: 'auto' | number;
  /** Texto cuando el valor es null o undefined. Sin él, se muestra como 0. */
  placeholder?: string;
  locale?: string;
}

export function formatMoney(
  value: number | string | null | undefined,
  currency: string | null | undefined = 'ARS',
  options: MoneyOptions = {},
): string {
  const { decimals = 'auto', placeholder, locale } = options;
  if (value == null && placeholder !== undefined) return placeholder;
  const raw = typeof value === 'string' ? Number(value) : (value ?? 0);
  const amount = Number.isFinite(raw) ? raw : 0;
  const min = decimals === 'auto' ? 0 : decimals;
  const max = decimals === 'auto' ? 2 : decimals;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency: currency || 'ARS',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  }).format(amount);
}

/** Importe con centavos fijos y guion si falta: listas y detalles de comprobantes, liquidaciones y contratos. */
export function formatMoneyFixed(
  value: number | string | null | undefined,
  currency: string | null | undefined = 'ARS',
  locale?: string,
): string {
  return formatMoney(value, currency, { decimals: 2, placeholder: EMPTY, locale });
}

/** Importe redondeado al peso: tableros y resúmenes. */
export function formatMoneyRounded(
  value: number | string | null | undefined,
  currency: string | null | undefined = 'ARS',
  locale?: string,
): string {
  return formatMoney(value, currency, { decimals: 0, locale });
}

/** `$1,5M`, `$250K`: ejes y etiquetas chicas de los gráficos. */
export function formatMoneyCompact(value: number, locale?: string): string {
  const decimalSeparator = intlLocale(locale) === 'en-US' ? '.' : ',';
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace('.', decimalSeparator)}M`;
  }
  if (Math.abs(value) >= 1_000) return `$${Math.round(value / 1000)}K`;
  return `$${value}`;
}

/** Número sin símbolo, con miles y decimales del locale. */
export function formatNumber(
  value: number | string | null | undefined,
  options: { decimals?: number; locale?: string } = {},
): string {
  const raw = typeof value === 'string' ? Number(value) : value;
  if (raw == null || !Number.isFinite(raw)) return EMPTY;
  return new Intl.NumberFormat(intlLocale(options.locale), {
    minimumFractionDigits: options.decimals,
    maximumFractionDigits: options.decimals ?? 3,
  }).format(raw);
}

/** `7 %`, `7,5 %`. */
export function formatPercent(
  value: number | string | null | undefined,
  options: { decimals?: number; locale?: string } = {},
): string {
  const raw = typeof value === 'string' ? Number(value) : value;
  if (raw == null || !Number.isFinite(raw)) return EMPTY;
  const formatted = new Intl.NumberFormat(intlLocale(options.locale), {
    maximumFractionDigits: options.decimals ?? 1,
  }).format(raw);
  return `${formatted} %`;
}

/* ──────────── Fechas ──────────── */

export type DateStyle =
  | 'numeric'
  | 'medium'
  | 'mediumPadded'
  | 'long'
  | 'monthYear'
  | 'dayMonth'
  | Intl.DateTimeFormatOptions;

const DATE_STYLES: Record<Exclude<DateStyle, Intl.DateTimeFormatOptions>, Intl.DateTimeFormatOptions> = {
  /** 01/11/2026 */
  numeric: { day: '2-digit', month: '2-digit', year: 'numeric' },
  /** 1 nov 2026 */
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  /** 01 nov 2026 */
  mediumPadded: { day: '2-digit', month: 'short', year: 'numeric' },
  /** 1 de noviembre de 2026 */
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  /** nov 2026 */
  monthYear: { year: 'numeric', month: 'short' },
  /** 1 nov */
  dayMonth: { day: 'numeric', month: 'short' },
};

function dateOptions(style: DateStyle): Intl.DateTimeFormatOptions {
  return typeof style === 'string' ? DATE_STYLES[style] : style;
}

/**
 * Colapsa un valor de la API a su día calendario UTC (milisegundos a las 00:00Z).
 * Devuelve null si falta o no se puede leer.
 */
export function toUtcDay(value?: string | Date | null): number | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime())
    ? null
    : Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
}

/** Fecha de solo día (vencimiento, inicio de contrato, período): el día que dice la API, en cualquier zona horaria. */
export function formatDate(
  value?: string | Date | null,
  style: DateStyle = 'numeric',
  locale?: string,
): string {
  const day = toUtcDay(value);
  if (day === null) return EMPTY;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: 'UTC',
    ...dateOptions(style),
  }).format(new Date(day));
}

function toInstant(value?: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Un instante (`createdAt`, `paidAt`) mostrado como fecha, en la zona horaria del usuario. */
export function formatLocalDate(
  value?: string | Date | null,
  style: DateStyle = 'medium',
  locale?: string,
): string {
  const date = toInstant(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(intlLocale(locale), dateOptions(style)).format(date);
}

/** Un instante con fecha y hora, en la zona horaria del usuario. */
export function formatDateTime(
  value?: string | Date | null,
  style: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
  locale?: string,
): string {
  const date = toInstant(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(intlLocale(locale), style).format(date);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Período de facturación: `formatPeriod(2026, 8)` o `formatPeriod('2026-08-01T00:00:00Z')`
 * dan "Agosto 2026".
 */
export function formatPeriod(
  yearOrDate?: number | string | Date | null,
  month?: number,
  locale?: string,
): string {
  if (typeof yearOrDate === 'number') {
    if (month == null) return EMPTY;
    return capitalize(
      new Intl.DateTimeFormat(intlLocale(locale), {
        timeZone: 'UTC',
        month: 'long',
        year: 'numeric',
      }).format(new Date(Date.UTC(yearOrDate, month - 1, 1))),
    );
  }
  const label = formatDate(yearOrDate, { month: 'long', year: 'numeric' }, locale);
  return label === EMPTY ? label : capitalize(label);
}

/** "10 ago" */
export function formatDayMonth(value?: string | Date | null, locale?: string): string {
  return formatDate(value, 'dayMonth', locale);
}

/** "ago": la chapa del mes en una fila de factura. */
export function formatMonthShort(value?: string | Date | null, locale?: string): string {
  return formatDate(value, { month: 'short' }, locale).replace('.', '');
}

/** "26": el año bajo la chapa del mes. */
export function formatYearShort(value?: string | Date | null, locale?: string): string {
  return formatDate(value, { year: '2-digit' }, locale);
}

/** Número de comprobante con punto de venta: `0001-00000042`. */
export function formatCompNumber(pdv: number, num: number): string {
  return `${String(pdv).padStart(4, '0')}-${String(num).padStart(8, '0')}`;
}
