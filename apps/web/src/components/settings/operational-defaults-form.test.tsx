// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  auth: { user: { id: 'me', role: 'Admin' } },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: auth.user }),
  useOptionalAuth: () => ({ user: auth.user }),
}));

import { ApiRequestError } from '@/lib/api-client';
import { OperationalDefaultsManager } from './operational-defaults-form';

const PENALTY_RULE = { mode: 'daily_percent', value: '0.001', graceDays: 5, maxMultiplier: '2.0' };

describe('OperationalDefaultsManager', () => {
  beforeEach(() => {
    apiClient.mockReset();
    toast.success.mockReset();
    auth.user = { id: 'me', role: 'Admin' };
    apiClient.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('penalty-config')) return PENALTY_RULE;
      return init?.method === 'PUT' ? JSON.parse(init.body as string) : DEFAULT_OPERATIONAL_DEFAULTS;
    });
  });

  it('muestra los valores de fábrica en cada campo', async () => {
    renderEs(<OperationalDefaultsManager />);

    expect(await screen.findByLabelText(/Día de vencimiento/)).toHaveValue('10');
    expect(screen.getByLabelText(/Días de anticipación/)).toHaveValue('10');
    expect(screen.getByLabelText(/Rezago del IPC/)).toHaveValue('2');
    expect(screen.getByLabelText(/Comisión de administración/)).toHaveValue('7');
    expect(screen.getByLabelText(/Honorarios por alta/)).toHaveValue('5');
    expect(screen.getByLabelText(/Honorarios de venta, construido/)).toHaveValue('3');
    expect(screen.getByLabelText(/Tasación \(USD\)/)).toHaveValue('100');
    expect(screen.getByLabelText(/Umbral de anticipo/)).toHaveValue('2');
    expect(screen.getByLabelText(/Primer recordatorio/)).toHaveValue('5');
    expect(screen.getByLabelText(/Amarillo hasta/)).toHaveValue('60');
    expect(apiClient).toHaveBeenCalledWith('/tenants/me/operational-defaults');
  });

  it('la facturación por cuenta del locador arranca en lo conservador y se guarda en el cuerpo', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    expect(await screen.findByLabelText(/Qué se factura/)).toHaveValue('Alquiler');
    expect(screen.getByLabelText(/Cuándo se factura/)).toHaveValue('Manual');
    expect(screen.getByLabelText(/IVA incluido en el importe/)).toHaveValue('0');
    expect(screen.getByRole('option', { name: 'Sin IVA discriminado' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '10.5 %' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Cuándo se factura/), 'AlEmitirEstado');
    await user.selectOptions(screen.getByLabelText(/IVA incluido en el importe/), '21');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).invoicing).toEqual({ scope: 'Alquiler', when: 'AlEmitirEstado', vatPct: 21 });
  });

  it('guarda los valores editados con el cuerpo anidado de la API', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '5');
    const commission = screen.getByLabelText(/Comisión de administración/);
    await user.clear(commission);
    await user.type(commission, '7,5');

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Valores por defecto guardados'));
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    const body = JSON.parse(put[1].body);
    expect(body).toMatchObject({
      dueDay: 5,
      commissionPct: 7.5,
      fees: { alta: 5, renovacion: 5, ventaConstruido: 3, ventaLote: 5 },
      collectionCadence: { firstReminderDays: 5, everyDays: 5 },
      expiryLight: { redDays: 30, yellowDays: 60 },
      repairs: { preauthLimit: 0, managementFeePct: 0 },
      messaging: { fromHour: 9, untilHour: 20 },
    });
  });

  it('la cobranza escalonada viene apagada y se prende con sus niveles y el plazo de la carta', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const toggle = await screen.findByLabelText(/Activar la cobranza escalonada/);
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText(/Cantidad de recordatorios/)).toHaveValue('3');
    expect(screen.getByLabelText(/Plazo de la carta documento/)).toHaveValue('10');
    await user.click(toggle);
    await user.clear(screen.getByLabelText(/Cantidad de recordatorios/));
    await user.type(screen.getByLabelText(/Cantidad de recordatorios/), '2');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).collections).toEqual({ enabled: true, maxLevel: 2, letterTermDays: 10, repeatLastLevel: true });
  });

  it('el pago a cuenta viene activo y se puede apagar', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const toggle = await screen.findByLabelText(/Pago a cuenta si falta el índice/);
    expect(toggle).toBeChecked();

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).allowProvisional).toBe(false);
  });

  it('muestra las cuatro convenciones de liquidación con el valor de fábrica y su explicación', async () => {
    renderEs(<OperationalDefaultsManager />);

    const proration = await screen.findByLabelText(/Prorrateo de un mes parcial/);
    expect(proration).toHaveValue('DiasReales');
    expect(screen.getByLabelText(/Ajuste a mitad de mes/)).toHaveValue('DesdePeriodoSiguiente');
    expect(screen.getByLabelText(/Primer mes con inicio tardío/)).toHaveValue('DiaDeInicio');
    expect(screen.getByLabelText(/Descuento de monto fijo en un mes parcial/)).toHaveValue('Proporcional');
    expect(screen.getByLabelText(/Comisión para el umbral de anticipo/)).toHaveValue('ComisionPactada');
    expect(screen.getByRole('option', { name: 'Mes comercial de 30 días' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Se cobra al firmar (no se liquida)' })).toBeInTheDocument();
    expect(screen.getByText(/de fábrica: Días reales del mes/)).toBeInTheDocument();
  });

  it('guarda las convenciones elegidas y volver a fábrica las restaura', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    await user.selectOptions(await screen.findByLabelText(/Prorrateo de un mes parcial/), 'Mes30');
    await user.selectOptions(screen.getByLabelText(/Ajuste a mitad de mes/), 'Prorrateado');
    await user.selectOptions(screen.getByLabelText(/Primer mes con inicio tardío/), 'AlFirmar');
    await user.selectOptions(screen.getByLabelText(/Descuento de monto fijo en un mes parcial/), 'Completo');
    await user.selectOptions(screen.getByLabelText(/Comisión para el umbral de anticipo/), 'PorcentajePorDefecto');
    await user.selectOptions(screen.getByLabelText(/Ajustes salteados al importar/), 'Recuperar');

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body)).toMatchObject({
      prorationMode: 'Mes30',
      midMonthAdjustmentMode: 'Prorrateado',
      firstDueMode: 'AlFirmar',
      fixedDiscountProration: 'Completo',
      upfrontBasis: 'PorcentajePorDefecto',
      skippedAdjustmentsMode: 'Recuperar',
    });

    await user.click(screen.getByRole('button', { name: 'Volver a los valores de fábrica' }));
    expect(screen.getByLabelText(/Ajustes salteados al importar/)).toHaveValue('NoRecuperar');
    expect(screen.getByLabelText(/Prorrateo de un mes parcial/)).toHaveValue('DiasReales');
    expect(screen.getByLabelText(/Descuento de monto fijo en un mes parcial/)).toHaveValue('Proporcional');
  });

  it('muestra las opciones de caja y cobros con su valor de fábrica y las guarda', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);

    expect(await screen.findByText('Caja y cobros')).toBeInTheDocument();
    const owes = screen.getByLabelText(/Si el inquilino le paga al locador/);
    expect(owes).toHaveValue('TodoLoAjeno');
    expect(screen.getByLabelText(/^Pago parcial\*?$/)).toHaveValue('Proporcional');
    expect(screen.getByLabelText(/Numeración de los recibos de cobro/)).toHaveValue('Unica');
    expect(screen.getByLabelText(/Compensaciones entre locadores/)).toHaveValue('CualquierLocador');
    expect(screen.getByText(/de fábrica: Todo lo que no es suyo/)).toBeInTheDocument();
    const custody = screen.getByLabelText(/Sumar la custodia al total de la caja/);
    const lessorReceipt = screen.getByLabelText(/Recibo cuando cobra el locador/);
    expect(custody).not.toBeChecked();
    expect(lessorReceipt).not.toBeChecked();

    await user.selectOptions(owes, 'SoloInmobiliaria');
    await user.selectOptions(screen.getByLabelText(/^Pago parcial\*?$/), 'InmobiliariaPrimero');
    await user.selectOptions(screen.getByLabelText(/Numeración de los recibos de cobro/), 'PorMoneda');
    await user.selectOptions(screen.getByLabelText(/Compensaciones entre locadores/), 'MismoContrato');
    await user.click(custody);
    await user.click(lessorReceipt);
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).cash).toEqual({
      lessorDirectOwes: 'SoloInmobiliaria',
      partialAllocation: 'InmobiliariaPrimero',
      custodyInAgencyBalance: true,
      receiptSeries: 'PorMoneda',
      receiptWhenLessorReceives: true,
      compensationScope: 'MismoContrato',
    });
  });

  it('cuenta corriente del locador: día de cierre (vacío = fin de mes) y cuándo se descuentan los gastos (CP-478)', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);

    expect(await screen.findByText('Cuenta corriente del locador')).toBeInTheDocument();
    const closeDay = screen.getByLabelText(/Día de cierre del estado/);
    expect(closeDay).toHaveValue('');
    expect(closeDay).not.toBeRequired();
    expect(screen.getByText(/Vacío = fin de mes/)).toBeInTheDocument();
    const timing = screen.getByLabelText(/Gastos a cargo del locador/);
    expect(timing).toHaveValue('AlGenerarEstado');

    await user.type(closeDay, '31');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(closeDay).toHaveAttribute('aria-invalid', 'true'));
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);

    await user.clear(closeDay);
    await user.type(closeDay, '10');
    await user.selectOptions(timing, 'AlEmitirEstado');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).ownerAccounts).toEqual({ statementCloseDay: 10, lessorChargeTiming: 'AlEmitirEstado' });
  });

  it('cómo se cobran los honorarios: quién paga, cuotas, IVA y comisión del personal, con su valor de fábrica', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);

    expect(await screen.findByText('Cómo se cobran los honorarios')).toBeInTheDocument();
    const payer = screen.getByLabelText(/Quién paga el honorario de un alquiler/);
    expect(payer).toHaveValue('Inquilino');
    expect(screen.getByLabelText(/Parte del locador cuando pagan los dos/)).toHaveValue('50');
    expect(screen.getByLabelText(/^Cuotas del honorario/)).toHaveValue('1');
    expect(screen.getByLabelText(/^Total del contrato/)).toHaveValue('ConAjustesConocidos');
    expect(screen.getByLabelText(/^IVA del honorario/)).toHaveValue('NoAplica');
    expect(screen.getByLabelText(/^IVA \(%\)/)).toHaveValue('21');
    expect(screen.getByLabelText(/^Comisión del personal \(%\)/)).toHaveValue('0');
    expect(screen.getByLabelText(/Comisión del personal sobre/)).toHaveValue('Neto');
    const adjust = screen.getByLabelText(/Las cuotas siguen los ajustes del alquiler/);
    expect(adjust).toBeChecked();
    expect(screen.getByText(/De fábrica: El inquilino/)).toBeInTheDocument();

    await user.selectOptions(payer, 'Ambos');
    const share = screen.getByLabelText(/Parte del locador cuando pagan los dos/);
    await user.clear(share);
    await user.type(share, '40');
    const installments = screen.getByLabelText(/^Cuotas del honorario/);
    await user.clear(installments);
    await user.type(installments, '3');
    await user.selectOptions(screen.getByLabelText(/^Total del contrato/), 'AlquilerInicial');
    await user.selectOptions(screen.getByLabelText(/^IVA del honorario/), 'Adicional');
    const staff = screen.getByLabelText(/^Comisión del personal \(%\)/);
    await user.clear(staff);
    await user.type(staff, '10');
    await user.selectOptions(screen.getByLabelText(/Comisión del personal sobre/), 'Bruto');
    await user.click(adjust);
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).fees).toMatchObject({
      payer: 'Ambos',
      lessorSharePct: 40,
      installments: 3,
      adjustInstallments: false,
      contractTotalMode: 'AlquilerInicial',
      vatMode: 'Adicional',
      vatPct: 21,
      staffCommissionPct: 10,
      staffCommissionBase: 'Bruto',
    });
  });

  it('mensajería: el horario de envío viene de 9 a 20, se valida y se guarda anidado', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);

    expect(await screen.findByText('Mensajería')).toBeInTheDocument();
    const from = screen.getByLabelText(/Mandar desde las/);
    const until = screen.getByLabelText(/Mandar hasta las/);
    expect(from).toHaveValue('9');
    expect(until).toHaveValue('20');
    expect(screen.getByText(/de 0 a 23 \(de fábrica 9\)/)).toBeInTheDocument();

    // Hasta tiene que ser después de desde.
    await user.clear(until);
    await user.type(until, '8');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(until).toHaveAttribute('aria-invalid', 'true'));
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);

    await user.clear(from);
    await user.type(from, '8');
    await user.clear(until);
    await user.type(until, '21');
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).messaging).toEqual({ fromHour: 8, untilHour: 21 });
  });

  it('ventas: plazo de la reserva, quién guarda el dinero y la documentación para el boleto, con su valor de fábrica', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const days = await screen.findByLabelText(/Días de vigencia de una reserva/);
    expect(days).toHaveValue('7');
    expect(screen.getByLabelText(/Quién guarda el dinero de una reserva o seña/)).toHaveValue('Inmobiliaria');
    const docs = screen.getByRole('checkbox', { name: /Exigir la documentación obligatoria/ });
    expect(docs).toBeChecked();

    await user.clear(days);
    await user.type(days, '15');
    await user.selectOptions(screen.getByLabelText(/Quién guarda el dinero de una reserva o seña/), 'Escribano');
    await user.click(docs);
    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const put = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1].body).sales).toEqual({ reservationDays: 15, defaultDepositHolder: 'Escribano', requireDocsForBoleto: false });
  });

  it('un valor inválido se marca en el campo y no se envía', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '40');

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    expect(await screen.findByText('El valor está fuera del rango permitido')).toBeInTheDocument();
    expect(dueDay).toHaveAttribute('aria-invalid', 'true');
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('volver a los valores de fábrica restaura los campos', async () => {
    const user = userEvent.setup();
    renderEs(<OperationalDefaultsManager />);
    const dueDay = await screen.findByLabelText(/Día de vencimiento/);
    await user.clear(dueDay);
    await user.type(dueDay, '3');

    await user.click(screen.getByRole('button', { name: 'Volver a los valores de fábrica' }));

    expect(dueDay).toHaveValue('10');
  });

  it('un error de la API al guardar se muestra con ErrorNotice', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path.includes('penalty-config')) return PENALTY_RULE;
      if (init?.method === 'PUT') throw new ApiRequestError(403, 'FORBIDDEN', 'No autorizado');
      return DEFAULT_OPERATIONAL_DEFAULTS;
    });
    renderEs(<OperationalDefaultsManager />);
    await screen.findByLabelText(/Día de vencimiento/);

    await user.click(screen.getByRole('button', { name: 'Guardar valores' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('FORBIDDEN');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('un error al cargar se muestra y no deja el formulario', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'Caído'));
    renderEs(<OperationalDefaultsManager />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Día de vencimiento/)).not.toBeInTheDocument();
  });

  it('quien no es Admin ni Gerente ve el aviso y no consulta los valores', () => {
    auth.user = { id: 'x', role: 'Ventas' };
    renderEs(<OperationalDefaultsManager />);
    expect(screen.getByText(/Solo Administración y Gerencia/)).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
