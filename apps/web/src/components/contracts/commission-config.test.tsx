// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));

import { CommissionConfig } from './commission-config';

const EXISTING = {
  id: 'cc-1',
  contractId: 'c-1',
  type: 'FixedPercent',
  percentage: '7.00',
  fixedAmount: null,
  adminFee: '0',
  repairMgmtFeePct: '10.00',
  notes: null,
};

function serve(existing: unknown) {
  apiClient.mockImplementation(async (_path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'POST') return { ...EXISTING, ...JSON.parse(init.body!) };
    if (init?.method === 'DELETE') return { deleted: true };
    return existing;
  });
}

const lastPost = () => JSON.parse(apiClient.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)![1].body);

beforeEach(() => apiClient.mockReset());

describe('CommissionConfig — honorario por gestión de reparaciones (CP-479)', () => {
  it('muestra el porcentaje guardado y lo envía al guardar', async () => {
    serve(EXISTING);
    const user = userEvent.setup();
    renderEs(<CommissionConfig contractId="c-1" />);
    const fee = await screen.findByLabelText('Honorario por gestión de reparaciones (%)');
    expect(fee).toHaveValue(10);
    expect(screen.getByText(/Se descuenta al locador sobre cada reparación/)).toBeInTheDocument();
    await user.clear(fee);
    await user.type(fee, '12.5');
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(lastPost()).toMatchObject({ repairMgmtFeePct: '12.5' }));
  });

  // Sin comisión configurada la API devuelve null.
  it('vacío no cobra honorario (envía null)', async () => {
    serve(null);
    const user = userEvent.setup();
    renderEs(<CommissionConfig contractId="c-1" />);
    const fee = await screen.findByLabelText('Honorario por gestión de reparaciones (%)');
    expect(fee).toHaveValue(null);
    await user.selectOptions(screen.getByLabelText(/Tipo/), 'FixedPercent');
    await user.type(screen.getByLabelText(/Porcentaje/), '7');
    await user.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(lastPost()).toMatchObject({ repairMgmtFeePct: null }));
  });

  it('al borrar la comisión se limpia el honorario', async () => {
    serve(EXISTING);
    const user = userEvent.setup();
    renderEs(<CommissionConfig contractId="c-1" />);
    const fee = await screen.findByLabelText('Honorario por gestión de reparaciones (%)');
    await user.click(screen.getByRole('button', { name: /Eliminar/ }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(fee).toHaveValue(null));
  });
});
