import {
  findInvalidShareDates,
  isLessorActiveAt,
  pctToUnits,
  splitEqualPct,
} from './lessor-shares';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('splitEqualPct', () => {
  it('un locador cobra el 100 %', () => {
    expect(splitEqualPct(1)).toEqual(['100.0000']);
  });

  it('el último lleva el resto y la suma es exactamente 100', () => {
    const parts = splitEqualPct(3);
    expect(parts).toEqual(['33.3333', '33.3333', '33.3334']);
    expect(parts.reduce((a, p) => a + pctToUnits(p), 0)).toBe(1_000_000);
  });

  it('reparte bien con otros divisores', () => {
    for (const n of [2, 4, 6, 7, 9, 11]) {
      expect(splitEqualPct(n).reduce((a, p) => a + pctToUnits(p), 0)).toBe(1_000_000);
    }
  });

  it('rechaza cantidades inválidas', () => {
    expect(() => splitEqualPct(0)).toThrow();
  });
});

describe('isLessorActiveAt', () => {
  it('incluye el inicio y excluye el fin', () => {
    const row = { validFrom: d('2026-01-01'), validTo: d('2026-06-01') };
    expect(isLessorActiveAt(row, d('2026-01-01'))).toBe(true);
    expect(isLessorActiveAt(row, d('2026-05-31'))).toBe(true);
    expect(isLessorActiveAt(row, d('2026-06-01'))).toBe(false);
    expect(isLessorActiveAt(row, d('2025-12-31'))).toBe(false);
  });
});

describe('findInvalidShareDates', () => {
  const from = d('2026-01-01');
  const to = d('2028-01-01');

  it('no informa nada cuando suman 100 todo el contrato', () => {
    const rows = [
      { payoutPct: '60', validFrom: from, validTo: null },
      { payoutPct: '40.0000', validFrom: from, validTo: null },
    ];
    expect(findInvalidShareDates(rows, from, to)).toEqual([]);
  });

  it('informa la suma cuando no llega a 100', () => {
    const rows = [{ payoutPct: '99.9999', validFrom: from, validTo: null }];
    expect(findInvalidShareDates(rows, from, to)).toEqual([{ date: from, sum: '99.9999' }]);
  });

  it('detecta un hueco cuando un locador sale sin reemplazo', () => {
    const rows = [{ payoutPct: '100', validFrom: from, validTo: d('2026-07-01') }];
    expect(findInvalidShareDates(rows, from, to)).toEqual([
      { date: d('2026-07-01'), sum: '0.0000' },
    ]);
  });

  it('acepta una cesión que cambia de locador sin pisarse', () => {
    const rows = [
      { payoutPct: '100', validFrom: from, validTo: d('2026-07-01') },
      { payoutPct: '100', validFrom: d('2026-07-01'), validTo: null },
    ];
    expect(findInvalidShareDates(rows, from, to)).toEqual([]);
  });

  it('detecta el exceso cuando dos locadores se pisan', () => {
    const rows = [
      { payoutPct: '100', validFrom: from, validTo: null },
      { payoutPct: '50', validFrom: d('2026-03-01'), validTo: null },
    ];
    expect(findInvalidShareDates(rows, from, to)).toEqual([
      { date: d('2026-03-01'), sum: '150.0000' },
    ]);
  });
});
