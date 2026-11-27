import { describe, expect, it } from 'vitest';
import { formatDuration, formatDurationDays, formatRelativeTime } from './format';

/** Intl separa número y unidad con espacios duros o finos según la versión. */
const normalize = (text: string) => text.replace(/[  ]/g, ' ');

describe('formatDuration', () => {
  it('hasta dos días cuenta en horas', () => {
    expect(formatDuration(0.4)).toBe('menos de 1 h');
    expect(normalize(formatDuration(1))).toBe('1 h');
    expect(normalize(formatDuration(47.9))).toBe('47 h');
  });

  it('después en días, meses y años, redondeando hacia abajo', () => {
    expect(normalize(formatDuration(48))).toBe('2 días');
    expect(normalize(formatDuration(59 * 24 + 23))).toBe('59 días');
    expect(normalize(formatDuration(2520))).toBe('3 meses');
    expect(normalize(formatDuration(2452))).toBe('3 meses');
    expect(normalize(formatDuration(729 * 24))).toBe('24 meses');
    expect(normalize(formatDuration(730 * 24))).toBe('2 años');
  });

  it('un valor negativo se lee como su magnitud y sin dato da guion', () => {
    expect(normalize(formatDuration(-72))).toBe('3 días');
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });

  it('en inglés usa las unidades del idioma', () => {
    expect(formatDuration(0.2, 'en')).toBe('under 1 hr');
    expect(normalize(formatDuration(5, 'en'))).toBe('5 hr');
    expect(normalize(formatDuration(2520, 'en'))).toBe('3 months');
  });

  it('formatDurationDays parte de días', () => {
    expect(normalize(formatDurationDays(1))).toBe('24 h');
    expect(normalize(formatDurationDays(48))).toBe('48 días');
    expect(normalize(formatDurationDays(105))).toBe('3 meses');
    expect(formatDurationDays(undefined)).toBe('—');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-27T12:00:00Z');
  const at = (iso: string, locale?: string) => normalize(formatRelativeTime(iso, { now, locale }));

  it('lo reciente se dice en minutos y horas', () => {
    expect(at('2026-11-27T11:59:40Z')).toBe('ahora');
    expect(at('2026-11-27T11:55:00Z')).toBe('hace 5 minutos');
    expect(at('2026-11-27T09:00:00Z')).toBe('hace 3 horas');
  });

  it('lo viejo en días, meses y años', () => {
    expect(at('2026-11-26T10:00:00Z')).toBe('ayer');
    expect(at('2026-11-15T12:00:00Z')).toBe('hace 12 días');
    expect(at('2026-08-14T12:00:00Z')).toBe('hace 3 meses');
    expect(at('2024-10-01T12:00:00Z')).toBe('hace 2 años');
  });

  it('lo que falta va hacia adelante', () => {
    expect(at('2026-11-29T12:00:00Z')).toBe('pasado mañana');
    expect(at('2026-12-07T12:00:00Z')).toBe('dentro de 10 días');
  });

  it('acepta fechas, otro idioma y valores vacíos', () => {
    expect(normalize(formatRelativeTime(new Date('2026-11-20T12:00:00Z'), { now }))).toBe('hace 7 días');
    expect(at('2026-08-14T12:00:00Z', 'en')).toBe('3 months ago');
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime('no es fecha')).toBe('—');
    expect(formatRelativeTime(new Date())).not.toBe('—');
  });
});
