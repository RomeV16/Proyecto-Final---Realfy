import { describe, expect, it } from 'vitest';
import {
  approveFormSchema,
  awaitsAuthorization,
  canEstimate,
  canImpute,
  canPayProvider,
  canQuote,
  estimateFormSchema,
  imputeFormSchema,
  paymentFormSchema,
  personName,
  preauthorizeFormSchema,
  quoteFormSchema,
} from './ticket-repairs';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('qué se puede hacer según el estado', () => {
  it('se presupuesta antes de empezar a trabajar', () => {
    expect(['Abierto', 'Asignado', 'Reabierto', 'Presupuestado'].every(canQuote)).toBe(true);
    expect(['PendienteAutorizacion', 'EnProgreso', 'Cancelado'].some(canQuote)).toBe(false);
  });

  it('se estima hasta que el caso se presupuesta', () => {
    expect(canEstimate('PendienteAutorizacion')).toBe(true);
    expect(canEstimate('Presupuestado')).toBe(true);
    expect(canEstimate('PresupuestoAprobado')).toBe(false);
    expect(awaitsAuthorization('PendienteAutorizacion')).toBe(true);
    expect(awaitsAuthorization('Abierto')).toBe(false);
  });

  it('se paga con proveedor y el trabajo aprobado, y mientras no se haya imputado', () => {
    expect(canPayProvider({ status: 'PresupuestoAprobado', providerId: UUID, imputedAt: null })).toBe(true);
    expect(canPayProvider({ status: 'Resuelto', providerId: UUID, imputedAt: null })).toBe(true);
    expect(canPayProvider({ status: 'Presupuestado', providerId: UUID, imputedAt: null })).toBe(false);
    expect(canPayProvider({ status: 'Resuelto', providerId: null, imputedAt: null })).toBe(false);
    expect(canPayProvider({ status: 'Resuelto', providerId: UUID, imputedAt: '2026-11-01' })).toBe(false);
  });

  it('se imputa con el trabajo terminado y una sola vez', () => {
    expect(canImpute({ status: 'TrabajoRealizado', imputedAt: null })).toBe(true);
    expect(canImpute({ status: 'EnProgreso', imputedAt: null })).toBe(false);
    expect(canImpute({ status: 'Cerrado', imputedAt: '2026-11-01' })).toBe(false);
  });

  it('el nombre de una persona', () => {
    expect(personName({ id: UUID, firstName: 'Ana', lastName: 'Locadora' })).toBe('Ana Locadora');
    expect(personName(null)).toBe('');
  });
});

const issues = (result: ReturnType<typeof estimateFormSchema.safeParse>) =>
  result.success ? [] : result.error.issues.map((i) => [i.path[0], i.message]);

describe('formularios de la reparación', () => {
  it('estimado: acepta coma decimal y rechaza vacío, cero y tres decimales', () => {
    expect(estimateFormSchema.safeParse({ amount: '1500,5', currency: 'ARS' })).toMatchObject({ success: true, data: { amount: '1500.5' } });
    expect(issues(estimateFormSchema.safeParse({ amount: '' }))[0]).toEqual(['amount', 'tickets.repair.errors.amount']);
    expect(estimateFormSchema.safeParse({ amount: '0' }).success).toBe(false);
    expect(estimateFormSchema.safeParse({ amount: '1.234' }).success).toBe(false);
  });

  it('preautorización: pide tope, quién y canal', () => {
    expect(preauthorizeFormSchema.safeParse({ amount: '5000', approvedByPersonId: UUID, channel: 'Mail', note: '' }).success).toBe(true);
    expect(issues(preauthorizeFormSchema.safeParse({ amount: '5000', approvedByPersonId: '', channel: '' }))).toEqual(
      expect.arrayContaining([['approvedByPersonId', 'tickets.repair.errors.approvedByPersonId'], ['channel', 'tickets.repair.errors.channel']]),
    );
  });

  it('presupuesto y aprobación', () => {
    expect(quoteFormSchema.safeParse({ providerId: UUID, amount: '80000', currency: 'ARS', notes: ' con materiales ' })).toMatchObject({
      success: true,
      data: { notes: 'con materiales' },
    });
    expect(issues(quoteFormSchema.safeParse({ providerId: '', amount: '80000' }))[0]).toEqual(['providerId', 'tickets.repair.errors.providerId']);
    expect(approveFormSchema.safeParse({ approvedByPersonId: UUID, channel: 'Presencial', note: '' }).success).toBe(true);
    expect(approveFormSchema.safeParse({ approvedByPersonId: UUID, channel: '' }).success).toBe(false);
  });

  it('pago: cuenta, importe y fecha opcional', () => {
    expect(paymentFormSchema.safeParse({ accountId: UUID, amount: '100', date: '2026-11-02', note: '' }).success).toBe(true);
    expect(paymentFormSchema.safeParse({ accountId: UUID, amount: '100', date: '02/11/2026' }).success).toBe(false);
    expect(paymentFormSchema.safeParse({ accountId: '', amount: '100' }).success).toBe(false);
  });

  it('imputación: pide quién paga y valida el honorario', () => {
    const base = { chargedTo: 'Locador', feeMode: 'None', feePct: '', feeAmount: '' };
    expect(imputeFormSchema.safeParse({ ...base, chargedTo: '' }).success).toBe(false);
    expect(imputeFormSchema.safeParse(base)).toMatchObject({ success: true, data: { chargedTo: 'Locador' } });
    expect(imputeFormSchema.safeParse({ ...base, feeMode: 'Percent', feePct: '7,5' })).toMatchObject({
      success: true,
      data: { managementFee: { mode: 'Percent', pct: 7.5 } },
    });
    // Sin porcentaje usa el de la inmobiliaria.
    expect(imputeFormSchema.safeParse({ ...base, feeMode: 'Percent' }).success).toBe(true);
    expect(new Set(issues(imputeFormSchema.safeParse({ ...base, feeMode: 'Fixed' })).map((i) => i.join(':')))).toEqual(
      new Set(['feeMode:tickets.repair.errors.managementFee']),
    );
    expect(imputeFormSchema.safeParse({ ...base, feeMode: 'Percent', feePct: '150' }).success).toBe(false);
    // La inmobiliaria no se cobra honorario a sí misma: se ignora.
    expect(imputeFormSchema.safeParse({ ...base, chargedTo: 'Inmobiliaria', feeMode: 'Fixed' })).toMatchObject({ success: true });
  });
});
