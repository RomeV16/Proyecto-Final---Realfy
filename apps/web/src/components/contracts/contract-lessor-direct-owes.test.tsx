// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { ApiRequestError } from '@/lib/api-client';
import { ContractLessorDirectOwes } from './contract-lessor-direct-owes';
import { ContractRules } from './contract-rules';

function serve(opts: { defaults?: unknown; write?: () => unknown } = {}) {
  apiClient.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method) return opts.write ? opts.write() : {};
    if (path === '/tenants/me/operational-defaults') {
      if (opts.defaults === null) throw new ApiRequestError(403, 'FORBIDDEN', 'no');
      return opts.defaults ?? { cash: { lessorDirectOwes: 'TodoLoAjeno' } };
    }
    if (path === '/tenants/me/penalty-config') throw new ApiRequestError(403, 'FORBIDDEN', 'no');
    if (path === '/contracts/c-1/terms') {
      const current = { id: 'v', validFrom: '2026-01-01T00:00:00.000Z', adjustmentType: 'IPC', adjustmentPeriod: 'Anual', adjustmentBase: 'Vigente', indexLagMonths: 2, fixedInitialMonths: 0, customPct: null, rentOverride: null, discountPct: null, discountAmount: null, dueDay: 10, paymentFlow: 'TodoLocador', lessorDirectOwes: 'SoloInmobiliaria' };
      return { at: '2026-11-01T00:00:00.000Z', current, versions: [current] };
    }
    if (path === '/contracts/c-1/agreements') return [];
    throw new Error(`inesperado: ${path}`);
  });
}

const writes = () => apiClient.mock.calls.filter(([, init]) => init?.method);

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
});

describe('Lo que debe el locador que cobra directamente, por contrato (CP-477)', () => {
  it('sin pacto muestra el de la inmobiliaria; pactado, el del contrato', async () => {
    serve();
    renderEs(<ContractLessorDirectOwes contractId="c-1" own={null} onChanged={vi.fn()} />);
    expect(await screen.findByText('Todo lo que no es suyo (comisión, inmobiliaria y entes)')).toBeInTheDocument();
    expect(screen.getByText('Valor de la inmobiliaria')).toBeInTheDocument();

    serve({ defaults: null });
    renderEs(<ContractLessorDirectOwes contractId="c-1" own="SoloInmobiliaria" onChanged={vi.fn()} />);
    expect(await screen.findByText('Solo comisión e inmobiliaria (los entes los paga él)')).toBeInTheDocument();
    expect(screen.getByText('Pactado en el contrato')).toBeInTheDocument();
  });

  it('sin poder leer los valores de la inmobiliaria y sin pacto no inventa uno', async () => {
    serve({ defaults: null });
    renderEs(<ContractLessorDirectOwes contractId="c-1" own={null} onChanged={vi.fn()} />);
    expect(await screen.findByText('El de la inmobiliaria')).toBeInTheDocument();
  });

  it('se cambia desde una fecha con un acuerdo de cambio de reglas; vacío vuelve al de la inmobiliaria', async () => {
    serve({ write: () => ({ id: 'a-1' }) });
    const onChanged = vi.fn();
    const user = userEvent.setup();
    renderEs(<ContractLessorDirectOwes contractId="c-1" own={null} onChanged={onChanged} />);
    await user.click(await screen.findByRole('button', { name: 'Cambiar' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/Desde/));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(within(dialog).getByText('Ingresá una fecha válida.')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Desde/), '2026-12-01');
    await user.selectOptions(within(dialog).getByLabelText(/Si el inquilino le paga al locador/), 'SoloInmobiliaria');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][0]).toBe('/contracts/c-1/agreements');
    expect(JSON.parse(writes()[0][1].body)).toEqual({
      kind: 'CambioRegla',
      effectiveFrom: '2026-12-01T00:00:00.000Z',
      termsPatch: { lessorDirectOwes: 'SoloInmobiliaria' },
    });
    expect(onChanged).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Regla actualizada.');

    await user.click(screen.getByRole('button', { name: 'Cambiar' }));
    const again = await screen.findByRole('dialog');
    await user.selectOptions(within(again).getByLabelText(/Si el inquilino le paga al locador/), '');
    await user.click(within(again).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(writes()[1][1].body).termsPatch).toEqual({ lessorDirectOwes: null });
  });

  it('un error de la API se muestra y se puede cancelar', async () => {
    serve({
      write: () => {
        throw new ApiRequestError(400, 'VALIDATION_ERROR', 'Patch inválido');
      },
    });
    const user = userEvent.setup();
    renderEs(<ContractLessorDirectOwes contractId="c-1" own={null} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Cambiar' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect((await within(dialog).findAllByRole('alert')).length).toBeGreaterThan(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('quien no gestiona contratos no lo cambia', async () => {
    auth.role = 'Liquidaciones';
    serve();
    renderEs(<ContractLessorDirectOwes contractId="c-1" own={null} onChanged={vi.fn()} />);
    await screen.findByText('Valor de la inmobiliaria');
    expect(screen.queryByRole('button', { name: 'Cambiar' })).not.toBeInTheDocument();
  });

  it('las reglas del contrato lo muestran', async () => {
    serve();
    renderEs(<ContractRules contractId="c-1" currency="ARS" />);
    expect(await screen.findByText('Solo comisión e inmobiliaria (los entes los paga él)')).toBeInTheDocument();
  });
});
