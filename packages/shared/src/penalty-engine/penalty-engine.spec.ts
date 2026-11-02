import { accruePenalty, daysOverdueBetween, type PenaltyRule } from './index';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const fixed: PenaltyRule = { mode: 'daily_fixed', value: '10', graceDays: 0, maxMultiplier: '2' };
const pct: PenaltyRule = { mode: 'daily_percent', value: '0.01', graceDays: 0, maxMultiplier: '2' };
const compound: PenaltyRule = { mode: 'compound_percent', value: '0.01', graceDays: 0, maxMultiplier: '2' };
const maxBna: PenaltyRule = { mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '3' };

function accrue(rule: PenaltyRule, over: Partial<Parameters<typeof accruePenalty>[0]> = {}) {
  return accruePenalty({ dueDate: d('2026-01-01'), asOf: d('2026-01-11'), total: '1000', rule, ...over });
}

describe('daysOverdueBetween', () => {
  it('cuenta días enteros del calendario UTC y no baja de cero', () => {
    expect(daysOverdueBetween(d('2026-01-01'), d('2026-01-11'))).toBe(10);
    expect(daysOverdueBetween(d('2026-01-01'), new Date('2026-01-11T23:59:59Z'))).toBe(10);
    expect(daysOverdueBetween(d('2026-01-11'), d('2026-01-01'))).toBe(0);
  });
});

describe('accruePenalty: modos clásicos (mismos resultados que el cálculo anterior)', () => {
  it('daily_fixed: 10 días por 10', () => {
    const r = accrue(fixed);
    expect(r.amount.toFixed(2)).toBe('100.00');
    expect(r.daysOverdue).toBe(10);
    expect(r.accruingDays).toBe(10);
    expect(r.capHit).toBe(false);
  });

  it('no devenga el día del vencimiento ni antes', () => {
    expect(accrue(fixed, { asOf: d('2026-01-01') }).amount.toFixed(2)).toBe('0.00');
    expect(accrue(fixed, { asOf: d('2025-12-31') }).daysOverdue).toBe(0);
  });

  it('gracia: 10 días de mora con 3 de gracia devengan 7', () => {
    const r = accrue({ ...fixed, graceDays: 3 });
    expect(r.amount.toFixed(2)).toBe('70.00');
    expect(r.daysOverdue).toBe(10);
    expect(r.accruingDays).toBe(7);
  });

  it('dentro de la gracia no devenga', () => {
    expect(accrue({ ...fixed, graceDays: 10 }).amount.toFixed(2)).toBe('0.00');
  });

  it('daily_percent: 1000 x 1 % x 10 días', () => {
    expect(accrue(pct).amount.toFixed(2)).toBe('100.00');
  });

  it('compound_percent: 1000 x (1,01^10 - 1)', () => {
    expect(accrue(compound).amount.toFixed(2)).toBe('104.62');
  });

  it('el tope es (múltiplo - 1) por el saldo y marca capHit', () => {
    const r = accrue({ ...fixed, maxMultiplier: '1.05' });
    expect(r.amount.toFixed(2)).toBe('50.00');
    expect(r.capHit).toBe(true);
  });

  it('un múltiplo menor que 1 no aplica tope', () => {
    const r = accrue({ ...fixed, maxMultiplier: '0.5' });
    expect(r.amount.toFixed(2)).toBe('100.00');
    expect(r.capHit).toBe(false);
  });

  it('con tope exacto no marca capHit', () => {
    expect(accrue({ ...fixed, maxMultiplier: '1.1' }).capHit).toBe(false);
  });

  it('redondea el total una sola vez, mitad hacia arriba', () => {
    const half = accrue({ ...fixed, value: '0.005' }, { asOf: d('2026-01-02') });
    expect(half.amount.toFixed(2)).toBe('0.01');
    // 3 x 0,004 = 0,012 -> 0,01 (no 3 x 0,00)
    const sum = accrue({ ...fixed, value: '0.004' }, { asOf: d('2026-01-04') });
    expect(sum.amount.toFixed(2)).toBe('0.01');
  });
});

describe('accruePenalty: pagos parciales y saldo', () => {
  it('la base de cada día es el saldo al comenzar ese día', () => {
    // Días 2 a 6 sobre 1000 (50) y 7 a 11 sobre 600 (30).
    const r = accrue(pct, { payments: [{ date: d('2026-01-06'), amount: '400' }] });
    expect(r.amount.toFixed(2)).toBe('80.00');
    expect(r.accruingDays).toBe(10);
  });

  it('un pago del mismo día no baja la base de ese día', () => {
    const sameDay = accrue(pct, { asOf: d('2026-01-06'), payments: [{ date: d('2026-01-06'), amount: '400' }] });
    expect(sameDay.amount.toFixed(2)).toBe('50.00');
  });

  it('un pago total corta el devengo', () => {
    const r = accrue(pct, { payments: [{ date: d('2026-01-04'), amount: '1000' }] });
    expect(r.amount.toFixed(2)).toBe('30.00');
    expect(r.accruingDays).toBe(3);
  });

  it('daily_fixed no devenga los días sin saldo', () => {
    const r = accrue(fixed, { payments: [{ date: d('2026-01-04'), amount: '1000' }] });
    expect(r.amount.toFixed(2)).toBe('30.00');
  });

  it('sin saldo desde el principio no hay punitorio ni tope', () => {
    const r = accrue(pct, { total: '0' });
    expect(r.amount.toFixed(2)).toBe('0.00');
    expect(r.baseAtStart.toFixed(2)).toBe('0.00');
  });

  it('compuesto con pago parcial capitaliza sobre el saldo de cada día', () => {
    const r = accrue(compound, { asOf: d('2026-01-03'), payments: [{ date: d('2026-01-02'), amount: '500' }] });
    // día 2: 1000 x 1 % = 10; día 3: (500 + 10) x 1 % = 5,10
    expect(r.amount.toFixed(2)).toBe('15.10');
  });

  it('acepta pagos desordenados', () => {
    const r = accrue(pct, {
      payments: [
        { date: d('2026-01-08'), amount: '100' },
        { date: d('2026-01-06'), amount: '400' },
      ],
    });
    // 5 días a 10, días 7 y 8 a 6, días 9 a 11 a 5
    expect(r.amount.toFixed(2)).toBe('77.00');
  });
});

describe('accruePenalty: max_bna_or_daily', () => {
  it('con TNA alta rige 2 x TNA / 365', () => {
    const r = accrue(maxBna, { bnaRates: [{ from: d('2026-01-01'), annualPct: '100' }] });
    // 1000 x 2 x 1 / 365 x 10 días = 54,7945...
    expect(r.amount.toFixed(2)).toBe('54.79');
    expect(r.bnaDays).toBe(10);
    expect(r.floorDays).toBe(0);
  });

  it('con TNA baja rige el piso de 0,3 % diario', () => {
    const r = accrue(maxBna, { bnaRates: [{ from: d('2026-01-01'), annualPct: '40' }] });
    expect(r.amount.toFixed(2)).toBe('30.00');
    expect(r.floorDays).toBe(10);
    expect(r.bnaDays).toBe(0);
  });

  it('cruce: 54,75 % de TNA empata con el piso y 54,76 % lo supera', () => {
    const tie = accrue(maxBna, { bnaRates: [{ from: d('2026-01-01'), annualPct: '54.75' }] });
    expect(tie.amount.toFixed(2)).toBe('30.00');
    expect(tie.floorDays).toBe(10);
    const above = accrue(maxBna, { bnaRates: [{ from: d('2026-01-01'), annualPct: '54.76' }] });
    expect(above.bnaDays).toBe(10);
    expect(above.amount.toFixed(2)).toBe('30.01');
  });

  it('cambia de tasa a mitad de la mora según el mes de cada día', () => {
    const r = accrue(maxBna, {
      dueDate: d('2026-02-25'),
      asOf: d('2026-03-06'),
      bnaRates: [
        { from: d('2026-02-01'), annualPct: '100' },
        { from: d('2026-03-01'), annualPct: '40' },
      ],
    });
    // 26, 27 y 28 de febrero: 3 x 5,4795; 1 a 6 de marzo: 6 x 3,00
    expect(r.amount.toFixed(2)).toBe('34.44');
    expect(r.bnaDays).toBe(3);
    expect(r.floorDays).toBe(6);
  });

  it('un mes sin dato usa el último publicado', () => {
    const r = accrue(maxBna, {
      dueDate: d('2026-02-25'),
      asOf: d('2026-03-06'),
      bnaRates: [{ from: d('2026-02-01'), annualPct: '100' }],
    });
    expect(r.bnaDays).toBe(9);
    expect(r.daysWithoutRate).toBe(0);
  });

  it('sin ninguna tasa rige el piso y se informa', () => {
    const r = accrue(maxBna);
    expect(r.amount.toFixed(2)).toBe('30.00');
    expect(r.daysWithoutRate).toBe(10);
  });

  it('una tasa posterior a la mora no se usa', () => {
    const r = accrue(maxBna, { bnaRates: [{ from: d('2026-03-01'), annualPct: '100' }] });
    expect(r.daysWithoutRate).toBe(10);
  });

  it('el múltiplo y los días del año son configurables', () => {
    const r = accrue(
      { ...maxBna, value: '0.0001', bnaMultiplier: '3', yearDays: 360 },
      { bnaRates: [{ from: d('2026-01-01'), annualPct: '36' }] },
    );
    // 3 x 0,36 / 360 = 0,003 diario; 10 días sobre 1000
    expect(r.amount.toFixed(2)).toBe('30.00');
  });

  it('con pago parcial la base de cada día baja', () => {
    const r = accrue(maxBna, {
      bnaRates: [{ from: d('2026-01-01'), annualPct: '40' }],
      payments: [{ date: d('2026-01-06'), amount: '500' }],
    });
    // 5 días x 3,00 + 5 días x 1,50
    expect(r.amount.toFixed(2)).toBe('22.50');
  });

  it('respeta la gracia y el tope', () => {
    const graced = accrue({ ...maxBna, graceDays: 4 }, { bnaRates: [{ from: d('2026-01-01'), annualPct: '40' }] });
    expect(graced.amount.toFixed(2)).toBe('18.00');
    const capped = accrue(
      { ...maxBna, maxMultiplier: '1.02' },
      { bnaRates: [{ from: d('2026-01-01'), annualPct: '40' }] },
    );
    expect(capped.amount.toFixed(2)).toBe('20.00');
    expect(capped.capHit).toBe(true);
  });
});
