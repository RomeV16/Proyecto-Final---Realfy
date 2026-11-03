import { AdjustmentPeriod, AdjustmentType, LineBeneficiary, LineItemType } from '../enums';
import { RECONCILIATION_CYCLE } from './characterization.fixture';
import { compareReconciliation, contractConcepts, formatDifferences, statementConcepts, statementKey } from './format';
import { runCycle, type CycleContract, type CycleInput } from './cycle';

const L = LineItemType;
const B = LineBeneficiary;

describe('reconciliación — conceptos de un recibo (CP-665)', () => {
  it('agrupa por concepto y destino, omite los ceros y suma lo de cada locador entre cobros', () => {
    const concepts = contractConcepts({
      lines: [
        { type: L.Alquiler, amount: '100000', beneficiary: B.Locador },
        { type: L.AjusteRetroactivo, amount: '1500', beneficiary: B.Locador },
        { type: L.Descuento, amount: '-5000', beneficiary: B.Locador },
        { type: L.Servicio, amount: '700.10', beneficiary: B.Ente },
        { type: L.Impuesto, amount: '300', beneficiary: B.Ente },
        { type: L.Honorario, amount: '2000', beneficiary: B.Inmobiliaria },
        { type: L.Multa, amount: '0', beneficiary: B.Locador },
      ],
      total: '99500.10',
      rent: { monthly: '100000', adjustmentPct: '4.12345' },
      buckets: { commission: '6755', lessors: '89745' },
      payments: [
        { amount: '50000', shares: [{ lessor: 'A', share: '20000' }, { lessor: 'B', share: '25000' }] },
        { amount: '49500.10', shares: [{ lessor: 'A', share: '20000' }, { lessor: 'B', share: '24745' }] },
      ],
    });
    expect(concepts).toEqual({
      'alquiler-mensual': '100000.00',
      'ajuste-pct': '4.1235',
      alquiler: '100000.00',
      'ajuste-retroactivo': '1500.00',
      descuentos: '5000.00',
      'impuestos-y-servicios:Ente': '1000.10',
      'cargos:Inmobiliaria': '2000.00',
      total: '99500.10',
      comision: '6755.00',
      'neto-locadores': '89745.00',
      cobrado: '99500.10',
      'neto:A': '40000.00',
      'neto:B': '49745.00',
    });
    // El orden de las claves es el de lectura del recibo.
    expect(Object.keys(concepts).slice(0, 3)).toEqual(['alquiler-mensual', 'ajuste-pct', 'alquiler']);
  });

  it('sin reparto ni cobros, solo los renglones y el total', () => {
    expect(contractConcepts({ lines: [{ type: L.Alquiler, amount: '10', beneficiary: B.Locador }], total: '10' })).toEqual({
      alquiler: '10.00',
      total: '10.00',
    });
  });

  it('los totales de un estado de cuenta van al centavo', () => {
    expect(statementConcepts({ opening: '-1', credits: '2.005', debits: 0, payouts: '3', closing: '-1.99' })).toEqual({
      apertura: '-1.00',
      creditos: '2.01',
      debitos: '0.00',
      pagos: '3.00',
      cierre: '-1.99',
    });
    expect(statementKey('L1', 'USD')).toBe('L1 USD');
  });
});

describe('reconciliación — comparador con tolerancia cero (CP-664)', () => {
  const base = {
    period: '2026-07',
    contracts: { C1: { total: '100.00', 'ajuste-pct': '5.0000' } },
    statements: { 'L1 ARS': { cierre: '10.00' } },
  };

  it('un mismo importe escrito distinto no es diferencia; lo que falta de un lado sí', () => {
    const actual = {
      period: '2026-07',
      contracts: { C1: { total: '100', 'ajuste-pct': '5' }, C2: { total: '1.00' } },
      statements: {},
    };
    expect(compareReconciliation(base, actual)).toEqual([
      { scope: 'contrato', key: 'C2', concept: 'total', expected: null, actual: '1.00' },
      { scope: 'estado', key: 'L1 ARS', concept: 'cierre', expected: '10.00', actual: null },
    ]);
  });

  it('un período distinto y un concepto que no es número también se informan', () => {
    const differences = compareReconciliation(
      { ...base, contracts: { C1: { ...base.contracts.C1, moneda: 'ARS' } } },
      { ...base, period: '2026-08', contracts: { C1: { ...base.contracts.C1, moneda: 'USD' } } },
    );
    expect(differences.map((d) => [d.key, d.concept, d.expected, d.actual])).toEqual([
      ['*', 'periodo', '2026-07', '2026-08'],
      ['C1', 'moneda', 'ARS', 'USD'],
    ]);
    expect(formatDifferences(differences)).toBe(
      'contrato * periodo: esperado 2026-07, obtenido 2026-08\ncontrato C1 moneda: esperado ARS, obtenido USD',
    );
    expect(formatDifferences(compareReconciliation(base, base))).toBe('');
  });
});

describe('reconciliación — entrada del ciclo inconsistente (CP-665)', () => {
  const one = (contract: Partial<CycleContract>, extra: Partial<CycleInput> = {}): CycleInput => ({
    ...RECONCILIATION_CYCLE,
    contracts: [{ ...RECONCILIATION_CYCLE.contracts[2], ...contract }],
    bills: [],
    charges: [],
    payments: [],
    compensations: [],
    payouts: [],
    openingBalances: [],
    ...extra,
  });

  it('un índice que falta, una modalidad no prevista o un contrato que no liquida el mes cortan con un mensaje', () => {
    const ipc = { type: AdjustmentType.IPC, period: AdjustmentPeriod.Trimestral, lagMonths: 2 };
    expect(() => runCycle(one({ adjustment: ipc, adjustments: [{ date: '2026-04-01', ipcMonths: ['2025-12'] }] }))).toThrow(
      'Falta el valor de IPC de 2025-12',
    );
    expect(() =>
      runCycle(one({ adjustment: { ...ipc, type: AdjustmentType.CCP }, adjustments: [{ date: '2026-04-01' }] })),
    ).toThrow('Modalidad de ajuste no prevista');
    expect(() => runCycle(one({ start: '2026-09-01' }))).toThrow('no liquida 2026-07: BeforeStart');
  });

  it('un cobro, una compensación o un cargo que nombran algo que no existe cortan con un mensaje', () => {
    expect(() => runCycle(one({}, { compensations: [{ payment: 'PX', from: 'L1', to: 'L2' }] }))).toThrow('Cobro desconocido: PX');
    const payments = [{ key: 'P1', contract: 'C03', date: '2026-07-07', amount: '318000.00', method: 'Efectivo' as const }];
    expect(() => runCycle(one({}, { payments, compensations: [{ payment: 'P1', from: 'L2', to: 'L9' }] }))).toThrow(
      'L9 no tiene parte en el cobro P1',
    );
    const charge = { ...RECONCILIATION_CYCLE.charges[0], contract: 'C99' };
    expect(() => runCycle(one({}, { charges: [charge] }))).toThrow('Contrato desconocido: C99');
  });

  it('una compensación con importe usa ese importe', () => {
    const payments = [
      { key: 'P1', contract: 'C03', date: '2026-07-07', amount: '330000.00', method: 'Transferencia' as const, receivedBy: 'Locador' as never },
    ];
    const result = runCycle(one({}, { payments, compensations: [{ payment: 'P1', from: 'L2', to: 'L1', amount: '1000' }] }));
    expect(result.statements['L2 ARS']).toMatchObject({ debitos: '1000.00', cierre: '-1000.00' });
  });
});
