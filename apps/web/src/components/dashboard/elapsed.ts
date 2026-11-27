/**
 * Duraciones del panel en la unidad en que una persona las diría: horas hasta
 * los dos días, días hasta los dos meses, después meses y años.
 */

export type ElapsedUnit = 'hours' | 'days' | 'months' | 'years';

export interface Elapsed {
  unit: ElapsedUnit;
  count: number;
}

const HOURS_LIMIT = 48;
const DAYS_LIMIT = 60;
const DAYS_PER_MONTH = 30;
const MONTHS_LIMIT = 24;

export function elapsedFromDays(days: number): Elapsed {
  const whole = Math.max(0, Math.floor(days));
  if (whole < DAYS_LIMIT) return { unit: 'days', count: whole };
  const months = Math.floor(whole / DAYS_PER_MONTH);
  if (months < MONTHS_LIMIT) return { unit: 'months', count: months };
  return { unit: 'years', count: Math.floor(months / 12) };
}

export function elapsedFromHours(hours: number): Elapsed {
  const whole = Math.max(0, Math.round(hours));
  if (whole < HOURS_LIMIT) return { unit: 'hours', count: Math.max(1, whole) };
  return elapsedFromDays(whole / 24);
}
