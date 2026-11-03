// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_OPERATIONAL_DEFAULTS, type OperationalDefaults } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', role: 'Admin' } }),
  useOptionalAuth: () => ({ user: { id: 'me', role: 'Admin' } }),
}));

import { OperationalDefaultsManager } from './operational-defaults-form';

const PENALTY_RULE = { mode: 'daily_percent', value: '0.001', graceDays: 5, maxMultiplier: '2.0' };

/** Convenciones que la inmobiliaria cambió y que el formulario no edita. */
const SAVED: OperationalDefaults = {
  ...DEFAULT_OPERATIONAL_DEFAULTS,
  deposits: { defaultHeldBy: 'Inmobiliaria', refundDueDays: 45, deductionsNeedLessorApproval: true },
};

describe('DEF-80: guardar los valores por defecto no pisa lo que el formulario no edita', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('penalty-config')) return PENALTY_RULE;
      return init?.method === 'PUT' ? JSON.parse(init.body as string) : SAVED;
    });
  });

  it('CP-725: el cuerpo que se guarda conserva las convenciones de depósitos', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '5');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).deposits).toEqual(SAVED.deposits);
  });
});
