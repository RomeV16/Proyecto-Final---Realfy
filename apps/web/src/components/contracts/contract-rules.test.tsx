// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { ApiRequestError } from '@/lib/api-client';
import { ContractRules } from './contract-rules';

const norm = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ');

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tv-1',
    validFrom: '2026-01-01T00:00:00.000Z',
    adjustmentType: 'IPC',
    adjustmentPeriod: 'Trimestral',
    adjustmentBase: 'Vigente',
    indexLagMonths: 2,
    fixedInitialMonths: 0,
    customPct: null,
    rentOverride: null,
    discountPct: null,
    discountAmount: null,
    dueDay: 10,
    paymentFlow: 'Partido',
    ...overrides,
  };
}

function serve(terms: unknown, agreements: unknown[] = []) {
  apiClient.mockImplementation(async (path: string) => {
    if (path === '/contracts/c-1/terms') return terms;
    if (path === '/contracts/c-1/agreements') return agreements;
    throw new Error(`inesperado: ${path}`);
  });
}

describe('ContractRules', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('muestra las reglas vigentes de hoy y la cantidad de versiones', async () => {
    const current = version();
    serve({ at: '2026-10-31T00:00:00.000Z', current, versions: [current, version({ id: 'tv-2' })] });

    renderEs(<ContractRules contractId="c-1" currency="ARS" />);

    expect(await screen.findByText('Reglas vigentes')).toBeInTheDocument();
    expect(await screen.findByText('Alquiler vigente')).toBeInTheDocument();
    const text = norm(document.body.textContent);
    expect(text).toContain('IPC');
    expect(text).toContain('Trimestral');
    expect(text).toContain('2 meses');
    expect(text).toContain('Se reparte');
    expect(text).toContain('Vigentes desde el');
    expect(text).toContain('2 versiones');
    expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/terms');
    expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/agreements');
  });

  it('muestra descuentos, alquiler acordado y porcentaje solo cuando existen', async () => {
    const current = version({
      adjustmentType: 'FixedPercent',
      customPct: '12',
      discountPct: '10',
      discountAmount: '5000',
      rentOverride: '90000',
      paymentFlow: 'TodoLocador',
      adjustmentBase: 'Original',
    });
    serve({ at: '', current, versions: [current] });

    renderEs(<ContractRules contractId="c-1" currency="ARS" />);

    await screen.findByText('Alquiler original');
    const text = norm(document.body.textContent);
    expect(text).toContain('Porcentaje fijo');
    expect(text).toContain('12 %');
    expect(text).toContain('10 %');
    expect(text).toContain('$ 5.000,00');
    expect(text).toContain('$ 90.000,00');
    expect(text).toContain('Todo el locador');
    expect(text).not.toContain('versiones');
  });

  it('lista los acuerdos con su vigencia y el documento solo si es una dirección web', async () => {
    const current = version();
    serve({ at: '', current, versions: [current] }, [
      {
        id: 'a1',
        kind: 'Rebaja',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        effectiveTo: '2026-12-01T00:00:00.000Z',
        documentUrl: 'https://ejemplo.test/acuerdo.pdf',
        notes: 'Rebaja por obras en el edificio',
      },
      {
        id: 'a2',
        kind: 'CambioReparto',
        effectiveFrom: '2026-07-01T00:00:00.000Z',
        effectiveTo: null,
        documentUrl: 'javascript:alert(1)',
        notes: null,
      },
    ]);

    renderEs(<ContractRules contractId="c-1" />);

    expect(await screen.findByText('Rebaja')).toBeInTheDocument();
    expect(screen.getByText('Cambio de reparto')).toBeInTheDocument();
    expect(screen.getByText('Rebaja por obras en el edificio')).toBeInTheDocument();
    const text = norm(document.body.textContent);
    expect(text).toContain('del 1 de jun de 2026 al 1 de dic de 2026');
    expect(text).toContain('desde el 1 de jul de 2026');
    const links = screen.getAllByRole('link', { name: 'Ver documento' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://ejemplo.test/acuerdo.pdf');
  });

  it('sin reglas ni acuerdos lo dice', async () => {
    serve({ at: '', current: null, versions: [] });
    renderEs(<ContractRules contractId="c-1" />);
    expect(await screen.findByText('El contrato todavía no tiene reglas vigentes.')).toBeInTheDocument();
    expect(screen.getByText('No hay acuerdos registrados.')).toBeInTheDocument();
  });

  it('un error de la API se muestra y no se disfraza de lista vacía', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'));
    renderEs(<ContractRules contractId="c-1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('El contrato todavía no tiene reglas vigentes.')).not.toBeInTheDocument();
    expect(screen.queryByText('No hay acuerdos registrados.')).not.toBeInTheDocument();
  });
});
