import { PenaltiesScheduler } from './penalties.scheduler';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { makeFakePenaltyDb, type FakeLiquidacion } from './penalties.testing';

/**
 * Pruebas de `PenaltiesScheduler.applyPenalties()` sobre una base en memoria.
 */

const TODAY = '2025-03-15T15:00:00.000Z'; // 12:00 en Buenos Aires
const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

const fixed = { mode: 'daily_fixed', value: '10', graceDays: 0, maxMultiplier: '5.0' };
const percent = { mode: 'daily_percent', value: '0.01', graceDays: 0, maxMultiplier: '3.0' };

function build(
  liquidaciones: FakeLiquidacion[],
  over: Parameters<typeof makeFakePenaltyDb>[0] = {},
  tenants = [{ id: 'tenant-1', name: 'Test Inmobiliaria' }],
) {
  const db = makeFakePenaltyDb({ liquidaciones, tenantConfig: fixed, ...over });
  const { tenantCron } = makeTenantCron(tenants);
  const scheduler = new PenaltiesScheduler({ client: db.client } as any, db.service, tenantCron);
  return { scheduler, ...db };
}

const overdue = (over: Partial<FakeLiquidacion> = {}): FakeLiquidacion => ({
  id: 'liq-1',
  total: '1000',
  dueDate: d('2025-03-05'),
  ...over,
});

beforeEach(() => jest.useFakeTimers({ now: new Date(TODAY) }));
afterEach(() => jest.useRealTimers());

describe('PenaltiesScheduler.applyPenalties()', () => {
  it('registra el punitorio de una liquidación vencida', async () => {
    const { scheduler, penalties } = build([overdue()]);

    const result = await scheduler.applyPenalties();

    expect(result).toEqual({ tenantsProcessed: 1, penaltiesInserted: 1 });
    expect(penalties).toHaveLength(1);
    expect(penalties[0]).toMatchObject({ liquidacionId: 'liq-1', amount: '100.00', daysOverdue: 10, status: 'active' });
  });

  it('filtra por estado y vencimiento sin tenantId (el cliente de la inmobiliaria filtra)', async () => {
    const { scheduler, client } = build([overdue()]);
    await scheduler.applyPenalties();
    expect(client.liquidacion.findMany.mock.calls[0][0].where).not.toHaveProperty('tenantId');
  });

  it('audita el alta como una acción del cron', async () => {
    const { scheduler, client } = build([overdue()]);
    await scheduler.applyPenalties();
    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    expect(client.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'CREATE',
      entity: 'Penalty',
      userId: null,
      metadata: { source: 'cron', mode: 'daily_fixed' },
    });
  });

  it('es idempotente: correr dos veces el mismo día no duplica', async () => {
    const { scheduler, penalties } = build([overdue()]);
    const r1 = await scheduler.applyPenalties();
    const r2 = await scheduler.applyPenalties();
    expect(r1.penaltiesInserted).toBe(1);
    expect(r2.penaltiesInserted).toBe(0);
    expect(penalties).toHaveLength(1);
  });

  it('no inserta nada sin tenants', async () => {
    const { scheduler } = build([], {}, []);
    expect(await scheduler.applyPenalties()).toEqual({ tenantsProcessed: 0, penaltiesInserted: 0 });
  });

  it('una liquidación que vence hoy o todavía no venció no devenga', async () => {
    const { scheduler, penalties } = build([overdue({ dueDate: d('2025-03-15') })]);
    const result = await scheduler.applyPenalties();
    expect(result.penaltiesInserted).toBe(0);
    expect(penalties).toHaveLength(0);
  });

  it('sigue con las demás si una falla', async () => {
    const { scheduler, penalties, client } = build([overdue({ id: 'liq-mala' }), overdue({ id: 'liq-1' })]);
    const original = client.liquidacion.findFirst.getMockImplementation()!;
    client.liquidacion.findFirst.mockImplementation(async (args: any) => {
      if (args.where.id === 'liq-mala') throw new Error('boom');
      return original(args);
    });
    const result = await scheduler.applyPenalties();
    expect(result.penaltiesInserted).toBe(1);
    expect(penalties[0].liquidacionId).toBe('liq-1');
  });
});

/**
 * CP-138 (DEF-18): el punitorio corre sobre el saldo pendiente y el "hoy" es
 * el día de Buenos Aires. Antes se calculaba sobre el total de la liquidación
 * y con la fecha local del servidor.
 */
describe('PenaltiesScheduler.applyPenalties(): base de cálculo y día', () => {
  it('una liquidación pagada en parte devenga solo sobre lo impago', async () => {
    const { scheduler, penalties } = build(
      [overdue({ id: 'liq-parcial', payments: [{ amount: '600', paidAt: d('2025-03-04') }] })],
      { tenantConfig: percent },
    );
    await scheduler.applyPenalties();
    // 10 días de mora sobre un saldo de 400: 400 * 1% * 10 = 40 (no 100)
    expect(penalties).toHaveLength(1);
    expect(penalties[0].amount).toBe('40.00');
    expect(penalties[0].compoundBase).toBe('400.00');
  });

  it('una liquidación pagada por completo no devenga nada', async () => {
    const { scheduler, penalties } = build(
      [
        overdue({
          id: 'liq-pagada',
          payments: [
            { amount: '600', paidAt: d('2025-03-04') },
            { amount: '400', paidAt: d('2025-03-04') },
          ],
        }),
      ],
      { tenantConfig: percent },
    );
    const result = await scheduler.applyPenalties();
    expect(result.penaltiesInserted).toBe(0);
    expect(penalties).toHaveLength(0);
  });

  it('a las 22:30 de Buenos Aires todavía es el día anterior en UTC', async () => {
    jest.setSystemTime(new Date('2025-03-11T01:30:00.000Z')); // 22:30 del 10 de marzo en Buenos Aires
    const { scheduler, penalties } = build([overdue()], { tenantConfig: percent });
    await scheduler.applyPenalties();
    expect(penalties).toHaveLength(1);
    expect(penalties[0].appliedOn.toISOString()).toBe('2025-03-10T00:00:00.000Z');
    expect(penalties[0].daysOverdue).toBe(5);
  });
});

/**
 * DEF-28: cada corrida diaria sumaba el punitorio acumulado entero en lugar de
 * lo que faltaba, y las filas condonadas o cobradas volvían a devengarse.
 */
describe('PenaltiesScheduler.applyPenalties(): devengo incremental', () => {
  it('al día siguiente agrega solo el día que falta', async () => {
    const { scheduler, penalties } = build([overdue()]);
    await scheduler.applyPenalties();
    jest.setSystemTime(new Date('2025-03-16T15:00:00.000Z'));
    await scheduler.applyPenalties();
    expect(penalties.map((p) => p.amount)).toEqual(['100.00', '10.00']);
  });

  it('una fila condonada no se vuelve a devengar', async () => {
    const { scheduler, penalties } = build([overdue()], {
      penalties: [{ amount: '100.00', status: 'waived', appliedOn: d('2025-03-15') }],
    });
    const result = await scheduler.applyPenalties();
    expect(result.penaltiesInserted).toBe(0);
    expect(penalties).toHaveLength(1);
  });

  it('una fila ya cobrada en otra liquidación no se vuelve a devengar', async () => {
    const { scheduler, penalties } = build([overdue()], {
      penalties: [{ amount: '100.00', settledLiquidacionId: 'liq-2', appliedOn: d('2025-03-15') }],
    });
    expect((await scheduler.applyPenalties()).penaltiesInserted).toBe(0);
    expect(penalties).toHaveLength(1);
  });
});

describe('PenaltiesScheduler.applyPenalties(): regla por contrato', () => {
  it('la regla de la versión de reglas del contrato manda sobre la de la inmobiliaria', async () => {
    const { scheduler, penalties, tenants } = build([overdue()], {
      termsPenaltyConfig: { mode: 'daily_fixed', value: '25', graceDays: 0, maxMultiplier: '9.0' },
    });
    await scheduler.applyPenalties();
    expect(penalties[0].amount).toBe('250.00');
    expect(tenants.getPenaltyConfig).not.toHaveBeenCalled();
  });

  it('una regla propia inválida cae a la de la inmobiliaria', async () => {
    const { scheduler, penalties } = build([overdue()], { termsPenaltyConfig: { mode: 'otro' } });
    await scheduler.applyPenalties();
    expect(penalties[0].amount).toBe('100.00');
  });

  it('max_bna_or_daily usa la tasa activa BNA cargada', async () => {
    const { scheduler, penalties, indexData } = build([overdue()], {
      tenantConfig: { mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '3.0' },
      bnaRows: [{ period: d('2025-03-01'), value: '100.000000' }],
    });
    await scheduler.applyPenalties();
    // 1000 x 2 x 100 % / 365 x 10 días
    expect(penalties[0].amount).toBe('54.79');
    expect(indexData.getForPeriod).toHaveBeenCalledTimes(1);
  });

  it('con max_bna_or_daily y sin tasa cargada rige el piso diario', async () => {
    const { scheduler, penalties } = build([overdue()], {
      tenantConfig: { mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '3.0' },
    });
    await scheduler.applyPenalties();
    expect(penalties[0].amount).toBe('30.00');
  });
});
