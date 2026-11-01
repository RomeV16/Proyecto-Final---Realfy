import {
  AnnualRecovery,
  ChargePayer,
  ChargeSplitMode,
  LineBeneficiary,
  LineItemType,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';
import { InvalidChargeRuleError, chargeAllocationLine, splitBill, type ChargeRuleInput } from './index';

/**
 * Los importes esperados están calculados a mano antes de correr el motor (el
 * cálculo está en cada caso): el motor no puede ser su propio oráculo.
 */
const JAN = new Date(Date.UTC(2026, 0, 1));

const rule = (over: Partial<ChargeRuleInput> = {}): ChargeRuleInput => ({
  contractId: 'c1',
  ruleId: 'r1',
  payer: ChargePayer.Inmobiliaria,
  splitMode: ChargeSplitMode.Porcentaje,
  tenantSharePct: '100',
  fixedAmount: null,
  paymentPlan: ServicePaymentPlan.Mensual,
  annualRecovery: AnnualRecovery.Prorrateado,
  ...over,
});

const amounts = (r: ReturnType<typeof splitBill>) => r.allocations.map((a) => [a.contractId, a.amount]);

describe('charge-split: porcentaje', () => {
  it('50 % de 12345,67 es 6172,835 y redondea a 6172,84 (mitad hacia arriba)', () => {
    const r = splitBill({ amount: '12345.67', period: JAN }, [rule({ tenantSharePct: '50' })]);
    expect(amounts(r)).toEqual([['c1', '6172.84']]);
    expect(r.allocations[0]).toMatchObject({
      payer: ChargePayer.Inmobiliaria,
      installmentNo: 1,
      installmentsTotal: 1,
      chargePeriod: JAN,
    });
  });

  it('100 % traslada toda la boleta y 0 % no genera cobro', () => {
    expect(amounts(splitBill({ amount: '8000.00', period: JAN }, [rule()]))).toEqual([['c1', '8000.00']]);
    const zero = splitBill({ amount: '8000.00', period: JAN }, [rule({ tenantSharePct: '0' })]);
    expect(zero.allocations).toEqual([]);
    expect(zero.skipped).toEqual([{ contractId: 'c1', ruleId: 'r1', reason: 'ZeroShare' }]);
  });

  it('la fecha de la boleta se lleva al primer día del mes', () => {
    const r = splitBill({ amount: '100', period: new Date(Date.UTC(2026, 4, 17)) }, [rule()]);
    expect(r.allocations[0].chargePeriod).toEqual(new Date(Date.UTC(2026, 4, 1)));
  });

  it('el porcentaje fuera de 0 a 100 se rechaza', () => {
    expect(() => splitBill({ amount: '100', period: JAN }, [rule({ tenantSharePct: '101' })])).toThrow(
      InvalidChargeRuleError,
    );
    expect(() => splitBill({ amount: '-1', period: JAN }, [rule()])).toThrow(/negativo/);
  });
});

describe('charge-split: importe fijo', () => {
  it('cobra el fijo cuando la boleta lo cubre: 3000 de una boleta de 4200', () => {
    const r = splitBill({ amount: '4200', period: JAN }, [
      rule({ splitMode: ChargeSplitMode.Fijo, fixedAmount: '3000' }),
    ]);
    expect(amounts(r)).toEqual([['c1', '3000.00']]);
  });

  it('nunca cobra más que la boleta: fijo 5000 sobre 4200 cobra 4200', () => {
    const r = splitBill({ amount: '4200', period: JAN }, [
      rule({ splitMode: ChargeSplitMode.Fijo, fixedAmount: '5000' }),
    ]);
    expect(amounts(r)).toEqual([['c1', '4200.00']]);
  });

  it('sin importe fijo la regla es inválida', () => {
    expect(() =>
      splitBill({ amount: '100', period: JAN }, [rule({ splitMode: ChargeSplitMode.Fijo })]),
    ).toThrow(InvalidChargeRuleError);
  });
});

describe('charge-split: consumo', () => {
  const units = (consumptions: (string | null)[], over: Partial<ChargeRuleInput> = {}) =>
    consumptions.map((c, i) =>
      rule({
        contractId: `c${i + 1}`,
        ruleId: `r${i + 1}`,
        splitMode: ChargeSplitMode.Consumo,
        consumption: c,
        ...over,
      }),
    );

  it('reparte por consumo con mayor resto: 100/200/300 de 1000 es 166,67 + 333,33 + 500,00', () => {
    // 1000 x 100/600 = 166,666..; 1000 x 200/600 = 333,333..; 1000 x 300/600 = 500.
    // En centavos 16666 + 33333 + 50000 = 99999; el centavo que falta va al mayor resto (el primero, ,667).
    const r = splitBill({ amount: '1000.00', period: JAN, consumption: '600' }, units(['100', '200', '300']));
    expect(amounts(r)).toEqual([
      ['c1', '166.67'],
      ['c2', '333.33'],
      ['c3', '500.00'],
    ]);
    expect(r.allocations[0].basis).toBe('Consumo: 100 de 600');
  });

  it('si el consumo de las unidades es menor al de la boleta, la diferencia no se traslada', () => {
    // total 800, unidades 600: 100/800 x 1000 = 125; 200/800 = 250; 300/800 = 375; quedan 250.
    const r = splitBill({ amount: '1000.00', period: JAN, consumption: '800' }, units(['100', '200', '300']));
    expect(amounts(r)).toEqual([
      ['c1', '125.00'],
      ['c2', '250.00'],
      ['c3', '375.00'],
    ]);
  });

  it('la unidad que paga directo ocupa su parte y no genera cobro', () => {
    // sin consumo total: total 300; c1 100/300 x 900 = 300; c2 200/300 x 900 = 600 (paga directo).
    const rules = [
      ...units(['100']),
      rule({
        contractId: 'c2',
        ruleId: 'r2',
        splitMode: ChargeSplitMode.Consumo,
        consumption: '200',
        payer: ChargePayer.Inquilino,
      }),
    ];
    const r = splitBill({ amount: '900.00', period: JAN }, rules);
    expect(amounts(r)).toEqual([['c1', '300.00']]);
    expect(r.skipped).toEqual([{ contractId: 'c2', ruleId: 'r2', reason: 'PaidDirectly' }]);
  });

  it('con varias unidades y sin consumo de alguna no se reparte y se avisa', () => {
    const r = splitBill({ amount: '900.00', period: JAN }, units(['100', null]));
    expect(r.allocations).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['MissingConsumption', 'MissingConsumption']);
  });

  it('una sola unidad sin consumo declarado se lleva toda la boleta', () => {
    const r = splitBill({ amount: '900.00', period: JAN }, units([null]));
    expect(amounts(r)).toEqual([['c1', '900.00']]);
  });

  it('una unidad con su consumo y la boleta con el total: 25 de 100 es la cuarta parte', () => {
    const r = splitBill({ amount: '1234.56', period: JAN, consumption: '100' }, units(['25']));
    // 1234,56 / 4 = 308,64
    expect(amounts(r)).toEqual([['c1', '308.64']]);
  });
});

describe('charge-split: planes anuales', () => {
  const annual = (over: Partial<ChargeRuleInput> = {}) =>
    rule({ paymentPlan: ServicePaymentPlan.Anual, ...over });

  it('prorrateado: 1000,00 en 12 cuotas, las primeras cuatro de 83,34 y el resto de 83,33', () => {
    // 1000 / 12 = 83,333..: 12 x 83,33 = 999,96; faltan 4 centavos para las 4 primeras (igual resto, gana el orden).
    const r = splitBill({ amount: '1000.00', period: JAN }, [annual()]);
    const values = r.allocations.map((a) => a.amount);
    expect(values).toEqual([
      '83.34', '83.34', '83.34', '83.34', '83.33', '83.33', '83.33', '83.33', '83.33', '83.33', '83.33', '83.33',
    ]);
    expect(r.allocations.map((a) => a.chargePeriod.getUTCMonth())).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(r.allocations[2]).toMatchObject({ installmentNo: 3, installmentsTotal: 12 });
    expect(r.allocations[2].basis).toContain('cuota 3/12');
  });

  it('prorrateado desde noviembre cruza el año', () => {
    const r = splitBill({ amount: '1200.00', period: new Date(Date.UTC(2026, 10, 1)) }, [annual()]);
    expect(r.allocations[0].chargePeriod).toEqual(new Date(Date.UTC(2026, 10, 1)));
    expect(r.allocations[2].chargePeriod).toEqual(new Date(Date.UTC(2027, 0, 1)));
    expect(r.allocations.every((a) => a.amount === '100.00')).toBe(true);
  });

  it('único: se cobra entera en el mes de la boleta', () => {
    const r = splitBill({ amount: '1000.00', period: JAN }, [annual({ annualRecovery: AnnualRecovery.Unico })]);
    expect(amounts(r)).toEqual([['c1', '1000.00']]);
    expect(r.allocations[0].installmentsTotal).toBe(1);
  });

  it('el descuento por pago anual va al inquilino por defecto: 50 % de 9000 es 4500', () => {
    const r = splitBill({ amount: '9000.00', nominalAmount: '10000.00', period: JAN }, [
      annual({ tenantSharePct: '50', annualRecovery: AnnualRecovery.Unico }),
    ]);
    expect(amounts(r)).toEqual([['c1', '4500.00']]);
  });

  it('con el descuento para quien pagó se reparte el importe sin descuento: 50 % de 10000 es 5000', () => {
    const r = splitBill({ amount: '9000.00', nominalAmount: '10000.00', period: JAN }, [
      annual({ tenantSharePct: '50', annualRecovery: AnnualRecovery.Unico, annualDiscountToTenant: false }),
    ]);
    expect(amounts(r)).toEqual([['c1', '5000.00']]);
  });

  it('el contrato que termina en marzo recibe 3 de las 12 cuotas y se avisa', () => {
    const r = splitBill({ amount: '1200.00', period: JAN }, [
      annual({ lastBillableMonth: new Date(Date.UTC(2026, 2, 1)) }),
    ]);
    expect(r.allocations).toHaveLength(3);
    expect(r.warnings).toEqual([{ contractId: 'c1', code: 'AfterContractEnd', droppedInstallments: 9 }]);
  });

  it('el plan mensual no se prorratea aunque el recupero sea prorrateado', () => {
    const r = splitBill({ amount: '500.00', period: JAN }, [rule({ annualRecovery: AnnualRecovery.Prorrateado })]);
    expect(r.allocations).toHaveLength(1);
  });
});

describe('charge-split: quién paga', () => {
  it('el inquilino que paga directo no genera cobro', () => {
    const r = splitBill({ amount: '100', period: JAN }, [rule({ payer: ChargePayer.Inquilino })]);
    expect(r.allocations).toEqual([]);
    expect(r.skipped).toEqual([{ contractId: 'c1', ruleId: 'r1', reason: 'PaidDirectly' }]);
  });

  it('el propietario queda registrado en la parte', () => {
    const r = splitBill({ amount: '100', period: JAN }, [rule({ payer: ChargePayer.Propietario })]);
    expect(r.allocations[0].payer).toBe(ChargePayer.Propietario);
  });

  it('sin reglas no hay partes', () => {
    expect(splitBill({ amount: '100', period: JAN }, [])).toEqual({ allocations: [], skipped: [], warnings: [] });
  });
});

describe('charge-split: renglón de la liquidación', () => {
  const base = {
    allocationId: 'a1',
    amount: '1500.00',
    serviceType: ServiceType.Electricidad,
    installmentLabel: '09/2026',
    installmentNo: 1,
    installmentsTotal: 1,
  };

  it('la inmobiliaria paga al ente: servicio al ente, sin comisión', () => {
    expect(chargeAllocationLine({ ...base, payer: ChargePayer.Inmobiliaria })).toEqual({
      type: LineItemType.Servicio,
      description: 'Electricidad 09/2026',
      amount: '1500.00',
      commissionable: false,
      beneficiary: LineBeneficiary.Ente,
      sourceType: 'ServiceBillAllocation',
      sourceId: 'a1',
    });
  });

  it('el propietario: pasamanos al locador, con la leyenda por cuenta y orden', () => {
    const line = chargeAllocationLine({ ...base, payer: ChargePayer.Propietario });
    expect(line.beneficiary).toBe(LineBeneficiary.Locador);
    expect(line.commissionable).toBe(false);
    expect(line.description).toBe('Electricidad 09/2026 (por cuenta y orden del locador)');
  });

  it('los impuestos van como Impuesto y las cuotas se indican', () => {
    const line = chargeAllocationLine({
      ...base,
      payer: ChargePayer.Inmobiliaria,
      serviceType: ServiceType.ImpuestoInmobiliario,
      installmentLabel: '2026',
      installmentNo: 3,
      installmentsTotal: 12,
    });
    expect(line.type).toBe(LineItemType.Impuesto);
    expect(line.description).toBe('Impuesto inmobiliario 2026, cuota 3/12');
    expect(chargeAllocationLine({ ...base, payer: ChargePayer.Inmobiliaria, serviceType: ServiceType.Municipal }).type).toBe(
      LineItemType.Impuesto,
    );
  });

  it('un servicio "Otro" se nombra por su proveedor', () => {
    const line = chargeAllocationLine({
      ...base,
      payer: ChargePayer.Inmobiliaria,
      serviceType: ServiceType.Otro,
      providerName: 'Cooperativa de prueba',
    });
    expect(line.description).toBe('Cooperativa de prueba 09/2026');
  });

  it('el que paga directo no tiene renglón', () => {
    expect(() => chargeAllocationLine({ ...base, payer: ChargePayer.Inquilino })).toThrow();
  });
});
