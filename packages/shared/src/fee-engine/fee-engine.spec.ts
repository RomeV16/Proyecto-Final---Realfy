import {
  ContractTotalMode,
  FeeEngineError,
  SaleAsset,
  StaffCommissionBase,
  adjustInstallments,
  contractTermMonths,
  contractTotal,
  defaultFeePct,
  distributeFee,
  feeAmounts,
  pctOf,
  splitBetweenPayers,
  feeInstallments,
} from './index';
import { AdjustmentBase, AdjustmentType, FeeKind, FeeVatMode } from '../enums';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '../schemas/operational-defaults.schema';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const s = (values: { toFixed: (n: number) => string }[]) => values.map((v) => v.toFixed(2));

const IPC_RULE = { adjustmentType: AdjustmentType.IPC, adjustmentPeriod: 'Trimestral' } as const;

describe('fee-engine: meses del plazo', () => {
  it.each([
    ['2026-01-01', '2027-12-31', 24],
    ['2026-01-01', '2028-01-01', 24],
    ['2026-03-15', '2028-03-14', 24],
    ['2026-03-01', '2027-02-28', 12],
    ['2026-03-01', '2026-03-10', 1],
  ])('%s a %s son %i meses', (from, to, months) => {
    expect(contractTermMonths(d(from), d(to))).toBe(months);
  });
});

describe('fee-engine: total del contrato', () => {
  it('golden: con IPC el total es el alquiler inicial por los meses, en los dos modos', () => {
    for (const mode of [ContractTotalMode.AlquilerInicial, ContractTotalMode.ConAjustesConocidos]) {
      const r = contractTotal({
        startDate: d('2026-03-01'),
        endDate: d('2028-02-29'),
        initialRent: '500000',
        rule: IPC_RULE,
        mode,
      });
      expect(r.months).toBe(24);
      expect(r.total.toFixed(2)).toBe('12000000.00');
      expect(r.indexBased).toBe(true);
      expect(r.projected).toBe(false);
    }
  });

  const fixed10 = { adjustmentType: AdjustmentType.FixedPercent, adjustmentPeriod: 'Semestral', customPct: '10' } as const;

  it('golden: porcentaje fijo semestral proyectado (10 % cada 6 meses, compuesto)', () => {
    const r = contractTotal({
      startDate: d('2026-01-01'),
      endDate: d('2027-12-31'),
      initialRent: '100000',
      rule: fixed10,
      mode: ContractTotalMode.ConAjustesConocidos,
    });
    expect([...new Set(s(r.rents))]).toEqual(['100000.00', '110000.00', '121000.00', '133100.00']);
    expect(r.total.toFixed(2)).toBe('2784600.00');
    expect(r.projected).toBe(true);
    expect(pctOf(r.total, 5).toFixed(2)).toBe('139230.00');
  });

  it('el modo alquiler inicial no proyecta aunque la regla se conozca', () => {
    const r = contractTotal({
      startDate: d('2026-01-01'),
      endDate: d('2027-12-31'),
      initialRent: '100000',
      rule: fixed10,
      mode: ContractTotalMode.AlquilerInicial,
    });
    expect(r.total.toFixed(2)).toBe('2400000.00');
    expect(r.projected).toBe(false);
    expect(r.indexBased).toBe(false);
  });

  it('respeta los meses fijos iniciales', () => {
    const r = contractTotal({
      startDate: d('2026-01-01'),
      endDate: d('2027-12-31'),
      initialRent: '100000',
      rule: { ...fixed10, fixedInitialMonths: 12 },
      mode: ContractTotalMode.ConAjustesConocidos,
    });
    expect(r.total.toFixed(2)).toBe('2586000.00');
  });

  it('base original: cada ajuste se aplica sobre el alquiler inicial (como el motor de ajustes)', () => {
    const r = contractTotal({
      startDate: d('2026-01-01'),
      endDate: d('2027-12-31'),
      initialRent: '100000',
      rule: { ...fixed10, adjustmentBase: AdjustmentBase.Original },
      mode: ContractTotalMode.ConAjustesConocidos,
    });
    expect(r.total.toFixed(2)).toBe('2580000.00');
  });

  it('escalonado: rige el último escalón alcanzado', () => {
    const r = contractTotal({
      startDate: d('2026-01-01'),
      endDate: d('2027-12-31'),
      initialRent: '100000',
      rule: {
        adjustmentType: AdjustmentType.Escalonado,
        adjustmentPeriod: 'Semestral',
        customSteps: [
          { fromMonth: 6, pct: '10' },
          { fromMonth: 12, pct: '20' },
        ],
      },
      mode: ContractTotalMode.ConAjustesConocidos,
    });
    expect([...new Set(s(r.rents))]).toEqual(['100000.00', '110000.00', '132000.00', '158400.00']);
    expect(r.total.toFixed(2)).toBe('3002400.00');
  });

  it('una regla conocida sin porcentaje o sin escalones no proyecta', () => {
    const base = { startDate: d('2026-01-01'), endDate: d('2026-12-31'), initialRent: '1000', mode: ContractTotalMode.ConAjustesConocidos };
    expect(contractTotal({ ...base, rule: { adjustmentType: AdjustmentType.Custom, adjustmentPeriod: 'Trimestral' } }).total.toFixed(2)).toBe('12000.00');
    expect(
      contractTotal({ ...base, rule: { adjustmentType: AdjustmentType.Escalonado, adjustmentPeriod: 'Trimestral', customSteps: [] } }).total.toFixed(2),
    ).toBe('12000.00');
    expect(
      contractTotal({ ...base, rule: { adjustmentType: AdjustmentType.Custom, adjustmentPeriod: 'Trimestral', customPct: '5' } }).total.toFixed(2),
    ).toBe('12930.39');
  });

  it('rechaza un plazo invertido o un alquiler negativo', () => {
    const base = { initialRent: '1000', rule: IPC_RULE, mode: ContractTotalMode.AlquilerInicial };
    expect(() => contractTotal({ ...base, startDate: d('2026-02-01'), endDate: d('2026-01-01') })).toThrow(FeeEngineError);
    expect(() => contractTotal({ ...base, startDate: d('2026-01-01'), endDate: d('2026-12-31'), initialRent: '-1' })).toThrow(
      /negative/,
    );
  });
});

describe('fee-engine: honorario e IVA', () => {
  it('sin IVA', () => {
    expect(s(Object.values(feeAmounts('600000', FeeVatMode.NoAplica, 21)))).toEqual(['600000.00', '0.00', '600000.00']);
  });

  it('IVA sumado', () => {
    expect(s(Object.values(feeAmounts('600000', FeeVatMode.Adicional, 21)))).toEqual(['600000.00', '126000.00', '726000.00']);
  });

  it('IVA incluido: se separa y la suma da el total', () => {
    expect(s(Object.values(feeAmounts('726000', FeeVatMode.Incluido, 21)))).toEqual(['600000.00', '126000.00', '726000.00']);
    expect(s(Object.values(feeAmounts('100', FeeVatMode.Incluido, 21)))).toEqual(['82.64', '17.36', '100.00']);
  });

  it('tasa cero equivale a sin IVA; un honorario negativo se rechaza', () => {
    expect(feeAmounts('10', FeeVatMode.Adicional, 0).total.toFixed(2)).toBe('10.00');
    expect(() => feeAmounts('-1', FeeVatMode.NoAplica)).toThrow(FeeEngineError);
  });
});

describe('fee-engine: quién paga', () => {
  it('ambos por mitades', () => {
    expect(s(splitBetweenPayers('600000', [50, 50]))).toEqual(['300000.00', '300000.00']);
  });

  it('el centavo que sobra va a la parte con mayor resto', () => {
    expect(s(splitBetweenPayers('100.01', [60, 40]))).toEqual(['60.01', '40.00']);
  });

  it('las partes deben sumar 100; un honorario en cero da partes en cero', () => {
    expect(() => splitBetweenPayers('10', [50, 40])).toThrow('add up to 100');
    expect(s(splitBetweenPayers('0', [50, 50]))).toEqual(['0.00', '0.00']);
  });
});

describe('fee-engine: cuotas', () => {
  it('golden: alta 5 % de un contrato de 24 meses en 3 cuotas sin ajuste', () => {
    const total = contractTotal({
      startDate: d('2026-03-01'),
      endDate: d('2028-02-29'),
      initialRent: '500000',
      rule: IPC_RULE,
      mode: ContractTotalMode.ConAjustesConocidos,
    }).total;
    const fee = feeAmounts(pctOf(total, 5), FeeVatMode.NoAplica);
    expect(fee.total.toFixed(2)).toBe('600000.00');
    const parts = feeInstallments(fee.total, 3, d('2026-03-01'));
    expect(parts.map((p) => [p.n, p.dueDate.toISOString().slice(0, 10), p.amount.toFixed(2)])).toEqual([
      [1, '2026-03-01', '200000.00'],
      [2, '2026-04-01', '200000.00'],
      [3, '2026-05-01', '200000.00'],
    ]);
  });

  it('reparte los centavos en las primeras cuotas', () => {
    expect(s(feeInstallments('100', 3, d('2026-01-31')).map((p) => p.amount))).toEqual(['33.34', '33.33', '33.33']);
    expect(feeInstallments('100', 3, d('2026-01-31')).map((p) => p.dueDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('un honorario sin cargo no tiene cuotas; la cantidad va de 1 a 60', () => {
    expect(feeInstallments('0', 3, d('2026-01-01'))).toEqual([]);
    expect(() => feeInstallments('10', 0, d('2026-01-01'))).toThrow(FeeEngineError);
    expect(() => feeInstallments('10', 61, d('2026-01-01'))).toThrow(FeeEngineError);
    expect(() => feeInstallments('10', 1.5, d('2026-01-01'))).toThrow(FeeEngineError);
  });

  it('golden: alta 5 % en 6 cuotas con ajuste; las que vencen después del ajuste trimestral suben como el alquiler', () => {
    const parts = feeInstallments('600000', 6, d('2026-03-01'));
    const adjusted = adjustInstallments(parts, {
      referenceDate: d('2026-03-01'),
      referenceRent: '500000',
      changes: [{ date: d('2026-06-01'), rent: '560000' }],
    });
    expect(adjusted.map((a) => [a.n, a.adjustedAmount.toFixed(2)])).toEqual([
      [1, '100000.00'],
      [2, '100000.00'],
      [3, '100000.00'],
      [4, '112000.00'],
      [5, '112000.00'],
      [6, '112000.00'],
    ]);
  });

  it('acumula ajustes sucesivos y parte del alquiler vigente a la fecha de referencia', () => {
    const parts = [
      { n: 1, dueDate: d('2026-07-01'), amount: '1000' },
      { n: 2, dueDate: d('2026-10-01'), amount: '1000' },
    ];
    const adjusted = adjustInstallments(parts, {
      referenceDate: d('2026-06-15'),
      referenceRent: '1',
      changes: [
        { date: d('2026-03-01'), rent: '200' },
        { date: d('2026-09-01'), rent: '250' },
      ],
    });
    expect(s(adjusted.map((a) => a.adjustedAmount))).toEqual(['1000.00', '1250.00']);
  });

  it('rechaza un alquiler de referencia en cero', () => {
    expect(() =>
      adjustInstallments([{ n: 1, dueDate: d('2026-01-01'), amount: '1' }], {
        referenceDate: d('2026-01-01'),
        referenceRent: '0',
        changes: [],
      }),
    ).toThrow(FeeEngineError);
  });
});

describe('fee-engine: renovación, venta y tasación', () => {
  it('golden: renovación de 12 meses al 5 %', () => {
    const total = contractTotal({
      startDate: d('2028-03-01'),
      endDate: d('2029-02-28'),
      initialRent: '900000',
      rule: IPC_RULE,
      mode: ContractTotalMode.ConAjustesConocidos,
    }).total;
    expect(total.toFixed(2)).toBe('10800000.00');
    expect(pctOf(total, defaultFeePct(FeeKind.Renovacion, DEFAULT_OPERATIONAL_DEFAULTS)!).toFixed(2)).toBe('540000.00');
  });

  it('golden: venta, cada parte paga su porcentaje sobre el valor real', () => {
    const construido = defaultFeePct(FeeKind.Venta, DEFAULT_OPERATIONAL_DEFAULTS, SaleAsset.Construido)!;
    const lote = defaultFeePct(FeeKind.Venta, DEFAULT_OPERATIONAL_DEFAULTS, SaleAsset.Lote)!;
    expect([construido, lote]).toEqual([3, 5]);
    const comprador = feeAmounts(pctOf('120000', construido), FeeVatMode.NoAplica);
    const vendedor = feeAmounts(pctOf('120000', construido), FeeVatMode.NoAplica);
    expect([comprador.total.toFixed(2), vendedor.total.toFixed(2)]).toEqual(['3600.00', '3600.00']);
    expect(pctOf('45000', lote).toFixed(2)).toBe('2250.00');
  });

  it('golden: tasación USD 100 en una cuota, o sin cargo', () => {
    expect(defaultFeePct(FeeKind.Tasacion, DEFAULT_OPERATIONAL_DEFAULTS)).toBeNull();
    const fee = feeAmounts(DEFAULT_OPERATIONAL_DEFAULTS.valuationUsd, FeeVatMode.NoAplica);
    expect(feeInstallments(fee.total, 1, d('2026-11-02')).map((p) => p.amount.toFixed(2))).toEqual(['100.00']);
    expect(feeInstallments(feeAmounts(0, FeeVatMode.NoAplica).total, 1, d('2026-11-02'))).toEqual([]);
  });

  it('alta usa el porcentaje de alta; gestión de reparación no tiene porcentaje', () => {
    expect(defaultFeePct(FeeKind.AltaAlquiler, DEFAULT_OPERATIONAL_DEFAULTS)).toBe(5);
    expect(defaultFeePct(FeeKind.GestionReparacion, DEFAULT_OPERATIONAL_DEFAULTS)).toBeNull();
  });
});

describe('fee-engine: coorretaje y comisión del personal', () => {
  it('golden: venta compartida al 50 % y comisión del 10 % sobre el neto de la inmobiliaria', () => {
    const r = distributeFee({ net: '3600', sharesPct: [50], staffPct: [10], staffBase: StaffCommissionBase.Neto });
    expect(s(r.shares)).toEqual(['1800.00']);
    expect(r.agencyNet.toFixed(2)).toBe('1800.00');
    expect(r.staffBase.toFixed(2)).toBe('1800.00');
    expect(s(r.staff)).toEqual(['180.00']);
    expect(r.agencyKeeps.toFixed(2)).toBe('1620.00');
  });

  it('con base bruta la comisión se calcula antes del coorretaje', () => {
    const r = distributeFee({ net: '3600', sharesPct: [50], staffPct: [10, 5], staffBase: StaffCommissionBase.Bruto });
    expect(s(r.staff)).toEqual(['360.00', '180.00']);
    expect(r.agencyKeeps.toFixed(2)).toBe('1260.00');
  });

  it('sin coorretaje ni personal la inmobiliaria se queda con todo', () => {
    const r = distributeFee({ net: '600000', sharesPct: [], staffPct: [], staffBase: StaffCommissionBase.Neto });
    expect(r.agencyKeeps.toFixed(2)).toBe('600000.00');
  });

  it('rechaza porcentajes que pasan de 100 o negativos', () => {
    expect(() => distributeFee({ net: '1', sharesPct: [60, 50], staffPct: [], staffBase: StaffCommissionBase.Neto })).toThrow(
      FeeEngineError,
    );
    expect(() => distributeFee({ net: '1', sharesPct: [-1], staffPct: [], staffBase: StaffCommissionBase.Neto })).toThrow(FeeEngineError);
    expect(() => distributeFee({ net: '1', sharesPct: [], staffPct: [101], staffBase: StaffCommissionBase.Neto })).toThrow(
      FeeEngineError,
    );
    expect(() => distributeFee({ net: '1', sharesPct: [], staffPct: [-2], staffBase: StaffCommissionBase.Neto })).toThrow(
      FeeEngineError,
    );
  });
});
