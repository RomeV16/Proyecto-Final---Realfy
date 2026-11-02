import { planDepositApplication } from './deposit-application';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const liqs = [
  { id: 'b', dueDate: utc(2026, 2, 10) },
  { id: 'a', dueDate: utc(2026, 1, 10) },
];

const item = (kind: string, amount: string, sourceId: string, included = true) => ({
  kind: kind as any,
  description: kind,
  amount,
  included,
  sourceType: 'Liquidacion',
  sourceId,
});

describe('planDepositApplication', () => {
  it('aplica de la más antigua a la más nueva y suma el punitorio si todo alcanza', () => {
    const plan = planDepositApplication(
      [item('AlquilerPendiente', '50000', 'b'), item('AlquilerPendiente', '60000', 'a'), item('Punitorio', '1000', 'a')],
      '200000',
      liqs,
    );
    expect(plan.steps.map((s) => [s.liquidacionId, s.amount.toFixed(2), s.settlePenalties])).toEqual([
      ['a', '61000.00', true],
      ['b', '50000.00', false],
    ]);
    expect(plan.applied.toFixed(2)).toBe('111000.00');
    expect(plan.uncovered.toFixed(2)).toBe('0.00');
  });

  it('un depósito que no alcanza paga la más antigua y deja el resto sin cubrir', () => {
    const plan = planDepositApplication([item('AlquilerPendiente', '60000', 'a'), item('AlquilerPendiente', '50000', 'b')], '80000', liqs);
    expect(plan.steps.map((s) => s.amount.toFixed(2))).toEqual(['60000.00', '20000.00']);
    expect(plan.uncovered.toFixed(2)).toBe('30000.00');
  });

  it('sin saldo para el punitorio paga solo el alquiler y el punitorio queda sin cubrir', () => {
    const plan = planDepositApplication([item('AlquilerPendiente', '60000', 'a'), item('Punitorio', '1000', 'a')], '60500', liqs);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].amount.toFixed(2)).toBe('60000.00');
    expect(plan.steps[0].settlePenalties).toBe(false);
    expect(plan.uncovered.toFixed(2)).toBe('1000.00');
  });

  it('ignora los renglones destildados y los que no son de una liquidación', () => {
    const plan = planDepositApplication(
      [item('AlquilerPendiente', '60000', 'a', false), { kind: 'Deduccion' as any, description: 'x', amount: '5', included: true }],
      '100000',
      liqs,
    );
    expect(plan.steps).toEqual([]);
    expect(plan.applied.toFixed(2)).toBe('0.00');
  });

  it('un punitorio sin su alquiler no se aplica y queda sin cubrir', () => {
    const plan = planDepositApplication([item('Punitorio', '1000', 'a')], '100000', liqs);
    expect(plan.steps).toEqual([]);
    expect(plan.uncovered.toFixed(2)).toBe('1000.00');
  });

  it('sin depósito disponible no aplica nada', () => {
    const plan = planDepositApplication([item('AlquilerPendiente', '60000', 'a')], '0', liqs);
    expect(plan.steps).toEqual([]);
    expect(plan.uncovered.toFixed(2)).toBe('60000.00');
  });
});
