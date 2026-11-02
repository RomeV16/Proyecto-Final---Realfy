import { ChargeTarget, Currency, TicketStatus as S } from '../enums';
import {
  ApproveTicketQuoteSchema,
  CreateTicketQuoteSchema,
  EstimateTicketSchema,
  ImputeTicketSchema,
  PreauthorizeTicketSchema,
  RegisterProviderPaymentSchema,
  UpdateTicketQuoteSchema,
} from '../schemas/ticket.schema';
import { resolveOperationalDefaults } from '../schemas/operational-defaults.schema';
import {
  feeApplies,
  repairManagementFee,
  requiresPreauthorization,
  ticketStep,
  ticketStepIndex,
  TICKET_STEPS,
  totalPaid,
} from './index';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('recorrido de una incidencia', () => {
  it('los pasos van de Abierto a Cerrado', () => {
    expect(TICKET_STEPS[0]).toBe(S.Abierto);
    expect(TICKET_STEPS[TICKET_STEPS.length - 1]).toBe(S.Cerrado);
  });

  it.each([
    [S.Abierto, S.Abierto],
    [S.Asignado, S.Abierto],
    [S.Reabierto, S.Abierto],
    [S.PendienteAutorizacion, S.PendienteAutorizacion],
    [S.Presupuestado, S.Presupuestado],
    [S.PresupuestoAprobado, S.PresupuestoAprobado],
    [S.ProveedorAsignado, S.EnProgreso],
    [S.ProveedorEnCamino, S.EnProgreso],
    [S.TrabajoRealizado, S.EnProgreso],
    [S.EnProgreso, S.EnProgreso],
    [S.Resuelto, S.Resuelto],
    [S.Cerrado, S.Cerrado],
  ])('%s cuenta como el paso %s', (status, step) => {
    expect(ticketStep(status)).toBe(step);
  });

  it('una incidencia cancelada no está en ningún paso', () => {
    expect(ticketStep(S.Cancelado)).toBeNull();
    expect(ticketStepIndex(S.Cancelado)).toBe(-1);
  });

  it('cada estado tiene un paso o es el cancelado', () => {
    for (const status of Object.values(S)) {
      expect(ticketStepIndex(status) >= 0 || status === S.Cancelado).toBe(true);
    }
  });
});

describe('requiresPreauthorization', () => {
  const base = { currency: Currency.ARS, limitArs: '100000' };

  it('por debajo del límite o igual a él no hace falta', () => {
    expect(requiresPreauthorization({ ...base, amount: '99999.99' })).toBe(false);
    expect(requiresPreauthorization({ ...base, amount: '100000' })).toBe(false);
  });

  it('por encima del límite hace falta', () => {
    expect(requiresPreauthorization({ ...base, amount: '100000.01' })).toBe(true);
  });

  it('con límite 0 siempre se consulta', () => {
    expect(requiresPreauthorization({ currency: Currency.ARS, limitArs: 0, amount: '1' })).toBe(true);
  });

  it('el tope que el locador ya autorizó para el caso pisa al límite', () => {
    expect(requiresPreauthorization({ ...base, amount: '250000', preauthorizedAmount: '300000' })).toBe(false);
    expect(requiresPreauthorization({ ...base, amount: '350000', preauthorizedAmount: '300000' })).toBe(true);
    expect(requiresPreauthorization({ ...base, amount: '50000', preauthorizedAmount: '10000' })).toBe(true);
  });

  it('un estimado en otra moneda siempre se consulta', () => {
    expect(requiresPreauthorization({ ...base, currency: Currency.USD, amount: '1' })).toBe(true);
  });
});

describe('repairManagementFee', () => {
  it('sin honorario no devuelve nada', () => {
    expect(repairManagementFee('50000', { mode: 'None' })).toBeNull();
  });

  it('un porcentaje de lo pagado, a dos decimales', () => {
    expect(repairManagementFee('12345.67', { mode: 'Percent', pct: 10 })).toBe('1234.57');
    expect(repairManagementFee('100', { mode: 'Percent', pct: 7.5 })).toBe('7.50');
  });

  it('un importe fijo', () => {
    expect(repairManagementFee('999', { mode: 'Fixed', amount: '1500' })).toBe('1500.00');
  });

  it('un resultado en cero no se cobra', () => {
    expect(repairManagementFee('100', { mode: 'Percent', pct: 0 })).toBeNull();
    expect(repairManagementFee('100', { mode: 'Percent' })).toBeNull();
    expect(repairManagementFee('100', { mode: 'Fixed' })).toBeNull();
  });
});

describe('totales y a quién se le cobra el honorario', () => {
  it('suma los pagos con dos decimales', () => {
    expect(totalPaid(['100.10', '200.20', 0.7])).toBe('301.00');
    expect(totalPaid([])).toBe('0.00');
  });

  it('el honorario no se le cobra a la inmobiliaria', () => {
    expect(feeApplies(ChargeTarget.Inquilino)).toBe(true);
    expect(feeApplies(ChargeTarget.Locador)).toBe(true);
    expect(feeApplies(ChargeTarget.Inmobiliaria)).toBe(false);
  });
});

describe('esquemas de incidencias', () => {
  it('el estimado acepta número o texto y toma pesos por defecto', () => {
    expect(EstimateTicketSchema.parse({ amount: 1500.5 })).toEqual({ amount: '1500.5', currency: 'ARS' });
    expect(EstimateTicketSchema.safeParse({ amount: '0' }).success).toBe(false);
    expect(EstimateTicketSchema.safeParse({ amount: '10.123' }).success).toBe(false);
    expect(EstimateTicketSchema.safeParse({ amount: '10', extra: 1 }).success).toBe(false);
  });

  it('la preautorización pide quién la dio y por qué canal', () => {
    expect(PreauthorizeTicketSchema.safeParse({ amount: '5000', approvedByPersonId: UUID, channel: 'WhatsApp' }).success).toBe(true);
    expect(PreauthorizeTicketSchema.safeParse({ amount: '5000', channel: 'WhatsApp' }).success).toBe(false);
    expect(PreauthorizeTicketSchema.safeParse({ amount: '5000', approvedByPersonId: UUID, channel: 'Paloma' }).success).toBe(false);
  });

  it('un presupuesto pide proveedor e importe; la corrección es parcial', () => {
    expect(CreateTicketQuoteSchema.parse({ providerId: UUID, amount: '8000' })).toMatchObject({ currency: 'ARS' });
    expect(CreateTicketQuoteSchema.safeParse({ providerId: UUID, amount: '8000', documentUrl: 'no es url' }).success).toBe(false);
    expect(UpdateTicketQuoteSchema.safeParse({}).success).toBe(true);
    expect(UpdateTicketQuoteSchema.safeParse({ amount: '-1' }).success).toBe(false);
  });

  it('aprobar un presupuesto pide quién y el canal', () => {
    expect(ApproveTicketQuoteSchema.safeParse({ approvedByPersonId: UUID, channel: 'Presencial' }).success).toBe(true);
    expect(ApproveTicketQuoteSchema.safeParse({ approvedByPersonId: UUID }).success).toBe(false);
  });

  it('el pago al proveedor pide cuenta e importe y acepta fecha', () => {
    expect(RegisterProviderPaymentSchema.safeParse({ accountId: UUID, amount: '100', date: '2026-11-02' }).success).toBe(true);
    expect(RegisterProviderPaymentSchema.safeParse({ accountId: UUID, amount: '100', date: '02/11/2026' }).success).toBe(false);
  });

  it('la imputación acepta el honorario ninguno, en porcentaje o fijo (con importe)', () => {
    expect(ImputeTicketSchema.safeParse({}).success).toBe(true);
    expect(ImputeTicketSchema.safeParse({ chargedTo: 'Locador', managementFee: { mode: 'Percent', pct: 10 } }).success).toBe(true);
    expect(ImputeTicketSchema.safeParse({ managementFee: { mode: 'Fixed', amount: '1500' } }).success).toBe(true);
    expect(ImputeTicketSchema.safeParse({ managementFee: { mode: 'Fixed' } }).success).toBe(false);
    expect(ImputeTicketSchema.safeParse({ managementFee: { mode: 'Percent', pct: 101 } }).success).toBe(false);
    expect(ImputeTicketSchema.safeParse({ chargedTo: 'Vecino' }).success).toBe(false);
    expect(ImputeTicketSchema.safeParse({ targetPeriod: '2026-12' }).success).toBe(true);
  });
});

describe('valores por defecto de las reparaciones', () => {
  it('sin nada guardado: siempre se consulta al locador y no se propone honorario', () => {
    expect(resolveOperationalDefaults(null).repairs).toEqual({ preauthLimit: 0, managementFeePct: 0 });
  });

  it('se pueden fijar y se validan', () => {
    expect(resolveOperationalDefaults({ repairs: { preauthLimit: 150000, managementFeePct: 10 } }).repairs).toEqual({
      preauthLimit: 150000,
      managementFeePct: 10,
    });
    expect(() => resolveOperationalDefaults({ repairs: { preauthLimit: -1 } })).toThrow();
    expect(() => resolveOperationalDefaults({ repairs: { managementFeePct: 101 } })).toThrow();
  });
});
