import { describe, expect, it } from 'vitest';
import {
  checkShares,
  dayOf,
  draftFromLessor,
  emptyDraft,
  equalShares,
  formatUnitsPct,
  isCurrent,
  lessorRowErrors,
  lessorsPayload,
  normalizePct,
  personName,
  powerCollectsFor,
  type ContractLessor,
  type LessorDraft,
  type PowerOfAttorney,
} from './parties';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const WINDOW = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2028-01-01T00:00:00.000Z' };
const TODAY = new Date('2026-10-31T12:00:00.000Z');

const person = (id: string) => ({ id, firstName: 'Ana', lastName: 'Prueba' });
const draft = (id: string, pct: string, extra: Partial<LessorDraft> = {}) =>
  emptyDraft({ person: person(id), payoutPct: pct, ...extra });

describe('helpers de fechas y nombres', () => {
  it('dayOf y personName', () => {
    expect(dayOf('2026-03-01T00:00:00.000Z')).toBe('2026-03-01');
    expect(dayOf(null)).toBe('');
    expect(personName({ firstName: 'Ana', lastName: 'Prueba' })).toBe('Ana Prueba');
  });

  it('isCurrent incluye el inicio y excluye el fin', () => {
    const row = { validFrom: '2026-01-01T00:00:00.000Z', validTo: '2026-06-01T00:00:00.000Z' };
    expect(isCurrent(row, new Date('2025-12-31T23:59:59.000Z'))).toBe(false);
    expect(isCurrent(row, new Date('2026-01-01T00:00:00.000Z'))).toBe(true);
    expect(isCurrent(row, new Date('2026-06-01T00:00:00.000Z'))).toBe(false);
    expect(isCurrent({ validFrom: row.validFrom }, TODAY)).toBe(true);
  });
});

describe('powerCollectsFor', () => {
  const base: PowerOfAttorney = {
    id: 'w',
    principalId: A,
    agentId: B,
    scopes: ['Cobrar'],
    signatureMode: 'Indistinta',
    validFrom: '2025-01-01T00:00:00.000Z',
  };
  const contract = { id: 'c-1', propertyId: 'p-1' };

  it('acepta un poder general de cobro del locador', () => {
    expect(powerCollectsFor(base, A, contract, TODAY)).toBe(true);
  });

  it('rechaza otro poderdante, sin alcance Cobrar o vencido', () => {
    expect(powerCollectsFor(base, B, contract, TODAY)).toBe(false);
    expect(powerCollectsFor({ ...base, scopes: ['Firmar', 'Administrar'] }, A, contract, TODAY)).toBe(false);
    expect(powerCollectsFor({ ...base, validTo: '2026-01-01T00:00:00.000Z' }, A, contract, TODAY)).toBe(false);
  });

  it('un poder de otro contrato u otra propiedad no vale; el del propio sí', () => {
    expect(powerCollectsFor({ ...base, contractId: 'c-2' }, A, contract, TODAY)).toBe(false);
    expect(powerCollectsFor({ ...base, contractId: 'c-1' }, A, contract, TODAY)).toBe(true);
    expect(powerCollectsFor({ ...base, propertyId: 'p-2' }, A, contract, TODAY)).toBe(false);
    expect(powerCollectsFor({ ...base, propertyId: 'p-1' }, A, contract, TODAY)).toBe(true);
  });
});

describe('porcentajes', () => {
  it('normalizePct acepta coma o punto y hasta 4 decimales', () => {
    expect(normalizePct('50')).toBe('50');
    expect(normalizePct(' 33,3333 ')).toBe('33.3333');
    expect(normalizePct('33.33333')).toBeNull();
    expect(normalizePct('')).toBeNull();
    expect(normalizePct('abc')).toBeNull();
    expect(normalizePct('1000')).toBeNull();
  });

  it('formatUnitsPct y equalShares usan 4 decimales y coma', () => {
    expect(formatUnitsPct(1_000_000)).toBe('100,0000');
    expect(formatUnitsPct(333_333)).toBe('33,3333');
    expect(equalShares(3)).toEqual(['33.3333', '33.3333', '33.3334']);
    expect(equalShares(0)).toEqual([]);
  });
});

describe('checkShares', () => {
  it('100 exacto en la ventana del contrato es válido', () => {
    const check = checkShares([draft(A, '60'), draft(B, '40')], WINDOW, TODAY);
    expect(check).toMatchObject({ units: 1_000_000, missing: 0, ok: true, incomplete: false });
    expect(check.invalidDates).toEqual([]);
  });

  it('informa falta y sobra respecto de 100', () => {
    expect(checkShares([draft(A, '60'), draft(B, '30')], WINDOW, TODAY)).toMatchObject({ missing: 100_000, ok: false });
    expect(checkShares([draft(A, '60'), draft(B, '50')], WINDOW, TODAY)).toMatchObject({ missing: -100_000, ok: false });
  });

  it('una fila sin persona o con porcentaje inválido deja el reparto incompleto', () => {
    expect(checkShares([draft(A, '100'), emptyDraft({ payoutPct: '10' })], WINDOW, TODAY).incomplete).toBe(true);
    expect(checkShares([draft(A, '100'), draft(B, 'x')], WINDOW, TODAY).ok).toBe(false);
    expect(checkShares([], WINDOW, TODAY)).toMatchObject({ incomplete: true, ok: false });
  });

  it('una cesión que cierra en 100 en cada fecha es válida y se muestra la suma de hoy', () => {
    const rows = [
      draft(A, '100', { validTo: '2026-07-01' }),
      draft(B, '100', { validFrom: '2026-07-01' }),
    ];
    const check = checkShares(rows, WINDOW, TODAY);
    expect(check.ok).toBe(true);
    expect(check.units).toBe(1_000_000);
  });

  it('lista las fechas en que no suma 100', () => {
    const rows = [
      draft(A, '100', { validTo: '2026-07-01' }),
      draft(B, '100', { validFrom: '2026-08-01' }),
    ];
    const check = checkShares(rows, WINDOW, TODAY);
    expect(check.ok).toBe(false);
    expect(check.invalidDates.map((d) => d.date.toISOString().slice(0, 10))).toEqual(['2026-07-01']);
    expect(check.invalidDates[0].sum).toBe('0.0000');
  });

  it('antes del inicio mira el primer día del contrato y después del fin el último', () => {
    const rows = [draft(A, '100')];
    expect(checkShares(rows, WINDOW, new Date('2025-01-01T00:00:00.000Z')).units).toBe(1_000_000);
    expect(checkShares(rows, WINDOW, new Date('2030-01-01T00:00:00.000Z')).units).toBe(1_000_000);
  });

  it('sin fecha de fin el contrato se toma abierto', () => {
    const check = checkShares([draft(A, '100')], { startDate: WINDOW.startDate }, TODAY);
    expect(check.ok).toBe(true);
  });
});

describe('payload y errores por fila', () => {
  it('lessorsPayload arma el cuerpo del PUT: ids solo en filas existentes y nulos para lo vacío', () => {
    const body = lessorsPayload([
      draft(A, '50,5', { id: '00000000-0000-4000-8000-0000000000a1', validFrom: '2026-01-01', payeePersonId: B, bankAccountId: 'x' }),
      draft(B, '49.5', { capacity: 'Usufructuario', validTo: '2027-01-01' }),
    ]);
    expect(body).toEqual({
      lessors: [
        { id: '00000000-0000-4000-8000-0000000000a1', personId: A, capacity: 'Propietario', payoutPct: '50.5', payeePersonId: B, bankAccountId: 'x', validFrom: '2026-01-01', validTo: null },
        { personId: B, capacity: 'Usufructuario', payoutPct: '49.5', payeePersonId: null, bankAccountId: null, validTo: '2027-01-01' },
      ],
    });
  });

  it('lessorRowErrors marca filas sin persona, porcentaje inválido y fechas invertidas', () => {
    expect(lessorRowErrors([emptyDraft({ payoutPct: '10' })])).toEqual({ 0: { personId: true } });
    expect(lessorRowErrors([draft(A, '100')])).toEqual({});
    expect(lessorRowErrors([draft(A, '60'), draft(B, '150')])).toEqual({ 1: { payoutPct: true } });
    expect(lessorRowErrors([draft(A, '100', { validFrom: '2026-05-01', validTo: '2026-04-01' })])).toEqual({
      0: { validTo: true },
    });
  });

  it('draftFromLessor normaliza el porcentaje a 4 decimales y las fechas a día', () => {
    const lessor: ContractLessor = {
      id: 'l-1',
      personId: A,
      capacity: 'Acreedor',
      payoutPct: '33.3',
      payeePersonId: B,
      bankAccountId: null,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2026-12-31T00:00:00.000Z',
      person: person(A),
    };
    expect(draftFromLessor(lessor)).toMatchObject({
      id: 'l-1',
      capacity: 'Acreedor',
      payoutPct: '33.3000',
      payeePersonId: B,
      bankAccountId: '',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    });
  });
});
