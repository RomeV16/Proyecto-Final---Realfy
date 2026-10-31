import { Logger } from '@nestjs/common';
import { ReportSchedulerService } from './report-scheduler.service';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { REPORT_REGISTRY, REPORT_KEYS } from './report-registry';

const definition = REPORT_REGISTRY[REPORT_KEYS[0]];

function build(schedulesByTenant: Record<string, any[]>) {
  const tenants = Object.keys(schedulesByTenant).map((id) => ({ id, name: `Inmo ${id}` }));
  const { tenantCron, tenantContext } = makeTenantCron(tenants);
  const seenTenants: Array<string | undefined> = [];
  const prisma = {
    client: {
      reportSchedule: {
        findMany: jest.fn(async () => {
          const id = tenantContext.getTenantId();
          seenTenants.push(id);
          return schedulesByTenant[id as string] ?? [];
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  } as any;
  const reportsService = {
    [definition.method]: jest.fn().mockResolvedValue({ title: 'Reporte' }),
  } as any;
  const excel = { generateExcel: jest.fn().mockResolvedValue(Buffer.from('x')) } as any;
  const pdf = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('x')) } as any;
  const email = { sendEmail: jest.fn().mockResolvedValue(true) } as any;
  const scheduler = new ReportSchedulerService(prisma, reportsService, excel, pdf, email, tenantCron);
  return { scheduler, prisma, email, excel, seenTenants };
}

const schedule = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  reportType: REPORT_KEYS[0],
  format: 'excel',
  frequency: 'weekly',
  recipients: ['dueno@inmo.test'],
  filters: null,
  ...overrides,
});

describe('ReportSchedulerService', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('no-ops when NODE_ENV=test (runGuarded skips)', async () => {
    process.env.NODE_ENV = 'test';
    const { scheduler, prisma } = build({ t1: [schedule('s1')] });

    await scheduler.handleScheduledReports();

    expect(prisma.client.reportSchedule.findMany).not.toHaveBeenCalled();
  });

  it('reads the due schedules of each tenant inside its own context and mails them', async () => {
    const { scheduler, prisma, email, seenTenants } = build({
      t1: [schedule('s1')],
      t2: [schedule('s2'), schedule('s3')],
    });

    await scheduler.handleScheduledReports();

    expect(seenTenants).toEqual(['t1', 't2']);
    expect(prisma.client.reportSchedule.findMany.mock.calls[0][0].where).not.toHaveProperty('tenantId');
    expect(email.sendEmail).toHaveBeenCalledTimes(3);
    expect(prisma.client.reportSchedule.update).toHaveBeenCalledTimes(3);
  });

  it('a schedule that fails does not stop the next one, and unknown types are skipped', async () => {
    const { scheduler, prisma, email, excel } = build({
      t1: [schedule('bad'), schedule('unknown', { reportType: 'no-such-report' }), schedule('good')],
    });
    excel.generateExcel.mockRejectedValueOnce(new Error('boom'));

    await scheduler.handleScheduledReports();

    expect(email.sendEmail).toHaveBeenCalledTimes(1);
    expect(prisma.client.reportSchedule.update).toHaveBeenCalledTimes(1);
    expect(prisma.client.reportSchedule.update.mock.calls[0][0].where).toEqual({ id: 'good' });
  });
});
