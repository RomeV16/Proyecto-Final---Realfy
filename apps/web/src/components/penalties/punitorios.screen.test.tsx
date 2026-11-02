// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { ContractPenalties } from '@/components/contracts/contract-penalties';
import { ContractPenaltyRule } from '@/components/contracts/contract-penalty-rule';
import { PaymentForm } from '@/components/liquidaciones/payment-form';
import { ApiRequestError } from '@/lib/api-client';
import { PayoffPanel } from '@/components/liquidaciones/payoff-panel';
import { PenaltyConfigForm } from '@/components/settings/penalty-config-form';

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="es" messages={es}>
    {node}
  </NextIntlClientProvider>
);

const TENANT_RULE = { mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '2.0' };

beforeEach(() => {
  apiClient.mockReset();
  auth.role = 'Admin';
});

describe('ContractPenalties', () => {
  const rows = [
    { id: 'p1', amount: '1000.00', appliedOn: '2026-03-20T00:00:00.000Z', daysOverdue: 10, status: 'active', settledLiquidacionId: null },
    { id: 'p2', amount: '500.00', appliedOn: '2026-03-12T00:00:00.000Z', daysOverdue: 2, status: 'waived', waiveReason: 'acuerdo' },
    { id: 'p3', amount: '300.00', appliedOn: '2026-03-10T00:00:00.000Z', daysOverdue: 1, status: 'active', settledLiquidacionId: 'l2' },
  ];

  it('lista los punitorios y condona uno con motivo obligatorio', async () => {
    apiClient.mockImplementation((path: string) => (path.startsWith('/penalties?') ? Promise.resolve(rows) : Promise.resolve({})));
    render(wrap(<ContractPenalties contractId="c-1" currency="ARS" />));
    expect(await screen.findByText('Condonado')).toBeTruthy();
    expect(screen.getByText('Cobrado en una liquidación')).toBeTruthy();
    expect(screen.getByText(/Motivo: acuerdo/)).toBeTruthy();
    expect(apiClient).toHaveBeenCalledWith('/penalties?contractId=c-1');

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('button', { name: 'Condonar' })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Condonar' }));
    expect(await within(dialog).findByText('Indicá el motivo')).toBeTruthy();

    await user.type(within(dialog).getByRole('textbox'), '  bonificación  ');
    await user.click(within(dialog).getByRole('button', { name: 'Condonar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/penalties/p1/waive', { method: 'POST', body: JSON.stringify({ reason: 'bonificación' }) }),
    );
  });

  it('condona todos los pendientes de una vez', async () => {
    apiClient.mockImplementation((path: string) => (path.startsWith('/penalties?') ? Promise.resolve(rows) : Promise.resolve({})));
    render(wrap(<ContractPenalties contractId="c-1" />));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Condonar todos' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 punitorio por/)).toBeTruthy();
    await user.type(within(dialog).getByRole('textbox'), 'cierre');
    await user.click(within(dialog).getByRole('button', { name: 'Condonar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/penalties/waive-all', {
        method: 'POST',
        body: JSON.stringify({ reason: 'cierre' }),
      }),
    );
  });

  it('muestra el error de la API y deja el diálogo abierto', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method ? Promise.reject(new Error('boom')) : Promise.resolve(rows),
    );
    render(wrap(<ContractPenalties contractId="c-1" />));
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole('button', { name: 'Condonar' }))[0]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Condonar' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
  });

  it('no aparece sin punitorios ni para quien no puede condonar', async () => {
    apiClient.mockResolvedValue([]);
    const { container } = render(wrap(<ContractPenalties contractId="c-1" />));
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(container.textContent).toBe('');

    auth.role = 'Lectura';
    apiClient.mockClear();
    const other = render(wrap(<ContractPenalties contractId="c-1" />));
    expect(apiClient).not.toHaveBeenCalled();
    expect(other.container.textContent).toBe('');
  });

  it('un error de carga se muestra', async () => {
    apiClient.mockRejectedValue(new Error('x'));
    render(wrap(<ContractPenalties contractId="c-1" />));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('PayoffPanel', () => {
  const payoff = {
    date: '2026-03-20',
    balance: '300000.00',
    total: '301000.00',
    penalty: {
      accrued: '1000.00',
      waived: '200.00',
      alreadyBilled: '300.00',
      due: '1000.00',
      daysOverdue: 10,
      graceDays: 0,
      capHit: true,
      rule: { source: 'contract', mode: 'max_bna_or_daily', daysWithoutRate: 4 },
    },
  };

  it('calcula el monto a pagar y lo pasa al registro del pago', async () => {
    apiClient.mockResolvedValue(payoff);
    const onPay = vi.fn();
    render(wrap(<PayoffPanel liquidacionId="l-1" currency="ARS" onPay={onPay} />));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(await screen.findByText('Total a pagar')).toBeTruthy();
    expect(apiClient.mock.calls[0][0]).toMatch(/^\/liquidaciones\/l-1\/payoff\?date=\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText(/Ya condonado/)).toBeTruthy();
    expect(screen.getByText(/Ya incluido en otra liquidación/)).toBeTruthy();
    expect(screen.getByText('Se alcanzó el tope de punitorios.')).toBeTruthy();
    expect(screen.getByText(/4 días sin tasa activa/)).toBeTruthy();
    expect(screen.getByText('Con la regla de este contrato')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Registrar el pago con punitorios' }));
    expect(onPay).toHaveBeenCalledWith('301000.00', '2026-03-20');
  });

  it('sin punitorios ofrece registrar el pago común', async () => {
    apiClient.mockResolvedValue({ ...payoff, total: '300000.00', penalty: { ...payoff.penalty, due: '0.00', waived: '0', alreadyBilled: '0', capHit: false, rule: { source: 'tenant', mode: 'daily_fixed' } } });
    render(wrap(<PayoffPanel liquidacionId="l-1" onPay={vi.fn()} />));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(await screen.findByRole('button', { name: 'Registrar el pago' })).toBeTruthy();
    expect(screen.getByText('Con la regla de la inmobiliaria')).toBeTruthy();
  });

  it('una liquidación sin punitorio calculable muestra solo el saldo, y un error se informa', async () => {
    apiClient.mockResolvedValueOnce({ date: '2026-03-20', balance: '0.00', total: '0.00', penalty: null });
    render(wrap(<PayoffPanel liquidacionId="l-1" onPay={vi.fn()} />));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(await screen.findByText('Total a pagar')).toBeTruthy();
    apiClient.mockRejectedValueOnce(new Error('x'));
    await user.click(screen.getByRole('button', { name: 'Calcular' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('PenaltyConfigForm', () => {
  it('el administrador cambia la regla y la guarda con el esquema de la API', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string; body?: string }) =>
      init?.method === 'PUT' ? Promise.resolve(JSON.parse(init.body!)) : Promise.resolve(TENANT_RULE),
    );
    render(wrap(<PenaltyConfigForm />));
    const user = userEvent.setup();
    const mode = await screen.findByLabelText('Cálculo');
    await user.selectOptions(mode, 'daily_fixed');
    const value = screen.getByLabelText(/Monto por día/);
    await user.clear(value);
    await user.type(value, '50');
    await user.click(screen.getByRole('button', { name: 'Guardar regla' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/tenants/me/penalty-config', {
        method: 'PUT',
        body: JSON.stringify({ mode: 'daily_fixed', value: '50', graceDays: 0, maxMultiplier: '2.0' }),
      }),
    );
  });

  it('un valor inválido no se envía', async () => {
    apiClient.mockResolvedValue(TENANT_RULE);
    render(wrap(<PenaltyConfigForm />));
    const user = userEvent.setup();
    const grace = await screen.findByLabelText(/Días de gracia/);
    await user.clear(grace);
    await user.click(screen.getByRole('button', { name: 'Guardar regla' }));
    expect(await screen.findAllByText('Revisá este valor')).not.toHaveLength(0);
    expect(apiClient).toHaveBeenCalledTimes(1);
  });

  it('muestra el error al guardar y el de carga', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method ? Promise.reject(new Error('x')) : Promise.resolve(TENANT_RULE),
    );
    render(wrap(<PenaltyConfigForm />));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Guardar regla' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('un error de carga se informa', async () => {
    apiClient.mockRejectedValue(new Error('x'));
    render(wrap(<PenaltyConfigForm />));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('quien no es administrador solo la ve', async () => {
    auth.role = 'Gerente';
    apiClient.mockResolvedValue(TENANT_RULE);
    render(wrap(<PenaltyConfigForm />));
    expect(await screen.findByText(/La mayor entre 2× la tasa activa del BNA/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar regla' })).toBeNull();
  });
});

describe('ContractPenaltyRule', () => {
  it('muestra la regla propia del contrato o la de la inmobiliaria', async () => {
    apiClient.mockResolvedValue(TENANT_RULE);
    const own = { mode: 'daily_fixed', value: '25', graceDays: 3, maxMultiplier: '2' };
    const { rerender } = render(wrap(<ContractPenaltyRule contractId="c-1" own={own} onChanged={vi.fn()} />));
    expect(await screen.findByText('Regla de este contrato')).toBeTruthy();
    rerender(wrap(<ContractPenaltyRule contractId="c-1" own={null} onChanged={vi.fn()} />));
    expect(await screen.findByText('Regla de la inmobiliaria')).toBeTruthy();
  });

  it('sin poder leer la regla de la inmobiliaria avisa que rige esa', async () => {
    auth.role = 'Lectura';
    apiClient.mockRejectedValue(new Error('403'));
    render(wrap(<ContractPenaltyRule contractId="c-1" own={null} onChanged={vi.fn()} />));
    expect(await screen.findByText('Rige la regla de la inmobiliaria')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cambiar la regla' })).toBeNull();
  });

  it('registra el cambio como un acuerdo de cambio de reglas desde una fecha', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method ? Promise.resolve({}) : Promise.resolve(TENANT_RULE),
    );
    const onChanged = vi.fn();
    render(wrap(<ContractPenaltyRule contractId="c-1" own={null} onChanged={onChanged} />));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cambiar la regla' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Cálculo'), 'daily_percent');
    const value = within(dialog).getByLabelText(/Porcentaje por día/);
    await user.clear(value);
    await user.type(value, '0.5');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = apiClient.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(call[0]).toBe('/contracts/c-1/agreements');
    const body = JSON.parse(call[1].body);
    expect(body.kind).toBe('CambioRegla');
    expect(body.termsPatch.penaltyConfig).toEqual({ mode: 'daily_percent', value: '0.005', graceDays: 0, maxMultiplier: '2.0' });
  });

  it('volver a la regla de la inmobiliaria manda penaltyConfig nulo; valida fecha y regla; informa el error', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string }) =>
      init?.method ? Promise.reject(new Error('x')) : Promise.resolve(TENANT_RULE),
    );
    render(wrap(<ContractPenaltyRule contractId="c-1" own={{ mode: 'daily_fixed', value: '25', graceDays: 0, maxMultiplier: '2' }} onChanged={vi.fn()} />));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cambiar la regla' }));
    const dialog = await screen.findByRole('dialog');

    const value = within(dialog).getByLabelText(/Monto por día/);
    await user.clear(value);
    await user.type(value, 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Revisá este valor')).toBeTruthy();

    await user.click(within(dialog).getByRole('checkbox'));
    await user.clear(within(dialog).getByLabelText(/Rige desde/));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    expect(await within(dialog).findByText('Elegí una fecha')).toBeTruthy();

    await user.type(within(dialog).getByLabelText(/Rige desde/), '2026-04-01');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      const call = apiClient.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(JSON.parse(call![1].body).termsPatch).toEqual({ penaltyConfig: null });
    });
    expect((await within(dialog).findAllByRole('alert')).length).toBeGreaterThan(0);
  });
});

describe('PaymentForm con punitorios', () => {
  it('manda settlePenalties con el monto y la fecha del cálculo', async () => {
    apiClient.mockResolvedValue({});
    const onSuccess = vi.fn();
    render(wrap(<PaymentForm liquidacionId="l-1" remainingBalance={300000} initialAmount="301000.00" initialPaidAt="2026-03-20" settlePenalties onSuccess={onSuccess} onClose={vi.fn()} />));
    expect(screen.getByText(/incluye los punitorios devengados/)).toBeTruthy();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Medio de pago|Método/i), 'Transferencia');
    await user.click(screen.getByRole('button', { name: /Registrar pago|Registrar el pago/i }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const body = JSON.parse(apiClient.mock.calls[0][1].body);
    expect(body).toMatchObject({ amount: 301000, settlePenalties: true, paidAt: '2026-03-20T00:00:00.000Z' });
  });

  it('si el monto no cubre el total con punitorios lo explica', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(400, 'PAYOFF_REQUIRES_FULL_AMOUNT', 'x'));
    render(wrap(<PaymentForm liquidacionId="l-1" remainingBalance={300000} settlePenalties onSuccess={vi.fn()} onClose={vi.fn()} />));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText(/Medio de pago|Método/i), 'Transferencia');
    await user.click(screen.getByRole('button', { name: /Registrar pago|Registrar el pago/i }));
    expect(await screen.findByText(/tiene que cubrir el total calculado/)).toBeTruthy();
  });
});
