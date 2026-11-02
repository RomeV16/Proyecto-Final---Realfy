import { DepositRefundRule, DepositStatus } from '../enums';
import {
  MoveOutItemKind,
  computeMoveOut,
  depositRefundAmount,
  depositSchedule,
  depositStatusFor,
  refundDueDate,
  refundSchedule,
  rentAt,
  updatedDepositFactor,
} from './index';
import type { MoveOutItem, RentStep } from './index';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const STEPS: RentStep[] = [
  { date: d('2024-03-01'), amount: '100000' },
  { date: d('2024-09-01'), amount: '130000' },
  { date: d('2025-03-01'), amount: '182000' },
];

const item = (kind: MoveOutItemKind, amount: string, included = true): MoveOutItem => ({
  kind,
  description: kind,
  amount,
  included,
});

describe('rentAt y factor de actualización', () => {
  it('toma el escalón vigente en la fecha', () => {
    expect(rentAt(STEPS, d('2024-03-01')).toFixed(2)).toBe('100000.00');
    expect(rentAt(STEPS, d('2024-08-31')).toFixed(2)).toBe('100000.00');
    expect(rentAt(STEPS, d('2024-09-01')).toFixed(2)).toBe('130000.00');
    expect(rentAt(STEPS, d('2026-01-01')).toFixed(2)).toBe('182000.00');
  });

  it('antes del primer escalón usa el primero', () => {
    expect(rentAt(STEPS, d('2023-01-01')).toFixed(2)).toBe('100000.00');
  });

  it('no depende del orden de los escalones', () => {
    expect(rentAt([...STEPS].reverse(), d('2025-04-01')).toFixed(2)).toBe('182000.00');
  });

  it('sin escalones es un error', () => {
    expect(() => rentAt([], d('2025-01-01'))).toThrow();
  });

  it('el factor es el alquiler final sobre el inicial', () => {
    expect(updatedDepositFactor(STEPS, d('2024-03-01'), d('2025-05-01')).toFixed(4)).toBe('1.8200');
  });

  it('un alquiler de referencia en cero es un error', () => {
    expect(() => updatedDepositFactor([{ date: d('2024-01-01'), amount: '0' }], d('2024-01-01'), d('2025-01-01'))).toThrow();
  });
});

describe('importe a devolver', () => {
  it('misma moneda: el nominal, aunque el alquiler haya subido', () => {
    const r = depositRefundAmount({
      amount: '100000',
      refundRule: DepositRefundRule.MismaMoneda,
      rentSteps: STEPS,
      depositDate: d('2024-03-01'),
      refundDate: d('2025-06-01'),
    });
    expect(r.toFixed(2)).toBe('100000.00');
  });

  it('depósito en dólares: se devuelve igual', () => {
    const r = depositRefundAmount({
      amount: '1500',
      refundRule: DepositRefundRule.MismaMoneda,
      depositDate: d('2024-03-01'),
      refundDate: d('2026-03-01'),
    });
    expect(r.toFixed(2)).toBe('1500.00');
  });

  it('pesos actualizado: sigue los ajustes del alquiler', () => {
    const r = depositRefundAmount({
      amount: '100000',
      refundRule: DepositRefundRule.PesosActualizado,
      rentSteps: STEPS,
      depositDate: d('2024-03-01'),
      refundDate: d('2025-06-01'),
    });
    expect(r.toFixed(2)).toBe('182000.00');
  });

  it('pesos actualizado entre dos ajustes: solo el primero', () => {
    const r = depositRefundAmount({
      amount: '100000',
      refundRule: DepositRefundRule.PesosActualizado,
      rentSteps: STEPS,
      depositDate: d('2024-03-01'),
      refundDate: d('2025-02-28'),
    });
    expect(r.toFixed(2)).toBe('130000.00');
  });

  it('pesos actualizado redondea a centavos', () => {
    const r = depositRefundAmount({
      amount: '100000',
      refundRule: DepositRefundRule.PesosActualizado,
      rentSteps: [
        { date: d('2024-01-01'), amount: '300000' },
        { date: d('2024-07-01'), amount: '333333' },
      ],
      depositDate: d('2024-01-01'),
      refundDate: d('2024-08-01'),
    });
    expect(r.toFixed(2)).toBe('111111.00');
  });

  it('un alquiler que baja no achica el depósito', () => {
    const r = depositRefundAmount({
      amount: '100000',
      refundRule: DepositRefundRule.PesosActualizado,
      rentSteps: [
        { date: d('2024-01-01'), amount: '200000' },
        { date: d('2024-07-01'), amount: '150000' },
      ],
      depositDate: d('2024-01-01'),
      refundDate: d('2024-08-01'),
    });
    expect(r.toFixed(2)).toBe('100000.00');
  });
});

describe('cuotas, estado y plazos', () => {
  it('reparte el depósito en cuotas mensuales que suman el total', () => {
    const rows = depositSchedule('100000.01', 3, d('2024-01-31'));
    expect(rows.map((r) => r.amount)).toEqual(['33333.34', '33333.34', '33333.33']);
    expect(rows.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3]);
  });

  it('el estado sigue lo cobrado y lo devuelto', () => {
    expect(depositStatusFor({ amount: '100', collected: '0' })).toBe(DepositStatus.Pendiente);
    expect(depositStatusFor({ amount: '100', collected: '40' })).toBe(DepositStatus.Parcial);
    expect(depositStatusFor({ amount: '100', collected: '100' })).toBe(DepositStatus.Cobrado);
    expect(depositStatusFor({ amount: '100', collected: '100', refundedAt: d('2025-01-01') })).toBe(DepositStatus.Devuelto);
  });

  it('el plazo de devolución cuenta días corridos desde el egreso', () => {
    expect(refundDueDate(d('2025-01-20'), 30).toISOString().slice(0, 10)).toBe('2025-02-19');
    expect(refundDueDate(d('2025-01-20'), 0).toISOString().slice(0, 10)).toBe('2025-01-20');
  });

  it('la devolución en cuotas suma el total', () => {
    const rows = refundSchedule('1000.00', 3, d('2025-02-19'));
    expect(rows.map((r) => r.amount)).toEqual(['333.34', '333.33', '333.33']);
  });
});

describe('liquidación de egreso', () => {
  it('sin deudas se devuelve todo el depósito', () => {
    const r = computeMoveOut({ items: [], refundable: '182000' });
    expect(r.refundToTenant.toFixed(2)).toBe('182000.00');
    expect(r.owedByTenant.toFixed(2)).toBe('0.00');
    expect(r.retained.toFixed(2)).toBe('0.00');
  });

  it('suma cada tipo de renglón y devuelve la diferencia', () => {
    const r = computeMoveOut({
      refundable: '182000',
      items: [
        item(MoveOutItemKind.AlquilerPendiente, '30000.50'),
        item(MoveOutItemKind.Servicio, '4500.25'),
        item(MoveOutItemKind.Cargo, '1200'),
        item(MoveOutItemKind.Reparacion, '8000'),
        item(MoveOutItemKind.Punitorio, '999.25'),
        item(MoveOutItemKind.Deduccion, '15000'),
      ],
    });
    expect(r.totalOwed.toFixed(2)).toBe('59700.00');
    expect(r.refundToTenant.toFixed(2)).toBe('122300.00');
    expect(r.retained.toFixed(2)).toBe('59700.00');
    expect(r.net.toFixed(2)).toBe('122300.00');
  });

  it('un renglón destildado no cuenta', () => {
    const r = computeMoveOut({
      refundable: '100000',
      items: [item(MoveOutItemKind.Deduccion, '20000'), item(MoveOutItemKind.Reparacion, '50000', false)],
    });
    expect(r.totalOwed.toFixed(2)).toBe('20000.00');
    expect(r.refundToTenant.toFixed(2)).toBe('80000.00');
  });

  it('si la deuda supera al depósito el inquilino debe la diferencia', () => {
    const r = computeMoveOut({
      refundable: '100000',
      items: [item(MoveOutItemKind.AlquilerPendiente, '130000')],
    });
    expect(r.refundToTenant.toFixed(2)).toBe('0.00');
    expect(r.owedByTenant.toFixed(2)).toBe('30000.00');
    expect(r.retained.toFixed(2)).toBe('100000.00');
    expect(r.net.toFixed(2)).toBe('-30000.00');
  });

  it('un crédito a favor del inquilino aumenta lo que se devuelve', () => {
    const r = computeMoveOut({
      refundable: '100000',
      items: [item(MoveOutItemKind.Cargo, '-5000')],
    });
    expect(r.totalOwed.toFixed(2)).toBe('-5000.00');
    expect(r.refundToTenant.toFixed(2)).toBe('105000.00');
    expect(r.retained.toFixed(2)).toBe('0.00');
  });

  it('con cuotas sin cobrar solo se devuelve lo cobrado', () => {
    const r = computeMoveOut({
      refundable: '100000',
      collectedShare: '0.5',
      items: [item(MoveOutItemKind.Deduccion, '10000')],
    });
    expect(r.depositAvailable.toFixed(2)).toBe('50000.00');
    expect(r.refundToTenant.toFixed(2)).toBe('40000.00');
  });

  it('la parte cobrada se acota entre 0 y 1', () => {
    expect(computeMoveOut({ items: [], refundable: '100', collectedShare: '2' }).depositAvailable.toFixed(2)).toBe('100.00');
    expect(computeMoveOut({ items: [], refundable: '100', collectedShare: '-1' }).depositAvailable.toFixed(2)).toBe('0.00');
  });

  it('un depósito cobrado a medias con deuda mayor deja saldo a cobrar', () => {
    const r = computeMoveOut({
      refundable: '100000',
      collectedShare: '0.5',
      items: [item(MoveOutItemKind.Servicio, '70000')],
    });
    expect(r.owedByTenant.toFixed(2)).toBe('20000.00');
  });
});
