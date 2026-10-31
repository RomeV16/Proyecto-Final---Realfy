import { Money, type MoneyInput } from '../money';

/**
 * Monto en letras en castellano rioplatense, para el recibo.
 *
 *   1234.50 -> "Mil doscientos treinta y cuatro pesos con cincuenta centavos"
 *   1000000 -> "Un millón de pesos"
 *
 * El importe se redondea a centavos (mitad hacia arriba) antes de convertirlo.
 * Admite hasta 999.999.999.999,99; un importe negativo o mayor es un error.
 */

const UNITS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

const CURRENCIES: Record<string, { one: string; many: string }> = {
  ARS: { one: 'peso', many: 'pesos' },
  USD: { one: 'dólar estadounidense', many: 'dólares estadounidenses' },
  EUR: { one: 'euro', many: 'euros' },
};

export class AmountInWordsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmountInWordsError';
  }
}

/** 0 a 999 en letras; el apócope convierte "uno" en "un" delante de un sustantivo. */
function below1000(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]);
  if (rest > 0) {
    if (rest < 30) {
      parts.push(rest === 1 ? 'un' : rest === 21 ? 'veintiún' : UNITS[rest]);
    } else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u === 0 ? TENS[t] : `${TENS[t]} y ${u === 1 ? 'un' : UNITS[u]}`);
    }
  }
  return parts.join(' ');
}

/** Entero no negativo (menor que 10^12) en letras, con "uno" apocopado. */
function integerToWords(n: number): string {
  if (n === 0) return 'cero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;
  const parts: string[] = [];
  if (millions > 0) {
    parts.push(millions === 1 ? 'un millón' : `${integerToWords(millions)} millones`);
  }
  if (thousands > 0) {
    parts.push(thousands === 1 ? 'mil' : `${below1000(thousands)} mil`);
  }
  if (units > 0) parts.push(below1000(units));
  return parts.join(' ');
}

export function amountInWords(amount: MoneyInput, currency: string = 'ARS'): string {
  const unit = CURRENCIES[currency];
  if (!unit) throw new AmountInWordsError(`Moneda sin texto definido: ${currency}`);

  const value = new Money(amount).toDecimalPlaces(2, Money.ROUND_HALF_UP);
  if (value.isNegative()) throw new AmountInWordsError('El monto en letras no admite importes negativos');
  if (value.gte('1000000000000')) throw new AmountInWordsError('Monto fuera de rango para el texto en letras');

  const [intPart, decPart = '00'] = value.toFixed(2).split('.');
  const whole = Number(intPart);
  const cents = Number(decPart);

  let text = '';
  if (whole > 0 || cents === 0) {
    // "un millón de pesos", "mil millones de pesos": los millones exactos llevan "de".
    const exactMillions = whole >= 1_000_000 && whole % 1_000_000 === 0;
    text = `${integerToWords(whole)}${exactMillions ? ' de' : ''} ${whole === 1 ? unit.one : unit.many}`;
  }

  if (cents > 0) {
    const centsText = `${integerToWords(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`;
    text = text ? `${text} con ${centsText}` : centsText;
  }

  return text.charAt(0).toUpperCase() + text.slice(1);
}
