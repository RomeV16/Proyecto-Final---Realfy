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
import { PersonLessorships } from './person-lessorships';

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const person = (id: string, firstName: string) => ({ id, firstName, lastName: 'Prueba' });

const lessor = (id: string, personId: string, pct: string, extra: Record<string, unknown> = {}) => ({
  id,
  personId,
  capacity: 'Propietario',
  payoutPct: pct,
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
  needsReview: false,
  person: person(personId, personId === ME ? 'Ana' : 'Otro'),
  ...extra,
});

describe('PersonLessorships', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('lista los contratos donde la persona es locadora, con su porcentaje y enlace', async () => {
    apiClient.mockImplementation((path: string) => {
      if (path === `/contracts?personId=${ME}&limit=50`) {
        return Promise.resolve({
          items: [
            { id: 'c-1', status: 'Activo', property: { title: 'Depto de prueba' } },
            { id: 'c-2', status: 'Activo', property: { title: 'Casa de prueba' } },
          ],
        });
      }
      if (path === '/contracts/c-1/lessors') {
        return Promise.resolve([
          lessor('l-1', ME, '60.0000', { needsReview: true, payee: person(OTHER, 'Carla'), validTo: '2027-01-01T00:00:00.000Z' }),
          lessor('l-2', OTHER, '40.0000'),
        ]);
      }
      // En c-2 la persona es inquilina: no hay fila de locador suya.
      if (path === '/contracts/c-2/lessors') return Promise.resolve([lessor('l-3', OTHER, '100.0000')]);
      return Promise.resolve({});
    });
    renderEs(<PersonLessorships personId={ME} />);

    expect((await screen.findAllByRole('link', { name: 'Depto de prueba' }))[0]).toHaveAttribute('href', '/es/contracts/c-1');
    expect(screen.queryByRole('link', { name: 'Casa de prueba' })).not.toBeInTheDocument();
    expect(screen.getAllByText('60 %').length).toBeGreaterThan(0);
    expect(screen.queryByText('40 %')).not.toBeInTheDocument();
    expect(screen.getAllByText('A revisar').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Carla Prueba').length).toBeGreaterThan(0);
  });

  it('sin contratos muestra el vacío', async () => {
    apiClient.mockResolvedValue({ items: [] });
    renderEs(<PersonLessorships personId={ME} />);
    expect(await screen.findByText('No es locadora en ningún contrato')).toBeInTheDocument();
  });

  it('si la carga falla muestra el error y no el vacío', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(500, 'INTERNAL_ERROR', 'caído')));
    renderEs(<PersonLessorships personId={ME} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    expect(screen.queryByText('No es locadora en ningún contrato')).not.toBeInTheDocument();
  });
});
