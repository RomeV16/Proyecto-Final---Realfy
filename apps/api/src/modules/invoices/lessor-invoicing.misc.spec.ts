import { LessorInvoicingController } from './lessor-invoicing.controller';
import { LessorInvoicingScheduler } from './lessor-invoicing.scheduler';
import { creditNoteRequestId, enqueueCreditNotes, invoiceRequestId, requestIdFor } from './lessor-invoice-queue';

describe('claves de idempotencia de la facturación por cuenta del locador', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

  it('son estables, con forma de UUID y distintas por origen, locador y contrato', () => {
    const a = invoiceRequestId('Payment', 'pay-1', 'p-1', 'c-1');
    expect(a).toMatch(UUID);
    expect(invoiceRequestId('Payment', 'pay-1', 'p-1', 'c-1')).toBe(a);
    expect(invoiceRequestId('Payment', 'pay-1', 'p-1', 'c-2')).not.toBe(a);
    expect(invoiceRequestId('Payment', 'pay-1', 'p-2', 'c-1')).not.toBe(a);
    expect(invoiceRequestId('OwnerStatement', 'pay-1', 'p-1', 'c-1')).not.toBe(a);
    expect(creditNoteRequestId('cmp-1')).toMatch(UUID);
    expect(creditNoteRequestId('cmp-1')).not.toBe(creditNoteRequestId('cmp-2'));
    expect(requestIdFor('x')).toBe(requestIdFor('x'));
  });
});

describe('enqueueCreditNotes', () => {
  it('deja en cola una nota de crédito por cada locador facturado por el origen', async () => {
    const tx: any = {
      lessorInvoiceJob: {
        findMany: jest.fn(async () => [{ personId: 'p-1' }, { personId: 'p-2' }]),
        createMany: jest.fn(async (a: any) => ({ count: a.data.length })),
      },
    };
    expect(await enqueueCreditNotes(tx, 't-1', 'OwnerStatement', 'st-1')).toBe(2);
    expect(tx.lessorInvoiceJob.findMany.mock.calls[0][0].where).toMatchObject({ kind: 'Factura', status: 'Emitido', sourceId: 'st-1' });
    expect(tx.lessorInvoiceJob.createMany.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [
        { tenantId: 't-1', personId: 'p-1', kind: 'NotaCredito', sourceType: 'OwnerStatement', sourceId: 'st-1', auto: true },
        { personId: 'p-2', kind: 'NotaCredito' },
      ],
    });
  });

  it('sin facturas emitidas no escribe nada', async () => {
    const tx: any = { lessorInvoiceJob: { findMany: jest.fn(async () => []), createMany: jest.fn() } };
    expect(await enqueueCreditNotes(tx, 't-1', 'OwnerStatement', 'st-1')).toBe(0);
    expect(tx.lessorInvoiceJob.createMany).not.toHaveBeenCalled();
  });
});

describe('LessorInvoicingController', () => {
  const svc: any = {
    getSettings: jest.fn(async () => 'settings'),
    saveSettings: jest.fn(async () => 'saved'),
    createIssuer: jest.fn(async () => 'issuer'),
    listForSource: jest.fn(async () => 'list'),
    invoicePayment: jest.fn(async () => 'paid'),
    invoiceStatement: jest.fn(async () => 'stated'),
    listJobs: jest.fn(async () => 'jobs'),
    runPending: jest.fn(async () => 'run'),
  };
  const controller = new LessorInvoicingController(svc);

  it('delega cada ruta en el servicio', async () => {
    expect(await controller.settings('p')).toBe('settings');
    expect(await controller.saveSettings('p', { when: 'AlPagar' })).toBe('saved');
    expect(await controller.createIssuer('p', {})).toBe('issuer');
    expect(await controller.paymentInvoices('pay')).toBe('list');
    expect(svc.listForSource).toHaveBeenLastCalledWith('Payment', 'pay');
    expect(await controller.statementInvoices('st')).toBe('list');
    expect(svc.listForSource).toHaveBeenLastCalledWith('OwnerStatement', 'st');
    expect(await controller.invoicePayment('pay', undefined)).toBe('paid');
    expect(svc.invoicePayment).toHaveBeenLastCalledWith('pay', {});
    expect(await controller.invoicePayment('pay', { personId: 'p' })).toBe('paid');
    expect(await controller.invoiceStatement('st')).toBe('stated');
    expect(await controller.pending({ status: 'Fallido' })).toBe('jobs');
    expect(await controller.run(undefined)).toBe('run');
    expect(svc.runPending).toHaveBeenLastCalledWith({ retryAll: false, personId: undefined });
    await controller.run({ retryAll: true, personId: 'p' });
    expect(svc.runPending).toHaveBeenLastCalledWith({ retryAll: true, personId: 'p' });
  });
});

describe('LessorInvoicingScheduler', () => {
  const build = () => {
    const lessor: any = { runPending: jest.fn(async () => ({ emitted: 2, failed: 1 })) };
    const tenantCron: any = {
      forEachActiveTenant: jest.fn(async (_name: string, fn: (id: string) => Promise<void>) => {
        await fn('t-1');
        await fn('t-2');
        return { ok: 2, failed: 0 };
      }),
    };
    return { scheduler: new LessorInvoicingScheduler(lessor, tenantCron), lessor, tenantCron };
  };

  it('recorre las inmobiliarias y suma lo emitido y lo fallido', async () => {
    const { scheduler, lessor, tenantCron } = build();
    expect(await scheduler.runForAllTenants()).toEqual({ emitted: 4, failed: 2 });
    expect(lessor.runPending).toHaveBeenCalledTimes(2);
    expect(tenantCron.forEachActiveTenant).toHaveBeenCalledWith('lessor-invoices-run', expect.any(Function));
  });

  it('el cron no corre en el entorno de pruebas', async () => {
    const { scheduler, lessor } = build();
    await scheduler.handleRun();
    expect(lessor.runPending).not.toHaveBeenCalled();
  });
});
