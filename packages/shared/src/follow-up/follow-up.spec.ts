import { FollowUpKind } from '../enums';
import { OralExtensionSchema, RenewContractSchema, UpdateFollowUpSchema } from '../schemas/follow-up.schema';
import { ExpirationLight, checklistFor, daysUntil, expirationLight } from './index';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const thresholds = { redDays: 30, yellowDays: 90 };
const today = utc(2026, 11, 2);

describe('daysUntil', () => {
  it('cuenta días calendario, con signo', () => {
    expect(daysUntil(utc(2026, 11, 12), today)).toBe(10);
    expect(daysUntil(utc(2026, 11, 2), today)).toBe(0);
    expect(daysUntil(utc(2026, 10, 30), today)).toBe(-3);
  });

  it('ignora la hora del día', () => {
    expect(daysUntil(new Date('2026-11-03T23:30:00Z'), new Date('2026-11-02T00:10:00Z'))).toBe(1);
  });
});

describe('expirationLight', () => {
  it.each([
    [utc(2026, 11, 1), ExpirationLight.Expired],
    [utc(2026, 11, 2), ExpirationLight.Red],
    [utc(2026, 12, 2), ExpirationLight.Red],
    [utc(2026, 12, 3), ExpirationLight.Yellow],
    [utc(2027, 1, 31), ExpirationLight.Yellow],
    [utc(2027, 2, 1), ExpirationLight.Green],
  ])('fin %s -> %s', (end, expected) => {
    expect(expirationLight(end, today, thresholds)).toBe(expected);
  });

  it('con rojo en 0 solo es rojo el último día', () => {
    const t = { redDays: 0, yellowDays: 60 };
    expect(expirationLight(utc(2026, 11, 2), today, t)).toBe(ExpirationLight.Red);
    expect(expirationLight(utc(2026, 11, 3), today, t)).toBe(ExpirationLight.Yellow);
  });
});

describe('checklistFor', () => {
  it('cada tipo tiene sus pasos con código único', () => {
    for (const kind of Object.values(FollowUpKind)) {
      const codes = checklistFor(kind).map((t) => t.code);
      expect(codes.length).toBeGreaterThanOrEqual(5);
      expect(new Set(codes).size).toBe(codes.length);
    }
    expect(checklistFor('Devolucion').map((t) => t.code)).toEqual([
      'VISITA',
      'FECHA_ENTREGA',
      'PUBLICAR',
      'LIBRE_DEUDA',
      'PINTURA',
      'LLAVES',
      'DEPOSITO',
    ]);
    expect(checklistFor('Renovacion').map((t) => t.code)).toContain('SELLOS_FIRMA');
  });
});

describe('schemas de vencimientos', () => {
  it('la prórroga pide fecha y nota', () => {
    expect(OralExtensionSchema.safeParse({ until: '2027-03-31', note: 'Hablado por teléfono' }).success).toBe(true);
    expect(OralExtensionSchema.safeParse({ until: '2027-03-31', note: '' }).success).toBe(false);
    expect(OralExtensionSchema.safeParse({ until: '31/03/2027', note: 'x' }).success).toBe(false);
  });

  it('la renovación exige un fin posterior al inicio y un alquiler positivo', () => {
    const ok = { start: '2027-01-01', end: '2028-12-31', rent: '450000.50' };
    expect(RenewContractSchema.safeParse(ok).success).toBe(true);
    expect(RenewContractSchema.safeParse({ ...ok, end: '2027-01-01' }).success).toBe(false);
    expect(RenewContractSchema.safeParse({ ...ok, rent: '0' }).success).toBe(false);
    expect(RenewContractSchema.safeParse({ ...ok, rent: '10.123' }).success).toBe(false);
    expect(RenewContractSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it('la actualización exige al menos un campo', () => {
    expect(UpdateFollowUpSchema.safeParse({}).success).toBe(false);
    expect(UpdateFollowUpSchema.safeParse({ assigneeId: null }).success).toBe(true);
  });
});
