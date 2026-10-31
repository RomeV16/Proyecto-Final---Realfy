import { Logger } from '@nestjs/common';
import { makeTenantCron } from '../../../test/helpers/tenant-cron';

describe('TenantCron.forEachActiveTenant', () => {
  const tenants = [
    { id: 't1', name: 'Inmo Uno' },
    { id: 't2', name: 'Inmo Dos' },
    { id: 't3', name: 'Inmo Tres' },
  ];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('lists only active tenants with the unfiltered client', async () => {
    const { tenantCron, prisma } = makeTenantCron(tenants);
    await tenantCron.forEachActiveTenant('job', async () => undefined);
    expect(prisma.baseClient.tenant.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      select: { id: true, name: true },
    });
  });

  it('runs fn once per tenant with that tenant set in the context', async () => {
    const { tenantCron, tenantContext } = makeTenantCron(tenants);
    const seen: Array<[string, string | undefined, string]> = [];

    const summary = await tenantCron.forEachActiveTenant('job', async (tenantId, tenant) => {
      await Promise.resolve();
      seen.push([tenantId, tenantContext.getTenantId(), tenant.name]);
    });

    expect(summary).toEqual({ ok: 3, failed: 0 });
    expect(seen).toEqual([
      ['t1', 't1', 'Inmo Uno'],
      ['t2', 't2', 'Inmo Dos'],
      ['t3', 't3', 'Inmo Tres'],
    ]);
  });

  it('isolates data: fn only sees the rows of its own tenant', async () => {
    const { tenantCron, tenantContext } = makeTenantCron(tenants);
    const rows = [
      { id: 'a', tenantId: 't1' },
      { id: 'b', tenantId: 't2' },
      { id: 'c', tenantId: 't2' },
    ];
    // Un cliente que filtra por el tenant del contexto, como la extensión de Prisma.
    const scoped = {
      list: async () => rows.filter((r) => r.tenantId === tenantContext.getTenantId()),
    };
    const visible: Record<string, string[]> = {};

    await tenantCron.forEachActiveTenant('job', async (tenantId) => {
      visible[tenantId] = (await scoped.list()).map((r) => r.id);
    });

    expect(visible).toEqual({ t1: ['a'], t2: ['b', 'c'], t3: [] });
  });

  it('leaves no tenant in the context once it finishes (fails closed outside)', async () => {
    const { tenantCron, tenantContext } = makeTenantCron(tenants);
    await tenantCron.forEachActiveTenant('job', async () => undefined);
    expect(tenantContext.getTenantId()).toBeUndefined();
  });

  it('logs a failing tenant with job, tenantId and correlation id and keeps going', async () => {
    const { tenantCron } = makeTenantCron(tenants);
    const error = jest.spyOn(Logger.prototype, 'error');
    const ran: string[] = [];

    const summary = await tenantCron.forEachActiveTenant('my-job', async (tenantId) => {
      if (tenantId === 't2') throw new Error('boom');
      ran.push(tenantId);
    });

    expect(summary).toEqual({ ok: 2, failed: 1 });
    expect(ran).toEqual(['t1', 't3']);
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0][0]);
    expect(message).toContain('my-job');
    expect(message).toContain('tenantId=t2');
    expect(message).toMatch(/correlationId=cron-my-job-[0-9a-f-]{36}/);
    expect(message).toContain('boom');
  });

  it('gives each tenant its own correlation id', async () => {
    const { tenantCron, cls } = makeTenantCron(tenants);
    const ids = new Set<string>();
    await tenantCron.forEachActiveTenant('job', async () => {
      ids.add(cls.get('correlationId'));
    });
    expect(ids.size).toBe(3);
  });

  it('does not inherit the user or the bypass of an enclosing request context', async () => {
    const { tenantCron, tenantContext, cls } = makeTenantCron([tenants[0]]);
    let inner: { user?: string; bypass: boolean } | undefined;

    await cls.run(async () => {
      tenantContext.setUserId('u-http');
      tenantContext.setBypassTenantFilter(true);
      await tenantCron.forEachActiveTenant('job', async () => {
        inner = { user: tenantContext.getUserId(), bypass: tenantContext.isTenantFilterBypassed() };
      });
    });

    expect(inner).toEqual({ user: undefined, bypass: false });
  });
});
