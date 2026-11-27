import { useCallback } from 'react';
import { useTranslations } from 'next-intl';

export type ElapsedUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Lleva una duración a la unidad en la que una persona la diría: minutos hasta la hora, horas hasta el día,
 * días hasta las dos semanas, semanas hasta los dos meses, y después meses o años. Nunca "2520 h".
 */
export function elapsedParts(ms: number): { unit: ElapsedUnit; count: number } {
  const abs = Math.abs(ms);
  if (abs < HOUR) return { unit: 'minutes', count: Math.max(1, Math.floor(abs / MINUTE)) };
  if (abs < DAY) return { unit: 'hours', count: Math.floor(abs / HOUR) };
  const days = Math.floor(abs / DAY);
  if (days < 14) return { unit: 'days', count: days };
  if (days < 60) return { unit: 'weeks', count: Math.floor(days / 7) };
  if (days < 730) return { unit: 'months', count: Math.floor(days / 30.44) };
  return { unit: 'years', count: Math.floor(days / 365.25) };
}

/** Milisegundos desde `date` hasta `now` (positivo si ya pasó). */
export function msSince(date: string | Date, now: Date = new Date()): number {
  return now.getTime() - new Date(date).getTime();
}

/** Devuelve `(ms) => "3 meses"`, con la unidad y el plural del idioma de la pantalla. */
export function useElapsedText(): (ms: number) => string {
  const t = useTranslations('tickets.elapsed');
  return useCallback(
    (ms: number) => {
      const { unit, count } = elapsedParts(ms);
      return t(unit, { count });
    },
    [t],
  );
}
