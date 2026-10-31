import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import {
  denormalizedColumns,
  getEffectiveEndDate,
  getTermsAt,
  pickTermsAt,
  resolveRule,
} from './contract-terms';

const v = (validFrom: string, extra: Record<string, unknown> = {}) => ({
  validFrom: new Date(validFrom),
  ...extra,
});

describe('pickTermsAt', () => {
  const versions = [v('2026-01-01', { n: 1 }), v('2026-07-01', { n: 2 }), v('2026-10-01', { n: 3 })];

  it('devuelve la última versión con validFrom anterior o igual', () => {
    expect(pickTermsAt(versions, new Date('2026-03-15'))).toMatchObject({ n: 1 });
    expect(pickTermsAt(versions, new Date('2026-07-01'))).toMatchObject({ n: 2 });
    expect(pickTermsAt(versions, new Date('2027-01-01'))).toMatchObject({ n: 3 });
  });

  it('no depende del orden de entrada', () => {
    expect(pickTermsAt([...versions].reverse(), new Date('2026-08-01'))).toMatchObject({ n: 2 });
  });

  it('antes de la primera versión no hay reglas', () => {
    expect(pickTermsAt(versions, new Date('2025-12-31'))).toBeNull();
    expect(pickTermsAt([], new Date())).toBeNull();
  });
});

describe('getTermsAt', () => {
  it('pide la última versión anterior o igual a la fecha, de la inmobiliaria del contrato', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'tv1' });
    const date = new Date('2026-05-01');

    const found = await getTermsAt({ contractTermsVersion: { findFirst } }, { id: 'c1', tenantId: 't1' }, date);

    expect(found).toEqual({ id: 'tv1' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: 't1', contractId: 'c1', validFrom: { lte: date } },
      orderBy: { validFrom: 'desc' },
    });
  });
});

describe('getEffectiveEndDate', () => {
  const endDate = new Date('2026-12-31');

  it('sin fin real es el fin pactado, aunque ya haya pasado (D-3)', () => {
    expect(getEffectiveEndDate({ endDate })).toBe(endDate);
    expect(getEffectiveEndDate({ endDate, actualEndDate: null })).toBe(endDate);
  });

  it('con fin real o prórroga de palabra rige ese', () => {
    const actual = new Date('2027-03-31');
    expect(getEffectiveEndDate({ endDate, actualEndDate: actual })).toBe(actual);
    const early = new Date('2026-08-15');
    expect(getEffectiveEndDate({ endDate, actualEndDate: early })).toBe(early);
  });
});

describe('resolveRule (defecto -> contrato -> acuerdo)', () => {
  const defaults = { ...DEFAULT_OPERATIONAL_DEFAULTS, dueDay: 8, ipcLagMonths: 3 };

  it('el valor de la versión vigente gana al defecto', () => {
    expect(resolveRule(defaults, { dueDay: 5, indexLagMonths: 1 }, 'dueDay')).toBe(5);
    expect(resolveRule(defaults, { dueDay: 5, indexLagMonths: 1 }, 'indexLagMonths')).toBe(1);
  });

  it('lo que la versión no fija sale del defecto de la inmobiliaria', () => {
    expect(resolveRule(defaults, {}, 'dueDay')).toBe(8);
    expect(resolveRule(defaults, null, 'indexLagMonths')).toBe(3);
    expect(resolveRule(defaults, { dueDay: undefined }, 'dueDay')).toBe(8);
  });

  it('las reglas sin defecto de inmobiliaria tienen el del código', () => {
    expect(resolveRule(defaults, null, 'adjustmentBase')).toBe('Vigente');
    expect(resolveRule(defaults, null, 'paymentFlow')).toBe('Partido');
    expect(resolveRule(defaults, null, 'penaltyConfig')).toBeNull();
    expect(resolveRule(defaults, { paymentFlow: 'TodoLocador' }, 'paymentFlow')).toBe('TodoLocador');
  });
});

describe('denormalizedColumns', () => {
  it('copia modalidad, período y porcentaje de la versión', () => {
    expect(
      denormalizedColumns({ adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral', customPct: undefined }),
    ).toEqual({ adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral', customAdjustmentPct: null });
    expect(
      denormalizedColumns({ adjustmentType: 'FixedPercent', adjustmentPeriod: 'Anual', customPct: '12' }),
    ).toMatchObject({ customAdjustmentPct: '12' });
  });
});
