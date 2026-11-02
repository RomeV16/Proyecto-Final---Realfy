// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCommissionSchema } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { CommissionConfig } from './commission-config';

/**
 * DEF-30 (CP-480): la comisión del contrato se guarda y se lee con los campos de
 * la API (`type`, porcentaje como texto decimal). El formulario mandaba
 * `commissionType` y el porcentaje como número, y leía `commissionType` de la
 * respuesta: guardar devolvía 400 y una comisión guardada aparecía sin tipo.
 */
const SAVED = { id: 'cc-1', contractId: 'c-1', type: 'FixedPercent', percentage: '7.00', fixedAmount: null, adminFee: '0.00', notes: null };

const posts = () => apiClient.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  apiClient.mockReset();
  apiClient.mockImplementation(async (_path: string, init?: { method?: string; body?: string }) =>
    init?.method === 'POST' ? { ...SAVED, ...JSON.parse(init.body!) } : SAVED,
  );
});

describe('DEF-30 — comisión del contrato con los campos de la API (CP-480)', () => {
  it('muestra el tipo guardado y guarda un cuerpo que la API acepta', async () => {
    const user = userEvent.setup();
    renderEs(<CommissionConfig contractId="c-1" />);
    const type = await screen.findByLabelText(/Tipo/);
    await waitFor(() => expect(type).toHaveValue('FixedPercent'));
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    const body = posts()[0];
    expect(body).toMatchObject({ type: 'FixedPercent' });
    expect(CreateCommissionSchema.safeParse(body).success).toBe(true);
  });
});
