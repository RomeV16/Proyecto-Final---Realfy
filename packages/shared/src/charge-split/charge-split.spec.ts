import {
  AnnualDiscountBeneficiary,
  AnnualRecovery,
  ChargePayer,
  ChargeSplitMode,
  LineBeneficiary,
  LineItemType,
  RemainingInstallmentsOnEnd,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';
import { InvalidChargeRuleError, chargeAllocationLine, chargeAllocationLines, splitBill, type ChargeRuleInput } from './index';

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

  it('en 6 cuotas: 1000,00 da cuatro de 166,67 y dos de 166,66', () => {
    // 1000 / 6 = 166,666..: 6 x 166,66 = 999,96; los 4 centavos que faltan van a las primeras cuatro.
    const r = splitBill({ amount: '1000.00', period: JAN }, [annual({ annualInstallments: 6 })]);
    expect(r.allocations.map((a) => a.amount)).toEqual(['166.67', '166.67', '166.67', '166.67', '166.66', '166.66']);
    expect(r.allocations.map((a) => a.chargePeriod.getUTCMonth())).toEqual([0, 1, 2, 3, 4, 5]);
    expect(r.allocations[5]).toMatchObject({ installmentNo: 6, installmentsTotal: 6 });
  });

  it('en 10 cuotas: 1000,01 da una de 100,01 y nueve de 100,00', () => {
    // 1000,01 / 10 = 100,001: 10 x 100,00 = 1000,00; el centavo que falta va a la primera.
    const r = splitBill({ amount: '1000.01', period: JAN }, [annual({ annualInstallments: 10 })]);
    expect(r.allocations.map((a) => a.amount)).toEqual(['100.01', ...new Array(9).fill('100.00')]);
  });

  it('las cuotas fuera de 1 a 12 se rechazan', () => {
    for (const bad of [0, 13, 2.5]) {
      expect(() => splitBill({ amount: '100', period: JAN }, [annual({ annualInstallments: bad })])).toThrow(
        InvalidChargeRuleError,
      );
    }
  });

  describe('descuento por pago anual', () => {
    const bill = { amount: '9000.00', nominalAmount: '10000.00', period: JAN };
    const unico = { tenantSharePct: '50', annualRecovery: AnnualRecovery.Unico };

    it('Inquilino (por defecto): se cobra lo pagado, 50 % de 9000 = 4500, sin diferencia', () => {
      const r = splitBill(bill, [annual({ ...unico, annualDiscountBeneficiary: AnnualDiscountBeneficiary.Inquilino })]);
      expect(amounts(r)).toEqual([['c1', '4500.00']]);
      expect(r.allocations[0]).toMatchObject({ surplus: '0.00', surplusBeneficiary: null });
      expect(splitBill(bill, [annual(unico)]).allocations[0].amount).toBe('4500.00');
    });

    it('Locador: se cobra el nominal, 50 % de 10000 = 5000, y la diferencia de 500 es del locador', () => {
      // lo pagado: 50 % de 9000 = 4500; nominal: 5000; diferencia 500.
      const r = splitBill(bill, [annual({ ...unico, annualDiscountBeneficiary: AnnualDiscountBeneficiary.Locador })]);
      expect(r.allocations[0]).toMatchObject({ amount: '5000.00', surplus: '500.00', surplusBeneficiary: 'Locador' });
    });

    it('Inmobiliaria: igual cobro y la diferencia de 500 es de la inmobiliaria', () => {
      const r = splitBill(bill, [
        annual({ ...unico, annualDiscountBeneficiary: AnnualDiscountBeneficiary.Inmobiliaria }),
      ]);
      expect(r.allocations[0]).toMatchObject({ amount: '5000.00', surplus: '500.00', surplusBeneficiary: 'Inmobiliaria' });
    });

    it('sin importe nominal o sin descuento no hay diferencia', () => {
      const r = splitBill({ amount: '9000.00', period: JAN }, [
        annual({ ...unico, annualDiscountBeneficiary: AnnualDiscountBeneficiary.Locador }),
      ]);
      expect(r.allocations[0]).toMatchObject({ amount: '4500.00', surplus: '0.00', surplusBeneficiary: null });
    });

    it('en 6 cuotas la diferencia se reparte con las cuotas y suma 500', () => {
      // cobrado 5000 / 6 = 833,33..: 833,34 las dos primeras y 833,33 el resto; pagado 4500 / 6 = 750,00 cada una.
      const r = splitBill(bill, [
        annual({ tenantSharePct: '50', annualInstallments: 6, annualDiscountBeneficiary: AnnualDiscountBeneficiary.Locador }),
      ]);
      expect(r.allocations.map((a) => a.amount)).toEqual(['833.34', '833.34', '833.33', '833.33', '833.33', '833.33']);
      expect(r.allocations.map((a) => a.surplus)).toEqual(['83.34', '83.34', '83.33', '83.33', '83.33', '83.33']);
    });
  });

  describe('contrato que termina antes de la última cuota (termina en marzo)', () => {
    const march = new Date(Date.UTC(2026, 2, 1));

    it('CobrarEnLiquidacionFinal (por defecto): las 9 cuotas restantes se suman a la de marzo', () => {
      // 1200 / 12 = 100 por cuota: enero 100, febrero 100, marzo 100 + 9 x 100 = 1000.
      const r = splitBill({ amount: '1200.00', period: JAN }, [annual({ lastBillableMonth: march })]);
      expect(r.allocations.map((a) => a.amount)).toEqual(['100.00', '100.00', '1000.00']);
      expect(r.allocations[2].basis).toContain('incluye 9 cuotas restantes');
      expect(r.warnings).toEqual([{ contractId: 'c1', code: 'CollectedInFinalLiquidation', collectedInstallments: 9 }]);
    });

    it('Descartar: solo se cobran las 3 cuotas del contrato y se avisa', () => {
      const r = splitBill({ amount: '1200.00', period: JAN }, [
        annual({ lastBillableMonth: march, remainingInstallmentsOnEnd: RemainingInstallmentsOnEnd.Descartar }),
      ]);
      expect(r.allocations.map((a) => a.amount)).toEqual(['100.00', '100.00', '100.00']);
      expect(r.warnings).toEqual([{ contractId: 'c1', code: 'AfterContractEnd', droppedInstallments: 9 }]);
    });

    it('con diferencia por descuento, la diferencia de las cuotas restantes también se suma', () => {
      // cobrado 10000 en 12 cuotas: cuatro de 833,34 y ocho de 833,33; diferencia 1000: cuatro de 83,34 y ocho de 83,33.
      // Marzo: 833,34 + (833,34 + 8 x 833,33) = 8333,32; diferencia 83,34 + (83,34 + 8 x 83,33) = 833,32.
      const r = splitBill({ amount: '9000.00', nominalAmount: '10000.00', period: JAN }, [
        annual({ lastBillableMonth: march, annualDiscountBeneficiary: AnnualDiscountBeneficiary.Locador }),
      ]);
      expect(r.allocations.map((a) => [a.amount, a.surplus])).toEqual([
        ['833.34', '83.34'],
        ['833.34', '83.34'],
        ['8333.32', '833.32'],
      ]);
    });

    it('un contrato sin fin no suma ni descarta nada', () => {
      const r = splitBill({ amount: '1200.00', period: JAN }, [annual()]);
      expect(r.allocations).toHaveLength(12);
      expect(r.warnings).toEqual([]);
    });
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

describe('charge-split: renglones con diferencia por descuento anual', () => {
  const base = {
    allocationId: 'a1',
    payer: ChargePayer.Inmobiliaria,
    amount: '5000.00',
    serviceType: ServiceType.ImpuestoInmobiliario,
    installmentLabel: '2026',
    installmentNo: 1,
    installmentsTotal: 1,
  };

  it('sin diferencia es un solo renglón por el total', () => {
    const lines = chargeAllocationLines({ ...base, surplus: '0.00', surplusBeneficiary: null });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amount: '5000.00', beneficiary: LineBeneficiary.Ente, type: LineItemType.Impuesto });
  });

  it('la diferencia del locador sale aparte, a su nombre y sin comisión', () => {
    const lines = chargeAllocationLines({ ...base, surplus: '500.00', surplusBeneficiary: 'Locador' });
    expect(lines.map((l) => [l.type, l.amount.toString(), l.beneficiary, l.commissionable, l.sourceType])).toEqual([
      [LineItemType.Impuesto, '4500', LineBeneficiary.Ente, false, 'ServiceBillAllocation'],
      [LineItemType.Cargo, '500.00', LineBeneficiary.Locador, false, 'ServiceBillAllocationSurplus'],
    ]);
    expect(lines[1].description).toBe('Diferencia por pago anual de Impuesto inmobiliario 2026');
    expect(lines.every((l) => l.sourceId === 'a1')).toBe(true);
  });

  it('la diferencia de la inmobiliaria va a su nombre; si es todo el importe queda un solo renglón', () => {
    const lines = chargeAllocationLines({ ...base, surplus: '500.00', surplusBeneficiary: 'Inmobiliaria', installmentsTotal: 12, installmentNo: 3 });
    expect(lines[1]).toMatchObject({ beneficiary: LineBeneficiary.Inmobiliaria, commissionable: false });
    expect(lines[1].description).toBe('Diferencia por pago anual de Impuesto inmobiliario 2026, cuota 3/12');
    const only = chargeAllocationLines({ ...base, amount: '500.00', surplus: '500.00', surplusBeneficiary: 'Locador' });
    expect(only).toHaveLength(1);
    expect(only[0].type).toBe(LineItemType.Cargo);
  });
});
