import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { InboxSlaScheduler } from './inbox-sla.scheduler';

const NOW = new Date('2026-11-03T13:20:00Z');

const overdue = (id: string, assigneeUserId: string | null) => ({
  id,
  assigneeUserId,
  counterpartName: 'Iris Demo',
  address: '5493515550101',
  channel: 'WhatsApp',
});

function build(opts: { due?: ReturnType<typeof overdue>[]; claimed?: number[]; tenants?: { id: string; name: string }[] } = {}) {
  const tenants = opts.tenants ?? [{ id: 't-1', name: 'Inmobiliaria Demo' }];
  const claimed = [...(opts.claimed ?? [])];
  const client = {
    conversation: {
      findMany: jest.fn().mockResolvedValue(opts.due ?? []),
      updateMany: jest.fn(async () => ({ count: claimed.length ? claimed.shift()! : 1 })),
    },
  };
  const { tenantCron, prisma } = makeTenantCron(tenants);
  prisma.client = client;
  prisma.baseClient.user = {
    findMany: jest.fn().mockResolvedValue([{ id: 'u-gerente' }, { id: 'u-admin' }]),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n' }) };
  const scheduler = new InboxSlaScheduler(prisma, tenantCron, notifications as never);
  return { scheduler, client, notifications, prisma };
}

describe('InboxSlaScheduler', () => {
  it('busca las consultas con el plazo vencido, sin respuesta y sin marcar, abiertas', async () => {
    const { scheduler, client } = build();
    await scheduler.flagTenant('t-1', NOW);
    expect(client.conversation.findMany.mock.calls[0][0]).toMatchObject({
      where: {
        slaBreachedAt: null,
        firstResponseAt: null,
        slaDueAt: { lte: NOW },
        status: { notIn: ['Resuelta', 'Archivada'] },
      },
      orderBy: [{ slaDueAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('sin consultas vencidas no consulta a la gerencia ni avisa', async () => {
    const { scheduler, notifications, prisma } = build();
    await expect(scheduler.flagTenant('t-1', NOW)).resolves.toBe(0);
    expect(prisma.baseClient.user.findMany).not.toHaveBeenCalled();
    expect(notifications.createNotification).not.toHaveBeenCalled();
  });

  it('marca la consulta una sola vez y avisa al responsable y a la gerencia, sin repetir destinatarios', async () => {
    const { scheduler, client, notifications } = build({ due: [overdue('c-1', 'u-admin')] });
    await expect(scheduler.flagTenant('t-1', NOW)).resolves.toBe(1);
    expect(client.conversation.updateMany).toHaveBeenCalledWith({ where: { id: 'c-1', slaBreachedAt: null }, data: { slaBreachedAt: NOW } });
    const users = notifications.createNotification.mock.calls.map((c) => c[0].userId);
    expect(users).toEqual(['u-admin', 'u-gerente']);
    expect(notifications.createNotification.mock.calls[0][0]).toMatchObject({
      tenantId: 't-1',
      type: 'InboxSlaBreached',
      entityType: 'Conversation',
      entityId: 'c-1',
    });
  });

  it('sin responsable avisa a la gerencia', async () => {
    const { scheduler, notifications } = build({ due: [overdue('c-1', null)] });
    await scheduler.flagTenant('t-1', NOW);
    expect(notifications.createNotification.mock.calls.map((c) => c[0].userId)).toEqual(['u-admin', 'u-gerente']);
  });

  it('si otra instancia ya la marcó (la marca no se pudo tomar) no avisa de nuevo', async () => {
    const { scheduler, notifications } = build({ due: [overdue('c-1', null), overdue('c-2', null)], claimed: [0, 1] });
    await expect(scheduler.flagTenant('t-1', NOW)).resolves.toBe(1);
    expect(notifications.createNotification.mock.calls.every((c) => c[0].entityId === 'c-2')).toBe(true);
  });

  it('recorre cada inmobiliaria con su contexto y cuenta lo marcado; un error en una no corta a las demás', async () => {
    const { scheduler, client } = build({
      tenants: [
        { id: 't-1', name: 'A' },
        { id: 't-2', name: 'B' },
      ],
      due: [overdue('c-1', null)],
    });
    client.conversation.findMany.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([overdue('c-9', null)]);
    await expect(scheduler.flagAllTenants(NOW)).resolves.toEqual({ tenantsProcessed: 1, tenantsFailed: 1, flagged: 1 });
  });

  it('en el ambiente de prueba el cron no corre solo', async () => {
    const { scheduler, client } = build();
    await scheduler.handleSla();
    expect(client.conversation.findMany).not.toHaveBeenCalled();
  });
});
