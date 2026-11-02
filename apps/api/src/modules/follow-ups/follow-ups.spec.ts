import { AsyncLocalStorage } from 'async_hooks';
import { ClsService } from 'nestjs-cls';
import { ExpirationLight, FollowUpKind, FollowUpOutcome, expirationLight } from '@realfy/shared';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { effectiveEndWhere, lightRange } from './follow-up-light';
import { FollowUpsScheduler } from './follow-ups.scheduler';
import { FollowUpsService } from './follow-ups.service';
import { OralExtensionService } from './oral-extension.service';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const today = utc(2026, 11, 2);
const t = { redDays: 30, yellowDays: 90 };

describe('lightRange', () => {
  it('coincide con expirationLight en los bordes de cada color', () => {
    const inRange = (end: Date, r: ReturnType<typeof lightRange>) =>
      (r.gt === undefined || end > r.gt) &&
      (r.gte === undefined || end >= r.gte) &&
      (r.lt === undefined || end < r.lt) &&
      (r.lte === undefined || end <= r.lte);

    for (let offset = -5; offset <= 120; offset++) {
      const end = new Date(today.getTime() + offset * 86_400_000);
      const light = expirationLight(end, today, t);
      for (const candidate of Object.values(ExpirationLight)) {
        expect(inRange(end, lightRange(candidate, today, t))).toBe(candidate === light);
      }
    }
  });

  it('el filtro mira el fin real y, si no hay, el pactado', () => {
    expect(effectiveEndWhere({ lte: today })).toEqual({
      OR: [{ actualEndDate: { lte: today } }, { actualEndDate: null, endDate: { lte: today } }],
    });
  });
});

function makeService(prisma: any, defaults = { expiryLight: t }) {
  const cls = new ClsService(new AsyncLocalStorage());
  const tenantContext = new TenantContextService(cls);
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new FollowUpsService(
    prisma,
    tenantContext,
    { get: jest.fn().mockResolvedValue(defaults) } as any,
    audit as any,
  );
  return { service, cls, tenantContext, audit };
}

describe('FollowUpsService.openDueFollowUps', () => {
  const contract = (id: string, end: Date, actual: Date | null = null) => ({ id, endDate: end, actualEndDate: actual });

  async function run(contracts: any[], existing: any[], createImpl?: jest.Mock) {
    const create = createImpl ?? jest.fn().mockResolvedValue({});
    const prisma = {
      client: {
        contract: { findMany: jest.fn().mockResolvedValue(contracts) },
        contractFollowUp: { findMany: jest.fn().mockResolvedValue(existing), create },
      },
    };
    const { service, cls, tenantContext } = makeService(prisma);
    const opened = await cls.run(async () => {
      tenantContext.setTenantId('t1');
      return service.openDueFollowUps(today);
    });
    return { opened, create, prisma };
  }

  it('abre una renovación con su checklist para cada contrato sin seguimiento', async () => {
    const { opened, create } = await run([contract('c1', utc(2026, 12, 1))], []);
    expect(opened).toBe(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: 't1', contractId: 'c1', kind: FollowUpKind.Renovacion, dueDate: utc(2026, 12, 1) });
    expect(data.tasks.create.map((x: any) => x.code)).toEqual([
      'VISITA',
      'PRECIO',
      'REGLA',
      'GARANTES',
      'HONORARIOS',
      'SELLOS_FIRMA',
    ]);
  });

  it('usa el fin real si existe', async () => {
    const { create } = await run([contract('c1', utc(2026, 11, 10), utc(2027, 1, 20))], []);
    expect(create.mock.calls[0][0].data.dueDate).toEqual(utc(2027, 1, 20));
  });

  it('omite el contrato que ya tiene seguimiento para ese fin, de cualquier tipo', async () => {
    const { opened, create } = await run(
      [contract('c1', utc(2026, 12, 1))],
      [{ contractId: 'c1', dueDate: utc(2026, 12, 1) }],
    );
    expect(opened).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('no cuenta el alta que otro proceso hizo antes (clave única)', async () => {
    const dup = jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const { opened } = await run([contract('c1', utc(2026, 12, 1))], [], dup);
    expect(opened).toBe(0);
  });

  it('relanza cualquier otro error', async () => {
    const boom = jest.fn().mockRejectedValue(new Error('db caída'));
    await expect(run([contract('c1', utc(2026, 12, 1))], [], boom)).rejects.toThrow('db caída');
  });

  it('sin contratos en la ventana no consulta seguimientos', async () => {
    const { opened, prisma } = await run([], []);
    expect(opened).toBe(0);
    expect(prisma.client.contractFollowUp.findMany).not.toHaveBeenCalled();
  });

  it('la ventana llega hasta yellowDays días desde hoy', async () => {
    const { prisma } = await run([], []);
    const where = prisma.client.contract.findMany.mock.calls[0][0].where;
    expect(where.OR[0].actualEndDate.lte).toEqual(utc(2027, 1, 31));
  });
});

describe('FollowUpsService.closeOpenForContract', () => {
  it('cierra los abiertos con el resultado indicado', async () => {
    const tx = { contractFollowUp: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    const { service } = makeService({});
    expect(await service.closeOpenForContract(tx, 'c1', FollowUpOutcome.Renovado)).toBe(2);
    expect(tx.contractFollowUp.updateMany.mock.calls[0][0]).toMatchObject({
      where: { contractId: 'c1', status: 'Abierto' },
      data: { status: 'Cerrado', outcome: 'Renovado' },
    });
  });
});

describe('FollowUpsScheduler', () => {
  it('recorre las inmobiliarias y suma lo abierto', async () => {
    const { tenantCron } = makeTenantCron([
      { id: 't1', name: 'Uno' },
      { id: 't2', name: 'Dos' },
    ]);
    const followUps = { openDueFollowUps: jest.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error('x')) };
    const scheduler = new FollowUpsScheduler(followUps as any, tenantCron);
    const summary = await scheduler.openForAllTenants(today);
    expect(summary).toEqual({ tenantsProcessed: 1, tenantsFailed: 1, opened: 2 });
    expect(followUps.openDueFollowUps).toHaveBeenCalledWith(today);
  });

  it('el cron diario corre el barrido protegido', async () => {
    const { tenantCron } = makeTenantCron([]);
    const scheduler = new FollowUpsScheduler({ openDueFollowUps: jest.fn() } as any, tenantCron);
    const spy = jest.spyOn(scheduler, 'openForAllTenants');
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await scheduler.handleDailyOpen();
    } finally {
      process.env.NODE_ENV = env;
    }
    expect(spy).toHaveBeenCalled();
  });
});

describe('OralExtensionService', () => {
  const build = (contract: any) => {
    const tx = {
      contractAgreement: { create: jest.fn().mockResolvedValue({ id: 'a1' }) },
      contract: { update: jest.fn() },
    };
    const prisma = {
      client: {
        contract: { findFirst: jest.fn().mockResolvedValue(contract) },
        $transaction: jest.fn((fn: any) => fn(tx)),
      },
    };
    const audit = { record: jest.fn() };
    const contracts = { rebuildPendingSchedule: jest.fn(), findOne: jest.fn().mockResolvedValue({ id: 'c1' }) };
    const followUps = { closeOpenForContract: jest.fn().mockResolvedValue(1) };
    const tenantContext = { getTenantId: () => 't1', getUserId: () => 'u1' };
    const service = new OralExtensionService(
      prisma as any,
      tenantContext as any,
      audit as any,
      contracts as any,
      followUps as any,
    );
    return { service, tx, audit, contracts, followUps };
  };
  const active = { id: 'c1', status: 'Activo', endDate: utc(2026, 12, 31), actualEndDate: null };

  it('registra el convenio, mueve el fin real y audita', async () => {
    const { service, tx, audit, contracts, followUps } = build(active);
    await service.extend('c1', { until: '2027-03-31', note: 'De palabra' });
    expect(tx.contractAgreement.create.mock.calls[0][0].data).toMatchObject({
      kind: 'Prorroga',
      effectiveFrom: utc(2026, 12, 31),
      effectiveTo: utc(2027, 3, 31),
      createdById: 'u1',
    });
    expect(tx.contract.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { actualEndDate: utc(2027, 3, 31) } });
    expect(followUps.closeOpenForContract).toHaveBeenCalledWith(tx, 'c1', 'Prorrogado');
    expect(audit.record.mock.calls[0][1]).toMatchObject({ entity: 'Contract', metadata: { operation: 'oral-extension' } });
    expect(contracts.rebuildPendingSchedule).toHaveBeenCalledWith('c1');
  });

  it('parte del fin real si ya hubo una prórroga', async () => {
    const { service, tx } = build({ ...active, actualEndDate: utc(2027, 2, 28) });
    await service.extend('c1', { until: '2027-03-31', note: 'Otra más' });
    expect(tx.contractAgreement.create.mock.calls[0][0].data.effectiveFrom).toEqual(utc(2027, 2, 28));
    await expect(service.extend('c1', { until: '2027-02-28', note: 'no alcanza' })).rejects.toMatchObject({
      response: { error: 'EXTENSION_NOT_AFTER_END' },
    });
  });

  it('exige contrato activo', async () => {
    const { service } = build({ ...active, status: 'Rescindido' });
    await expect(service.extend('c1', { until: '2027-03-31', note: 'x' })).rejects.toMatchObject({
      response: { error: 'CONTRACT_NOT_ACTIVE' },
    });
  });
});
