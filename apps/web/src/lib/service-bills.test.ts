import { describe, expect, it } from 'vitest';
import {
  checkUnitConsumptions,
  consumptionRuleProperties,
  currentMonth,
  defaultInstallment,
  initialUnitValues,
  parseAmountInput,
  parseConsumptionInput,
  parseDateInput,
  proposedDueDate,
  type ServiceBill,
  type SheetRow,
} from './service-bills';

describe('service-bills', () => {
  it('el mes actual y la cuota propuesta', () => {
    expect(currentMonth(new Date(2026, 10, 5))).toBe('2026-11');
    expect(defaultInstallment('2026-09')).toBe('09/2026');
  });

  it('el vencimiento propuesto no pasa del último día del mes', () => {
    expect(proposedDueDate('2026-11', 10)).toBe('2026-11-10');
    expect(proposedDueDate('2026-02', 31)).toBe('2026-02-28');
  });

  it('importes: coma decimal, hasta dos decimales y sin signo', () => {
    expect(parseAmountInput('12345,5')).toBe('12345.5');
    expect(parseAmountInput('100.25')).toBe('100.25');
    expect(parseAmountInput('100,255')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
  });

  it('consumo: hasta tres decimales', () => {
    expect(parseConsumptionInput('120,5')).toBe('120.5');
    expect(parseConsumptionInput('1,2345')).toBeNull();
  });

  it('fechas: ISO y día/mes/año, solo las que existen', () => {
    expect(parseDateInput('2026-11-10')).toBe('2026-11-10');
    expect(parseDateInput('10/11/2026')).toBe('2026-11-10');
    expect(parseDateInput('5-3-2026')).toBe('2026-03-05');
    expect(parseDateInput('31/02/2026')).toBeNull();
    expect(parseDateInput('mañana')).toBeNull();
  });
});

describe('consumo por unidad', () => {
  const row = (rules: { propertyId: string; splitMode?: string }[]): SheetRow => ({
    service: {
      id: 's',
      serviceType: 'Agua',
      providerName: null,
      amount: '0',
      currency: 'ARS',
      dueDay: 10,
      billingFrequency: 'Mensual',
      hasAnnualOption: false,
      property: null,
    },
    bills: [],
    rules: rules.map((r, i) => ({
      id: `r${i}`,
      contractId: `c${i}`,
      payer: 'Propietario',
      splitMode: r.splitMode ?? 'Consumo',
      tenantSharePct: '100',
      fixedAmount: null,
      paymentPlan: 'Mensual',
      propertyId: r.propertyId,
    })),
  });

  it('arranca con los consumos que la boleta ya trae', () => {
    expect(initialUnitValues(null)).toEqual({});
    const bill = { unitConsumptions: [{ propertyId: 'a', consumption: '100.000' }, { propertyId: 'b', consumption: '2.5' }] } as ServiceBill;
    expect(initialUnitValues(bill)).toEqual({ a: '100', b: '2.5' });
  });

  it('suma sin errores de coma flotante y arma lo que se envía', () => {
    const check = checkUnitConsumptions(row([{ propertyId: 'a' }, { propertyId: 'b' }]), { a: '0,1', b: '0.2', c: '' }, '');
    expect(check.sum).toBe('0.3');
    expect(check.entries).toEqual([
      { propertyId: 'a', consumption: '0.1' },
      { propertyId: 'b', consumption: '0.2' },
    ]);
    expect(check.errors).toEqual({});
    expect(check.totalBelowSum).toBe(false);
    expect(check.untransferred).toBeNull();
  });

  it('marca el consumo inválido y el que falta cuando varias unidades se reparten por consumo', () => {
    const check = checkUnitConsumptions(row([{ propertyId: 'a' }, { propertyId: 'b' }, { propertyId: 'c', splitMode: 'Fijo' }]), { a: 'mucho' }, '');
    expect(check.errors).toEqual({ a: 'invalid', b: 'missing' });
  });

  it('con una sola unidad por consumo no exige su consumo', () => {
    expect(checkUnitConsumptions(row([{ propertyId: 'a' }]), {}, '').errors).toEqual({});
    expect(consumptionRuleProperties(row([{ propertyId: 'a' }, { propertyId: 'b', splitMode: 'Fijo' }]))).toEqual(['a']);
  });

  it('compara con el consumo total de la boleta', () => {
    const r = row([{ propertyId: 'a' }, { propertyId: 'b' }]);
    expect(checkUnitConsumptions(r, { a: '100', b: '200' }, '250')).toMatchObject({ totalBelowSum: true, untransferred: null });
    expect(checkUnitConsumptions(r, { a: '100', b: '200' }, '400')).toMatchObject({ totalBelowSum: false, untransferred: '100' });
    expect(checkUnitConsumptions(r, { a: '100', b: '200' }, 'x')).toMatchObject({ totalBelowSum: false, untransferred: null });
  });
});
