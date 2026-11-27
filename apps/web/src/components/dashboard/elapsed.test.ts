import { describe, expect, it } from 'vitest';
import { elapsedFromDays, elapsedFromHours } from './elapsed';

describe('elapsedFromHours', () => {
  it('deja en horas lo que no llega a dos días', () => {
    expect(elapsedFromHours(0)).toEqual({ unit: 'hours', count: 1 });
    expect(elapsedFromHours(5)).toEqual({ unit: 'hours', count: 5 });
    expect(elapsedFromHours(47)).toEqual({ unit: 'hours', count: 47 });
  });

  it('pasa a días, meses y años a medida que crece', () => {
    expect(elapsedFromHours(48)).toEqual({ unit: 'days', count: 2 });
    expect(elapsedFromHours(2520)).toEqual({ unit: 'months', count: 3 });
    expect(elapsedFromHours(24 * 800)).toEqual({ unit: 'years', count: 2 });
  });
});

describe('elapsedFromDays', () => {
  it('mantiene los días hasta los dos meses', () => {
    expect(elapsedFromDays(1)).toEqual({ unit: 'days', count: 1 });
    expect(elapsedFromDays(48)).toEqual({ unit: 'days', count: 48 });
    expect(elapsedFromDays(59)).toEqual({ unit: 'days', count: 59 });
  });

  it('redondea hacia abajo los meses y no devuelve negativos', () => {
    expect(elapsedFromDays(60)).toEqual({ unit: 'months', count: 2 });
    expect(elapsedFromDays(105)).toEqual({ unit: 'months', count: 3 });
    expect(elapsedFromDays(-4)).toEqual({ unit: 'days', count: 0 });
  });
});
