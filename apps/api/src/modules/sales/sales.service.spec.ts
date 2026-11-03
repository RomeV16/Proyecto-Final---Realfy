import { SALES_DOC_TEMPLATE } from '@realfy/shared';
import { SalesService } from './sales.service';
import { IDS, deposit, makeDb, makeTenantContext, operation, utc } from './sales.testing';

const NOW = new Date('2026-11-10T15:00:00Z');

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance'],
  });
});
afterAll(() => jest.useRealTimers());

function build(sales: Record<string, unknown> = {}) {
  const db = makeDb();
  const audit = { record: jest.fn() };
  const defaults = { get: jest.fn().mockResolvedValue({ sales: { reservationDays: 7, defaultDepositHolder: 'Inmobiliaria', requireDocsForBoleto: true, ...sales } }) };
  const service = new SalesService({ client: db } as any, makeTenantContext() as any, audit as any, defaults as any);
  return { service, db, audit };
}

/** Deja la operación en la base simulada para `findOne`/`findOperation`. */
const withOp = (db: any, op: any) => db.salesOperation.findFirst.mockResolvedValue(op);

const doc = (code: string, over: Record<string, unknown> = {}) => ({ id: `doc-${code}`, code, required: true, done: false, ...over });

describe('SalesService lectura', () => {
  it('el embudo filtra por etapa, persona y exclusividad y arma el avance de la documentación', async () => {
    const { service, db } = build();
    db.salesOperation.findMany.mockResolvedValue([
      operation({
        status: 'Reservada',
        docs: [doc('libre_deuda_rentas', { done: true }), doc('informe_dominio'), doc('libre_deuda_expensas', { required: false })],
        deposits: [
          deposit({ id: 'a', expiresAt: utc(2026, 12, 5) }),
          deposit({ id: 'b', expiresAt: utc(2026, 11, 20), status: 'Recibida', receivedAt: utc(2026, 11, 1) }),
          deposit({ id: 'c', kind: 'Sena', expiresAt: null }),
        ],
      }),
    ]);
    db.salesOperation.count.mockResolvedValue(1);
    const res = await service.findAll({ status: 'Reservada', personId: IDS.buyer, exclusive: 'true', page: '1', limit: '10' });
    expect(db.salesOperation.findMany.mock.calls[0][0].where).toEqual({
      status: 'Reservada',
      exclusive: true,
      parties: { some: { personId: IDS.buyer } },
    });
    expect(res.total).toBe(1);
    const [item] = res.items;
    expect(item.docs.map((d: any) => d.code)).toEqual(['informe_dominio', 'libre_deuda_rentas', 'libre_deuda_expensas']);
    expect(item.docProgress).toEqual({ done: 1, total: 3, requiredDone: 1, requiredTotal: 2 });
    expect(item.nextExpiry).toBe('2026-11-20');
    expect(item.validTransitions).toEqual(['SenaRecibida', 'Publicada', 'Cancelada']);
  });

  it('abiertas y cerradas filtran por el conjunto de etapas', async () => {
    const { service, db } = build();
    await service.findAll({ open: 'true' });
    expect(db.salesOperation.findMany.mock.calls[0][0].where.status.in).toContain('Boleto');
    await service.findAll({ open: 'false', propertyId: IDS.prop });
    expect(db.salesOperation.findMany.mock.calls[1][0].where.status.notIn).toContain('Boleto');
    expect(db.salesOperation.findMany.mock.calls[1][0].where.propertyId).toBe(IDS.prop);
  });

  it('un filtro inválido es 400 y una operación inexistente, 404', async () => {
    const { service } = build();
    await expect(service.findAll({ status: 'Nada' })).rejects.toBeDefined();
    await expect(service.findOne('x')).rejects.toMatchObject({ response: { error: 'SALES_OPERATION_NOT_FOUND' } });
  });

  it('las operaciones de una propiedad vienen con su presentación', async () => {
    const { service, db } = build();
    db.salesOperation.findMany.mockResolvedValue([operation()]);
    const res = await service.findByProperty(IDS.prop);
    expect(res.items[0].validTransitions).toContain('Reservada');
  });
});

describe('SalesService.create', () => {
  const body = { propertyId: IDS.prop, price: '120000', parties: [{ role: 'Vendedor', personId: IDS.seller }] };

  it('crea la operación con sus partes y la lista de documentación, y la audita', async () => {
    const { service, db, audit } = build();
    db.salesOperation.create.mockResolvedValue({ id: 'op1' });
    withOp(db, operation());
    db.person.count.mockResolvedValue(1);
    await service.create(body);
    expect(db.salesOperation.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', propertyId: IDS.prop, status: 'Captacion', currency: 'USD', price: '120000' });
    expect(db.salesParty.createMany.mock.calls[0][0].data).toEqual([
      { tenantId: 't1', salesOpId: 'op1', role: 'Vendedor', personId: IDS.seller, sharePct: '100' },
    ]);
    expect(db.salesDocCheck.createMany.mock.calls[0][0].data).toHaveLength(SALES_DOC_TEMPLATE.length);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ action: 'CREATE', entity: 'SalesOperation' }));
  });

  it('una propiedad con una operación abierta es 409', async () => {
    const { service, db } = build();
    db.salesOperation.count.mockResolvedValue(1);
    await expect(service.create(body)).rejects.toMatchObject({ response: { error: 'SALES_OPERATION_EXISTS' } });
    expect(db.salesOperation.create).not.toHaveBeenCalled();
  });

  it('una propiedad, una persona o un usuario inexistentes son 404', async () => {
    const a = build();
    a.db.$queryRaw.mockResolvedValue([]);
    await expect(a.service.create(body)).rejects.toMatchObject({ response: { error: 'PROPERTY_NOT_FOUND' } });
    const b = build();
    b.db.person.count.mockResolvedValue(0);
    await expect(b.service.create(body)).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
    const c = build();
    await expect(c.service.create({ propertyId: IDS.prop, agentUserId: IDS.user })).rejects.toMatchObject({ response: { error: 'USER_NOT_FOUND' } });
  });
});

describe('SalesService cambios', () => {
  it('update cambia solo lo enviado y rechaza una operación cerrada', async () => {
    const { service, db } = build();
    withOp(db, operation());
    await service.update('op1', { exclusive: true, price: '99000' });
    expect(db.salesOperation.update.mock.calls[0][0].data).toEqual({ exclusive: true, price: '99000' });
    withOp(db, operation({ status: 'Escriturada' }));
    await expect(service.update('op1', { exclusive: false })).rejects.toMatchObject({ response: { error: 'SALES_OPERATION_CLOSED' } });
  });

  it('setParties reemplaza las partes y valida a las personas', async () => {
    const { service, db, audit } = build();
    withOp(db, operation());
    db.person.count.mockResolvedValue(2);
    await service.setParties('op1', {
      parties: [
        { role: 'Comprador', personId: IDS.buyer },
        { role: 'Vendedor', personId: IDS.seller, sharePct: 100 },
      ],
    });
    expect(db.salesParty.deleteMany).toHaveBeenCalledWith({ where: { salesOpId: 'op1' } });
    expect(db.salesParty.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: { operation: 'sales-parties' } }));
    db.person.count.mockResolvedValue(1);
    await expect(service.setParties('op1', { parties: [{ role: 'Comprador', personId: IDS.buyer }, { role: 'Vendedor', personId: IDS.seller }] })).rejects.toMatchObject({
      response: { error: 'PERSON_NOT_FOUND' },
    });
  });

  it('una operación sin partes se vacía sin validar personas', async () => {
    const { service, db } = build();
    withOp(db, operation());
    await service.setParties('op1', { parties: [] });
    expect(db.salesParty.createMany).not.toHaveBeenCalled();
  });

  it('updateDoc tilda con fecha y usuario, destilda y deja observaciones', async () => {
    const { service, db } = build();
    withOp(db, operation());
    db.salesDocCheck.findFirst.mockResolvedValue(doc('informe_dominio'));
    await service.updateDoc('op1', 'informe_dominio', { done: true, notes: 'pedido el 3' });
    const done = db.salesDocCheck.update.mock.calls[0][0].data;
    expect(done).toMatchObject({ done: true, doneById: 'u1', notes: 'pedido el 3' });
    expect(done.doneAt).toBeInstanceOf(Date);
    await service.updateDoc('op1', 'informe_dominio', { done: false });
    expect(db.salesDocCheck.update.mock.calls[1][0].data).toEqual({ done: false, doneAt: null, doneById: null });
    db.salesDocCheck.findFirst.mockResolvedValue(null);
    await expect(service.updateDoc('op1', 'otro', { done: true })).rejects.toMatchObject({ response: { error: 'DOC_CHECK_NOT_FOUND' } });
  });
});

describe('SalesService.transition', () => {
  const allDocs = SALES_DOC_TEMPLATE.map((i) => doc(i.code, { required: i.required, done: true }));
  const buyer = { role: 'Comprador', personId: IDS.buyer };
  const move = (service: SalesService, to: string, extra: Record<string, unknown> = {}) => service.transition('op1', { to, ...extra });

  it('una transición que la máquina no permite es 400 con los destinos válidos', async () => {
    const { service, db } = build();
    withOp(db, operation({ status: 'Captacion' }));
    await expect(move(service, 'Boleto', { boletoDate: '2026-11-20' })).rejects.toMatchObject({
      response: { error: 'INVALID_TRANSITION', validTransitions: ['Publicada', 'Cancelada'] },
    });
  });

  it('reservar pide un comprador y una reserva viva', async () => {
    const { service, db } = build();
    withOp(db, operation({ parties: [], deposits: [deposit()] }));
    await expect(move(service, 'Reservada')).rejects.toMatchObject({ response: { error: 'BUYER_REQUIRED' } });
    withOp(db, operation({ parties: [buyer], deposits: [] }));
    await expect(move(service, 'Reservada')).rejects.toMatchObject({ response: { error: 'RESERVATION_REQUIRED' } });
    withOp(db, operation({ parties: [buyer], deposits: [deposit({ status: 'Vencida' })] }));
    await expect(move(service, 'Reservada')).rejects.toMatchObject({ response: { error: 'RESERVATION_REQUIRED' } });
    withOp(db, operation({ parties: [buyer], deposits: [deposit()] }));
    await move(service, 'Reservada', { agreedPrice: '115000' });
    expect(db.salesOperation.update.mock.calls[0][0].data).toEqual({ status: 'Reservada', agreedPrice: '115000' });
  });

  it('SenaRecibida pide una seña recibida', async () => {
    const { service, db } = build();
    withOp(db, operation({ status: 'Reservada', deposits: [deposit({ kind: 'Sena', status: 'Pendiente' })] }));
    await expect(move(service, 'SenaRecibida')).rejects.toMatchObject({ response: { error: 'DEPOSIT_NOT_RECEIVED' } });
    withOp(db, operation({ status: 'Reservada', deposits: [deposit({ kind: 'Sena', status: 'Recibida', receivedAt: utc(2026, 11, 5) })] }));
    await move(service, 'SenaRecibida');
    expect(db.salesOperation.update.mock.calls[0][0].data.status).toBe('SenaRecibida');
  });

  it('boleto exige su fecha y la documentación obligatoria, o el motivo de seguir sin ella', async () => {
    const { service, db } = build();
    withOp(db, operation({ status: 'SenaRecibida', docs: [doc('informe_dominio'), doc('libre_deuda_expensas', { required: false })] }));
    await expect(move(service, 'Boleto', { boletoDate: '2026-11-20' })).rejects.toMatchObject({ response: { error: 'DOCS_PENDING' } });
    await move(service, 'Boleto', { boletoDate: '2026-11-20', docsOverrideReason: 'el escribano la reúne' });
    const data = db.salesOperation.update.mock.calls[0][0].data;
    expect(data.status).toBe('Boleto');
    expect(data.boletoDate).toEqual(utc(2026, 11, 20));
  });

  it('con la exigencia apagada el boleto pasa sin documentación', async () => {
    const { service, db } = build({ requireDocsForBoleto: false });
    withOp(db, operation({ status: 'SenaRecibida', docs: [doc('informe_dominio')] }));
    await move(service, 'Boleto', { boletoDate: '2026-11-20' });
    expect(db.salesOperation.update).toHaveBeenCalled();
  });

  it('escriturar registra la fecha y aplica las señas recibidas; las pendientes vencen', async () => {
    const { service, db, audit } = build();
    withOp(
      db,
      operation({
        status: 'Boleto',
        docs: allDocs,
        deposits: [
          deposit({ id: 'r', status: 'Recibida', receivedAt: utc(2026, 11, 1) }),
          deposit({ id: 's', kind: 'Sena', status: 'Pendiente' }),
          deposit({ id: 'x', status: 'Devuelta', receivedAt: utc(2026, 11, 1), resolvedAt: utc(2026, 11, 2) }),
        ],
      }),
    );
    await move(service, 'Escriturada', { escrituraDate: '2026-11-10' });
    expect(db.salesDeposit.update).toHaveBeenCalledTimes(1);
    expect(db.salesDeposit.update.mock.calls[0][0]).toMatchObject({ where: { id: 'r' }, data: { status: 'Aplicada', resolvedAmount: '5000.00' } });
    expect(db.salesDeposit.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: ['s'] } }, data: { status: 'Vencida' } });
    const patch = db.salesOperation.update.mock.calls[0][0].data;
    expect(patch).toMatchObject({ status: 'Escriturada', escrituraDate: utc(2026, 11, 10) });
    expect(patch.closedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'sales-transition', from: 'Boleto', to: 'Escriturada' }) }));
  });

  it('la escritura no puede ser futura', async () => {
    const { service, db } = build();
    withOp(db, operation({ status: 'Boleto' }));
    await expect(move(service, 'Escriturada', { escrituraDate: '2026-11-11' })).rejects.toMatchObject({ response: { error: 'ESCRITURA_IN_FUTURE' } });
  });

  it('liberar o cancelar con dinero recibido sin resolver se rechaza', async () => {
    const { service, db } = build();
    const unresolved = deposit({ status: 'Recibida', receivedAt: utc(2026, 11, 1) });
    withOp(db, operation({ status: 'Reservada', deposits: [unresolved] }));
    await expect(move(service, 'Publicada')).rejects.toMatchObject({ response: { error: 'DEPOSITS_UNRESOLVED' } });
    withOp(db, operation({ status: 'SenaRecibida', deposits: [deposit({ status: 'Vencida', receivedAt: utc(2026, 11, 1) })] }));
    await expect(move(service, 'Cancelada', { reason: 'se cayó' })).rejects.toMatchObject({ response: { error: 'DEPOSITS_UNRESOLVED' } });
  });

  it('cancelar con el dinero resuelto guarda el motivo y vence las pendientes', async () => {
    const { service, db } = build();
    withOp(
      db,
      operation({
        status: 'Reservada',
        deposits: [deposit({ id: 'p' }), deposit({ id: 'd', status: 'Retenida', receivedAt: utc(2026, 11, 1), resolvedAt: utc(2026, 11, 5) })],
      }),
    );
    await move(service, 'Cancelada', { reason: 'el comprador desistió' });
    expect(db.salesDeposit.updateMany.mock.calls[0][0].where.id.in).toEqual(['p']);
    expect(db.salesOperation.update.mock.calls[0][0].data).toMatchObject({ status: 'Cancelada', cancelReason: 'el comprador desistió' });
  });

  it('volver a publicada libera la operación sin tocar la fecha de cierre', async () => {
    const { service, db } = build();
    withOp(db, operation({ status: 'Reservada', deposits: [] }));
    await move(service, 'Publicada');
    expect(db.salesOperation.update.mock.calls[0][0].data).toEqual({ status: 'Publicada' });
    expect(db.salesDeposit.updateMany).not.toHaveBeenCalled();
  });

  it('pasar a captación o publicar desde captación no toca el dinero', async () => {
    const { service, db } = build();
    withOp(db, operation({ status: 'Captacion' }));
    await move(service, 'Publicada');
    expect(db.salesDeposit.updateMany).not.toHaveBeenCalled();
    withOp(db, operation({ status: 'Publicada' }));
    await move(service, 'Captacion');
    expect(db.salesOperation.update.mock.calls[1][0].data).toEqual({ status: 'Captacion' });
  });
});
