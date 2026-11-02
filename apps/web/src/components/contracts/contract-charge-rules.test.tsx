// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Liquidaciones' },
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
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), info: vi.fn() },
}));

import { ApiRequestError } from '@/lib/api-client';
import { ContractChargeRules } from './contract-charge-rules';

const svc = (id: string, type: string, o: Record<string, unknown> = {}) => ({
  id,
  serviceType: type,
  providerName: null,
  propertyId: 'prop-1',
  hasAnnualOption: false,
  ...o,
});

const rule = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  serviceId: 's1',
  payer: 'Inmobiliaria',
  splitMode: 'Porcentaje',
  tenantSharePct: '50',
  fixedAmount: null,
  paymentPlan: 'Mensual',
  annualRecovery: 'Prorrateado',
  annualInstallments: 12,
  annualDiscountBeneficiary: 'Inquilino',
  remainingInstallmentsOnEnd: 'CobrarEnLiquidacionFinal',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
  agreementId: null,
  service: svc('s1', 'Electricidad', { providerName: 'Ente de prueba' }),
  ...o,
});

const RULES = {
  at: '2026-11-01T00:00:00.000Z',
  current: [
    rule(),
    rule({
      id: 'r2',
      serviceId: 's2',
      payer: 'Propietario',
      splitMode: 'Fijo',
      fixedAmount: '2500',
      paymentPlan: 'Anual',
      annualRecovery: 'Unico',
      agreementId: 'ag-1',
      validFrom: '2026-07-01T00:00:00.000Z',
      service: svc('s2', 'ImpuestoInmobiliario'),
    }),
    rule({ id: 'r3', serviceId: 's3', payer: 'Inquilino', service: svc('s3', 'Gas') }),
    rule({ id: 'r4', serviceId: 's4', splitMode: 'Consumo', service: svc('s4', 'Agua'), paymentPlan: 'Anual' }),
  ],
  versions: [
    rule({ id: 'old', payer: 'Inquilino', validTo: '2026-06-30T00:00:00.000Z', validFrom: '2026-01-01T00:00:00.000Z' }),
    rule(),
    rule({ id: 'r2', serviceId: 's2', payer: 'Propietario', service: svc('s2', 'ImpuestoInmobiliario') }),
    rule({ id: 'r3', serviceId: 's3', payer: 'Inquilino', service: svc('s3', 'Gas') }),
    rule({ id: 'r4', serviceId: 's4', service: svc('s4', 'Agua') }),
  ],
};

const SERVICES = [svc('s1', 'Electricidad', { providerName: 'Ente de prueba' }), svc('s2', 'ImpuestoInmobiliario', { hasAnnualOption: true })];

function serve(rules: unknown = RULES, over: Record<string, (body?: any) => unknown> = {}) {
  apiClient.mockImplementation(async (path: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(options.body as string) : undefined;
    const key = `${options?.method ?? 'GET'} ${path}`;
    if (over[key]) return over[key](body);
    if (path === '/contracts/c-1/charge-rules') return rules;
    if (path.startsWith('/services?propertyId=prop-1')) return { items: SERVICES };
    if (path.startsWith('/services?propertyId=building-1')) return { items: [svc('s9', 'Agua', { propertyId: 'building-1' })] };
    if (path === '/properties/prop-1') return { id: 'prop-1', parentPropertyId: null };
    throw new Error(`inesperado: ${key}`);
  });
}

const renderRules = (status = 'Activo') =>
  renderEs(<ContractChargeRules contractId="c-1" propertyId="prop-1" contractStatus={status} currency="ARS" />);

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Liquidaciones';
});

describe('ContractChargeRules: lectura', () => {
  it('muestra quién paga cada impuesto y servicio, cómo se reparte y el historial', async () => {
    serve();
    renderRules();

    expect(await screen.findByText('Electricidad · Ente de prueba')).toBeInTheDocument();
    expect(screen.getByText('50 % al inquilino')).toBeInTheDocument();
    expect(screen.getByText(/2\.500,00 fijo/)).toBeInTheDocument();
    expect(screen.getByText('pago anual, se cobra de una vez')).toBeInTheDocument();
    expect(screen.getByText('pago anual, en 12 cuotas')).toBeInTheDocument();
    expect(screen.getByText('por consumo')).toBeInTheDocument();
    expect(screen.getByText(/desde el .*por acuerdo/)).toBeInTheDocument();
    // La regla anterior de la electricidad queda en el historial; el inquilino que paga directo no lleva detalle.
    expect(screen.getByText('1 versión anterior')).toBeInTheDocument();
  });

  it('un contrato sin reglas lo dice y un error de carga se muestra', async () => {
    serve({ at: '', current: [], versions: [] });
    renderRules();
    expect(await screen.findByText('El contrato todavía no tiene reglas de impuestos y servicios.')).toBeInTheDocument();
  });

  it('un error de carga se muestra', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'INTERNAL_ERROR', 'sin conexión'));
    renderRules();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('quien no administra la facturación ve las reglas pero no el editor', async () => {
    auth.role = 'Soporte';
    serve();
    renderRules();
    await screen.findByText('Electricidad · Ente de prueba');
    expect(screen.queryByRole('button', { name: 'Agregar o cambiar regla' })).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalledWith(expect.stringContaining('/services?'));
  });
});

describe('ContractChargeRules: editor', () => {
  async function openEditor(status = 'Activo') {
    renderRules(status);
    await screen.findByText('Electricidad · Ente de prueba');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Agregar o cambiar regla' }));
    await screen.findByRole('form', { name: 'Regla de impuestos y servicios' });
    // Las opciones de servicio llegan después de abrir.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Electricidad · Ente de prueba' })).toBeInTheDocument());
    return user;
  }

  it('en un contrato en vigor registra el acuerdo de cambio de cargo y después la regla', async () => {
    const calls: string[] = [];
    serve(RULES, {
      'POST /contracts/c-1/agreements': (body) => {
        calls.push('agreement');
        expect(body).toMatchObject({ kind: 'CambioCargo', effectiveFrom: '2026-12-01T00:00:00.000Z', notes: 'Por escrito' });
        return { id: 'ag-9' };
      },
      'POST /contracts/c-1/charge-rules': (body) => {
        calls.push('rule');
        expect(body).toMatchObject({
          serviceId: 's1',
          payer: 'Propietario',
          splitMode: 'Porcentaje',
          tenantSharePct: '75.5',
          paymentPlan: 'Mensual',
          validFrom: '2026-12-01',
          agreementId: 'ag-9',
        });
        return {};
      },
    });
    const user = await openEditor();

    expect(screen.getByText(/El contrato está en vigor/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^Servicio/), 's1');
    await user.selectOptions(screen.getByLabelText('Quién paga'), 'Propietario');
    expect(screen.getByText('El inquilino lo paga con el alquiler y todo pasa al locador.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText(/Porcentaje que le toca/));
    await user.type(screen.getByLabelText(/Porcentaje que le toca/), '75,5');
    await user.clear(screen.getByLabelText(/Rige desde/));
    await user.type(screen.getByLabelText(/Rige desde/), '2026-12-01');
    await user.type(screen.getByLabelText('Notas del acuerdo'), 'Por escrito');
    await user.click(screen.getByRole('button', { name: 'Registrar acuerdo y guardar regla' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Regla guardada'));
    expect(calls).toEqual(['agreement', 'rule']);
    // Se vuelve a pedir la lista de reglas.
    expect(apiClient.mock.calls.filter(([p]) => p === '/contracts/c-1/charge-rules').length).toBeGreaterThan(2);
  });

  it('en un borrador crea la regla sin acuerdo; un importe fijo y el plan anual traen sus campos', async () => {
    let sent: any;
    serve(RULES, {
      'POST /contracts/c-1/charge-rules': (body) => {
        sent = body;
        return {};
      },
    });
    const user = await openEditor('Borrador');

    expect(screen.getByText(/El contrato es un borrador/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Documento del acuerdo/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/^Servicio/), 's2');
    await user.selectOptions(screen.getByLabelText('Cómo se reparte'), 'Fijo');
    await user.type(screen.getByLabelText(/Importe fijo por boleta/), '3000,50');
    await user.selectOptions(screen.getByLabelText('Plan de pago'), 'Anual');
    // Prorrateado (por defecto): cuotas a elección y qué hacer si el contrato termina antes.
    await user.selectOptions(screen.getByLabelText(/Cantidad de cuotas/), '10');
    await user.selectOptions(screen.getByLabelText('Si el contrato termina antes'), 'Descartar');
    await user.selectOptions(screen.getByLabelText('A quién va el descuento por pago anual'), 'Locador');
    await user.click(screen.getByRole('button', { name: 'Guardar regla' }));

    await waitFor(() => expect(sent).toBeDefined());
    expect(sent).toMatchObject({
      serviceId: 's2',
      splitMode: 'Fijo',
      fixedAmount: '3000.50',
      paymentPlan: 'Anual',
      annualRecovery: 'Prorrateado',
      annualInstallments: 10,
      annualDiscountBeneficiary: 'Locador',
      remainingInstallmentsOnEnd: 'Descartar',
    });
    expect(sent.agreementId).toBeUndefined();
    expect(apiClient).not.toHaveBeenCalledWith('/contracts/c-1/agreements', expect.anything());
  });

  it('con recupero de una vez no pide cuotas ni qué hacer al terminar, y valida las cuotas', async () => {
    serve();
    const user = await openEditor();
    await user.selectOptions(screen.getByLabelText(/^Servicio/), 's2');
    await user.selectOptions(screen.getByLabelText('Plan de pago'), 'Anual');
    expect(screen.getByLabelText(/Cantidad de cuotas/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Recupero de la boleta anual'), 'Unico');
    expect(screen.queryByLabelText(/Cantidad de cuotas/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Si el contrato termina antes')).not.toBeInTheDocument();
    expect(screen.getByLabelText('A quién va el descuento por pago anual')).toBeInTheDocument();
  });

  it('quien paga directo no pide reparto ni plan', async () => {
    serve();
    const user = await openEditor();
    await user.selectOptions(screen.getByLabelText('Quién paga'), 'Inquilino');
    expect(screen.queryByLabelText('Cómo se reparte')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Plan de pago')).not.toBeInTheDocument();
  });

  it('valida el servicio, el porcentaje, el importe y el enlace antes de enviar', async () => {
    serve();
    const user = await openEditor();

    await user.clear(screen.getByLabelText(/Porcentaje que le toca/));
    await user.type(screen.getByLabelText(/Porcentaje que le toca/), '120');
    await user.type(screen.getByLabelText(/Documento del acuerdo/), 'ftp://x');
    await user.click(screen.getByRole('button', { name: 'Registrar acuerdo y guardar regla' }));

    expect(await screen.findByText('Elegí el servicio')).toBeInTheDocument();
    expect(screen.getByText('El porcentaje va de 0 a 100')).toBeInTheDocument();
    expect(screen.getByText('Ingresá un enlace que empiece con http:// o https://')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Cómo se reparte'), 'Fijo');
    await user.click(screen.getByRole('button', { name: 'Registrar acuerdo y guardar regla' }));
    expect(await screen.findByText('Ingresá un importe mayor a cero')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalledWith('/contracts/c-1/agreements', expect.anything());
  });

  it('si la regla falla después de registrar el acuerdo lo avisa', async () => {
    serve(RULES, {
      'POST /contracts/c-1/agreements': () => ({ id: 'ag-9' }),
      'POST /contracts/c-1/charge-rules': () => {
        throw new ApiRequestError(409, 'CHARGE_RULE_EXISTS', 'ya existe');
      },
    });
    const user = await openEditor();
    await user.selectOptions(screen.getByLabelText(/^Servicio/), 's1');
    await user.click(screen.getByRole('button', { name: 'Registrar acuerdo y guardar regla' }));

    expect(await screen.findByText('Ya hay una regla para este servicio con esa fecha de inicio.')).toBeInTheDocument();
    expect(screen.getByText(/El acuerdo quedó registrado/)).toBeInTheDocument();
  });

  it('suma los servicios del edificio cuando la propiedad es una unidad', async () => {
    serve(RULES, { 'GET /properties/prop-1': () => ({ id: 'prop-1', parentPropertyId: 'building-1' }) });
    const user = await openEditor();
    expect(screen.getAllByRole('option').some((o) => o.textContent === 'Agua')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: 'Regla de impuestos y servicios' })).not.toBeInTheDocument();
  });
});
