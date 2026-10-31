// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';
import { ActivationProblems } from './activation-problems';

/**
 * La API manda las fechas de solo día como medianoche UTC. En Argentina
 * (UTC-3) esa medianoche cae en el día anterior, y la pantalla mostraba
 * 31 de octubre para un contrato que empieza el 1 de noviembre.
 */
describe('fechas de solo día en la zona horaria de Argentina', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
  });

  afterAll(() => {
    process.env.TZ = previousTz;
  });

  it('el contrato superpuesto muestra el día que dice la API', () => {
    // Guarda: la zona del proceso es de verdad la de Argentina.
    expect(new Date('2026-11-01T00:00:00.000Z').getDate()).toBe(31);

    renderEs(
      <ActivationProblems
        localePrefix="/es"
        problems={[
          {
            code: 'OVERLAPPING_CONTRACT',
            contractId: 'c-1',
            startDate: '2026-11-01T00:00:00.000Z',
            endDate: '2027-10-31T00:00:00.000Z',
          },
        ]}
      />,
    );

    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('1 de nov de 2026');
    expect(item).toHaveTextContent('31 de oct de 2027');
    expect(item).not.toHaveTextContent('31 de oct de 2026');
  });
});
