import { ForbiddenException } from '@nestjs/common';
import { CollectionActionKind as K, CollectionActionStatus } from '@realfy/shared';
import { PdfRendererService } from '../../common/pdf/pdf-renderer.service';
import { CollectionLetterService } from './collection-letter.service';
import { CollectionsController } from './collections.controller';
import { CollectionsScheduler } from './collections.scheduler';
import { day, makeFakeCollections } from './collections.testing';

const LETTER = {
  recipientName: 'Ana Prueba',
  recipientAddress: 'Calle Falsa 123',
  propertyAddress: 'Calle Demo 742',
  periods: '03/2026',
  amount: 'ARS 100.000,00',
  issuedOn: '11/04/2026',
  termDays: 10,
  extraText: 'Texto extra',
};

function setup(status: CollectionActionStatus = CollectionActionStatus.Preparada) {
  const f = makeFakeCollections({
    cases: [{ id: 'case-1' }],
    actions: [{ id: 'let-1', kind: K.CartaDocumento, status, data: LETTER, onDate: status === CollectionActionStatus.Realizada ? day('2026-04-13') : null }],
  });
  const renderer = { render: jest.fn(async () => Buffer.from('%PDF-1.4 demo')) } as unknown as PdfRendererService;
  const letters = new CollectionLetterService(f.service, renderer, f.prisma, f.tenantContext);
  const proc = { runTenant: jest.fn(async () => ({ opened: 1 })), runAll: jest.fn(async () => ({})) } as any;
  const service = {
    list: jest.fn(async () => 'list'),
    get: jest.fn(async () => 'get'),
    assign: jest.fn(async () => 'assign'),
    addNote: jest.fn(async () => 'note'),
    agree: jest.fn(async () => 'agree'),
    updateLetter: jest.fn(async () => 'edit'),
    confirmLetterSent: jest.fn(async () => 'sent'),
    derive: jest.fn(async () => 'derive'),
    judicialize: jest.fn(async () => 'judicial'),
    close: jest.fn(async () => 'close'),
    currentTenantId: jest.fn(() => 'tenant-1'),
  } as any;
  const controller = new CollectionsController(service, letters, proc);
  return { f, renderer, letters, proc, service, controller };
}

describe('CollectionsController', () => {
  it('delega cada ruta en el servicio', async () => {
    const { controller, service } = setup();
    expect(await controller.list({ stage: 'Recordatorio' })).toBe('list');
    expect(await controller.get('c')).toBe('get');
    expect(await controller.assign('c', { assigneeId: null })).toBe('assign');
    expect(await controller.note('c', { note: 'x' })).toBe('note');
    expect(await controller.agreement('c', { payOn: '2026-03-30' })).toBe('agree');
    expect(await controller.editLetter('c', 'a', {})).toBe('edit');
    expect(await controller.letterSent('c', 'a', { sentOn: '2026-04-13' })).toBe('sent');
    expect(await controller.derive('c', {})).toBe('derive');
    expect(await controller.judicial('c', {})).toBe('judicial');
    expect(await controller.close('c', { note: 'x' })).toBe('close');
    expect(service.list).toHaveBeenCalledWith({ stage: 'Recordatorio' });
  });

  describe('_run-now', () => {
    const saved = { nodeEnv: process.env.NODE_ENV, e2e: process.env.E2E_TEST_MODE };
    afterEach(() => {
      process.env.NODE_ENV = saved.nodeEnv;
      if (saved.e2e === undefined) delete process.env.E2E_TEST_MODE;
      else process.env.E2E_TEST_MODE = saved.e2e;
    });

    it('corre una vuelta de la inmobiliaria del pedido, a un día opcional, solo en modo de prueba', async () => {
      const { controller, proc } = setup();
      await controller.runNow({ today: '2026-03-15' });
      expect(proc.runTenant).toHaveBeenCalledWith('tenant-1', day('2026-03-15'));
      await controller.runNow(undefined);
      expect(proc.runTenant).toHaveBeenLastCalledWith('tenant-1', undefined);
    });

    it('fuera del modo de prueba responde 403', async () => {
      const { controller } = setup();
      process.env.NODE_ENV = 'production';
      delete process.env.E2E_TEST_MODE;
      await expect(controller.runNow({})).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('el PDF sale inline con su nombre y su largo', async () => {
    const { controller } = setup();
    const res = { set: jest.fn(), end: jest.fn() } as any;
    await controller.letterPdf('case-1', 'let-1', res);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="carta-documento-let-1.pdf"' }),
    );
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF-1.4 demo'));
  });
});

describe('CollectionLetterService', () => {
  it('el borrador lleva la marca de agua y la advertencia de revisión profesional', async () => {
    const { letters, renderer } = setup();
    const { buffer, filename } = await letters.pdf('case-1', 'let-1');
    expect(buffer.toString()).toContain('%PDF');
    expect(filename).toBe('carta-documento-let-1.pdf');
    const doc = (renderer.render as jest.Mock).mock.calls[0][0];
    expect(doc.watermark).toMatchObject({ text: 'BORRADOR' });
    const text = JSON.stringify(doc.content);
    expect(text).toContain('no vale como intimación hasta que lo revise un profesional');
    expect(text).toContain('Ana Prueba');
    expect(text).toContain('03/2026');
    expect(text).toContain('ARS 100.000,00');
    expect(text).toContain('10 días corridos');
    expect(text).toContain('Texto extra');
  });

  it('una vez confirmado el envío ya no lleva la marca de borrador', async () => {
    const { letters, renderer } = setup(CollectionActionStatus.Realizada);
    await letters.pdf('case-1', 'let-1');
    expect((renderer.render as jest.Mock).mock.calls[0][0].watermark).toBeUndefined();
  });

  it('con campos vacíos arma el documento igual', async () => {
    const { f, renderer, letters } = setup();
    f.actions[0].data = { ...LETTER, recipientName: '', recipientAddress: '', propertyAddress: '', periods: '', amount: '', extraText: '' };
    f.prisma.baseClient.tenant.findFirst.mockResolvedValueOnce({ name: 'Inmobiliaria Demo', cuit: '30-00000000-0' });
    await letters.pdf('case-1', 'let-1');
    expect(JSON.stringify((renderer.render as jest.Mock).mock.calls[0][0].content)).toContain('CUIT: 30-00000000-0');
  });
});

describe('CollectionsScheduler', () => {
  it('el proceso diario corre una vuelta de todas las inmobiliarias', async () => {
    const proc = { runAll: jest.fn(async () => ({})) } as any;
    const prev = process.env.NODE_ENV;
    // `runGuarded` no corre con NODE_ENV=test: se simula otro ambiente.
    process.env.NODE_ENV = 'production';
    try {
      await new CollectionsScheduler(proc).handleDaily();
    } finally {
      process.env.NODE_ENV = prev;
    }
    expect(proc.runAll).toHaveBeenCalledTimes(1);
  });

  it('en el ambiente de prueba no corre', async () => {
    const proc = { runAll: jest.fn() } as any;
    await new CollectionsScheduler(proc).handleDaily();
    expect(proc.runAll).not.toHaveBeenCalled();
  });
});
