// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '@/components/index-data/test-utils';
import { elapsedParts, msSince, useElapsedText } from './elapsed';

const H = 3_600_000;
const D = 24 * H;

describe('elapsedParts', () => {
  it('elige la unidad en la que se diría la duración', () => {
    expect(elapsedParts(20_000)).toEqual({ unit: 'minutes', count: 1 });
    expect(elapsedParts(45 * 60_000)).toEqual({ unit: 'minutes', count: 45 });
    expect(elapsedParts(5 * H)).toEqual({ unit: 'hours', count: 5 });
    expect(elapsedParts(3 * D)).toEqual({ unit: 'days', count: 3 });
    expect(elapsedParts(20 * D)).toEqual({ unit: 'weeks', count: 2 });
    expect(elapsedParts(2520 * H)).toEqual({ unit: 'months', count: 3 });
    expect(elapsedParts(800 * D)).toEqual({ unit: 'years', count: 2 });
  });

  it('trata igual un plazo que falta y uno que ya pasó', () => {
    expect(elapsedParts(-3 * D)).toEqual({ unit: 'days', count: 3 });
  });
});

describe('msSince', () => {
  it('mide desde la fecha hasta el momento dado', () => {
    expect(msSince('2026-11-01T00:00:00.000Z', new Date('2026-11-03T00:00:00.000Z'))).toBe(2 * D);
  });
});

function Probe({ ms }: { ms: number }) {
  const elapsed = useElapsedText();
  return <p>{elapsed(ms)}</p>;
}

describe('useElapsedText', () => {
  it('arma el texto con el plural del idioma', () => {
    renderEs(<Probe ms={2520 * H} />);
    expect(screen.getByText('3 meses')).toBeTruthy();
  });

  it('usa el singular', () => {
    renderEs(<Probe ms={D} />);
    expect(screen.getByText('1 día')).toBeTruthy();
  });
});
