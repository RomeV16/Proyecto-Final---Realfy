import { AuditService, sanitizeChanges } from './audit.service';

function setup(ctx: { tenantId?: string; userId?: string } = {}) {
  const create = jest.fn().mockResolvedValue({});
  const tx = { auditLog: { create } } as any;
  const tenantContext = {
    getTenantId: () => ctx.tenantId,
    getUserId: () => ctx.userId,
  } as any;
  return { service: new AuditService(tenantContext), tx, create };
}

describe('AuditService.record', () => {
  it('writes the row with before/after/metadata and the context tenant', async () => {
    const { service, tx, create } = setup({ tenantId: 't1', userId: 'u1' });

    await service.record(tx, {
      action: 'UPDATE',
      entity: 'Penalty',
      entityId: 'p1',
      before: { amount: 1 },
      after: { amount: 2 },
      metadata: { source: 'cron' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: 't1',
        userId: 'u1',
        action: 'UPDATE',
        entity: 'Penalty',
        entityId: 'p1',
        changes: { source: 'cron', before: { amount: 1 }, after: { amount: 2 } },
        ipAddress: undefined,
        userAgent: undefined,
      },
    });
  });

  it('records no user when userId is null even if the context has one', async () => {
    const { service, tx, create } = setup({ tenantId: 't1', userId: 'u1' });
    await service.record(tx, { action: 'CREATE', entity: 'X', userId: null });
    expect(create.mock.calls[0][0].data.userId).toBeNull();
  });

  it('stores no changes when there is nothing to store', async () => {
    const { service, tx, create } = setup({ tenantId: 't1' });
    await service.record(tx, { action: 'DELETE', entity: 'X' });
    const { data } = create.mock.calls[0][0];
    expect(data.changes).toBeUndefined();
    expect(data.entityId).toBeNull();
    expect(data.userId).toBeNull();
  });

  it('prefers an explicit tenantId and refuses to write without any tenant', async () => {
    const withExplicit = setup();
    await withExplicit.service.record(withExplicit.tx, { action: 'CREATE', entity: 'X', tenantId: 't9' });
    expect(withExplicit.create.mock.calls[0][0].data.tenantId).toBe('t9');

    const none = setup();
    await expect(none.service.record(none.tx, { action: 'CREATE', entity: 'X' })).rejects.toThrow(/no tenant/);
    expect(none.create).not.toHaveBeenCalled();
  });

  it('redacts passwords and tokens, also nested', async () => {
    const { service, tx, create } = setup({ tenantId: 't1' });
    await service.record(tx, {
      action: 'CREATE',
      entity: 'User',
      metadata: { password: 'x', email: 'a@b.test' },
      after: { profile: { refreshToken: 'r', name: 'n' }, list: [{ secret: 's' }] },
    });
    expect(create.mock.calls[0][0].data.changes).toEqual({
      password: '[REDACTED]',
      email: 'a@b.test',
      after: { profile: { refreshToken: '[REDACTED]', name: 'n' }, list: [{ secret: '[REDACTED]' }] },
    });
  });
});

describe('sanitizeChanges', () => {
  it('leaves primitives, null and dates alone', () => {
    const d = new Date();
    expect(sanitizeChanges(null)).toBeNull();
    expect(sanitizeChanges('x')).toBe('x');
    expect(sanitizeChanges(d)).toBe(d);
  });
});
