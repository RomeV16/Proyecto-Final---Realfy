import { ScheduleStatus } from '@realfy/shared';
import { resolveAdjustmentWindow } from './adjustment-window';

const START = new Date('2024-10-01T00:00:00.000Z');
const UNTIL = new Date('2026-10-01T00:00:00.000Z');
const contract = { id: 'c1', tenantId: 't1', startDate: START };

interface Fixture {
  applied?: Date | null;
  history?: Date | null;
  skipped?: Date | null;
  fixedInitialMonths?: number;
  mode?: string;
}

/** Cliente simulado: responde por estado del cronograma, historial y reglas vigentes. */
function client(f: Fixture) {
  return {
    adjustmentSchedule: {
      findFirst: jest.fn(async ({ where }: any) => {
        const date = where.status === ScheduleStatus.Applied ? f.applied : f.skipped;
        return date ? { nextAdjustmentDate: date } : null;
      }),
    },
    contractAdjustment: {
      findFirst: jest.fn(async () => (f.history ? { adjustmentDate: f.history } : null)),
    },
    contractTermsVersion: {
      findFirst: jest.fn(async () => ({
        fixedInitialMonths: f.fixedInitialMonths ?? 0,
        skippedAdjustmentsMode: f.mode ?? 'NoRecuperar',
      })),
    },
  } as any;
}

describe('resolveAdjustmentWindow', () => {
  it('DEF-137: sin cronograma aplicado arranca en el último período salteado al importar, no en el inicio', async () => {
    const skipped = new Date('2026-07-01T00:00:00.000Z');
    const w = await resolveAdjustmentWindow(client({ skipped }), contract, UNTIL);
    expect(w).toEqual({ from: skipped, until: UNTIL, afterPrevious: true });
  });

  it('DEF-137: el último ajuste del historial manda sobre un cronograma aplicado más viejo', async () => {
    const history = new Date('2026-07-01T00:00:00.000Z');
    const w = await resolveAdjustmentWindow(
      client({ applied: new Date('2025-10-01T00:00:00.000Z'), history }),
      contract,
      UNTIL,
    );
    expect(w).toEqual({ from: history, until: UNTIL, afterPrevious: true });
  });

  it('sin ajuste ni período salteado arranca en el inicio del contrato', async () => {
    const w = await resolveAdjustmentWindow(client({}), contract, UNTIL);
    expect(w).toEqual({ from: START, until: UNTIL, afterPrevious: false });
  });

  it('DEF-137: con la convención de recuperar, el primer ajuste acumula desde el inicio del contrato', async () => {
    const skipped = new Date('2026-07-01T00:00:00.000Z');
    const w = await resolveAdjustmentWindow(client({ skipped, mode: 'Recuperar' }), contract, UNTIL);
    expect(w).toEqual({ from: START, until: UNTIL, afterPrevious: false });
  });

  it('recuperar no pisa un ajuste ya aplicado: el alquiler vigente ya lo incluye', async () => {
    const history = new Date('2026-07-01T00:00:00.000Z');
    const w = await resolveAdjustmentWindow(client({ history, mode: 'Recuperar' }), contract, UNTIL);
    expect(w).toEqual({ from: history, until: UNTIL, afterPrevious: true });
  });

  it('los períodos salteados dentro de los meses fijos iniciales no anclan la ventana', async () => {
    const c = client({ fixedInitialMonths: 12 });
    await resolveAdjustmentWindow(c, contract, UNTIL);
    const where = c.adjustmentSchedule.findFirst.mock.calls.at(-1)[0].where;
    expect(where.status).toBe(ScheduleStatus.Skipped);
    // Los salteados por meses fijos (antes de inicio + 12 meses) quedan afuera de la búsqueda.
    expect(where.nextAdjustmentDate).toEqual({ lt: UNTIL, gte: new Date('2025-10-01T00:00:00.000Z') });
  });

  it('los meses fijos se cuentan desde el inicio del tramo vigente', async () => {
    const c = client({ fixedInitialMonths: 6 });
    c.contractPeriod = { findFirst: jest.fn(async () => ({ startDate: new Date('2026-01-01T00:00:00.000Z') })) };
    await resolveAdjustmentWindow(c, contract, UNTIL);
    const where = c.adjustmentSchedule.findFirst.mock.calls.at(-1)[0].where;
    expect(where.nextAdjustmentDate.gte).toEqual(new Date('2026-07-01T00:00:00.000Z'));
  });
});
