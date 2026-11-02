import { rentStepsOf } from './deposit-rent';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const adj = (periodNumber: number, date: Date, previous: string, next: string, over: Partial<{ appliedAt: Date | null; isProvisional: boolean }> = {}) => ({
  periodNumber,
  adjustmentDate: date,
  previousAmount: previous,
  newAmount: next,
  appliedAt: utc(2025, 1, 1),
  isProvisional: false,
  ...over,
});

describe('rentStepsOf', () => {
  const contract = { startDate: utc(2024, 3, 1), rentAmount: '182000' };

  it('sin ajustes el alquiler actual rige desde el inicio', () => {
    expect(rentStepsOf(contract, [])).toEqual([{ date: utc(2024, 3, 1), amount: '182000' }]);
  });

  it('el escalón inicial es el alquiler previo al primer ajuste', () => {
    const steps = rentStepsOf(contract, [
      adj(2, utc(2025, 3, 1), '130000', '182000'),
      adj(1, utc(2024, 9, 1), '100000', '130000'),
    ]);
    expect(steps).toEqual([
      { date: utc(2024, 3, 1), amount: '100000' },
      { date: utc(2024, 9, 1), amount: '130000' },
      { date: utc(2025, 3, 1), amount: '182000' },
    ]);
  });

  it('ignora los ajustes que no se aplicaron', () => {
    const steps = rentStepsOf(contract, [adj(1, utc(2024, 9, 1), '100000', '130000', { appliedAt: null })]);
    expect(steps).toEqual([{ date: utc(2024, 3, 1), amount: '182000' }]);
  });

  it('de un provisorio y su corrección vale la corrección', () => {
    const steps = rentStepsOf(contract, [
      adj(1, utc(2024, 9, 1), '100000', '128000', { isProvisional: true }),
      adj(1, utc(2024, 9, 1), '100000', '130000'),
    ]);
    expect(steps[1]).toEqual({ date: utc(2024, 9, 1), amount: '130000' });
    expect(steps).toHaveLength(2);
  });

  it('un provisorio sin corrección vale', () => {
    const steps = rentStepsOf(contract, [adj(1, utc(2024, 9, 1), '100000', '128000', { isProvisional: true })]);
    expect(steps[1].amount).toBe('128000');
  });
});
