import { SalesDepositsService } from './sales-deposits.service';
import { IDS, deposit, makeDb, makeTenantContext, operation, utc } from './sales.testing';

const NOW = new Date('2026-11-10T15:00:00Z');

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance'],
  });
});
afterAll(() => jest.useRealTimers());

function build() {
  const db = makeDb();
  const audit = { record: jest.fn() };
  const cash = {
    resolveAgencyAccount: jest.fn().mockResolvedValue({ id: IDS.account }),
    recordMovement: jest.fn().mockResolvedValue({ id: 'm1' }),
  };
  const defaults = { get: jest.fn().mockResolvedValue({ sales: { reservationDays: 7, defaultDepositHolder: 'Inmobiliaria', requireDocsForBoleto: true } }) };
  const service = new SalesDepositsService({ client: db } as any, makeTenantContext() as any, audit as any, cash as any, defaults as any);
  db.salesOperation.findFirst.mockResolvedValue(operation());
  return { service, db, audit, cash };
}

const found = (db: any, d: any) => db.salesDeposit.findFirst.mockResolvedValue(d);
const received = (over: Record<string, unknown> = {}) =>
  deposit({ status: 'Recibida', receivedAt: utc(2026, 11, 5), receivedMovementId: 'm0', ...over });

describe('SalesDepositsService.create', () => {
  it('una reserva sin fecha vence en los días por defecto y la guarda la inmobiliaria', async () => {
    const { service, db, audit } = build();
    const res = await service.create('op1', { kind: 'Reserva', amount: 5000 });
    const data = db.salesDeposit.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: 't1', kind: 'Reserva', currency: 'USD', holder: 'Inmobiliaria', amount: '5000' });
    expect(data.expiresAt).toEqual(utc(2026, 11, 17));
    expect(res.expired).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ entity: 'SalesDeposit', action: 'CREATE' }));
  });

  it('una seña no vence salvo que se indique y puede tener otra moneda y depositario', async () => {
    const { service, db } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Reservada' }));
    db.person.count.mockResolvedValue(2);
    await service.create('op1', { kind: 'Sena', amount: '20000', currency: 'ARS', holder: 'Escribano', holderPersonId: IDS.seller, payerPersonId: IDS.buyer });
    expect(db.salesDeposit.create.mock.calls[0][0].data).toMatchObject({ currency: 'ARS', holder: 'Escribano', expiresAt: null });
    await service.create('op1', { kind: 'Sena', amount: '1', expiresAt: '2026-11-30' });
    expect(db.salesDeposit.create.mock.calls[1][0].data.expiresAt).toEqual(utc(2026, 11, 30));
  });

  it('rechaza etapas que no corresponden, vencimientos pasados, operaciones cerradas y personas inexistentes', async () => {
    const { service, db } = build();
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Captacion' }));
    await expect(service.create('op1', { kind: 'Reserva', amount: '1' })).rejects.toMatchObject({ response: { error: 'INVALID_STAGE_FOR_DEPOSIT' } });
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'SenaRecibida' }));
    await expect(service.create('op1', { kind: 'Reserva', amount: '1' })).rejects.toMatchObject({ response: { error: 'INVALID_STAGE_FOR_DEPOSIT' } });
    db.salesOperation.findFirst.mockResolvedValue(operation());
    await expect(service.create('op1', { kind: 'Reserva', amount: '1', expiresAt: '2026-11-09' })).rejects.toMatchObject({ response: { error: 'EXPIRY_IN_PAST' } });
    db.salesOperation.findFirst.mockResolvedValue(operation({ status: 'Cancelada' }));
    await expect(service.create('op1', { kind: 'Reserva', amount: '1' })).rejects.toMatchObject({ response: { error: 'SALES_OPERATION_CLOSED' } });
    db.salesOperation.findFirst.mockResolvedValue(operation());
    db.person.count.mockResolvedValue(0);
    await expect(service.create('op1', { kind: 'Reserva', amount: '1', payerPersonId: IDS.buyer })).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
  });
});

describe('SalesDepositsService.update', () => {
  it('prorroga el vencimiento y cambia las notas de una reserva viva', async () => {
    const { service, db } = build();
    found(db, deposit());
    await service.update('op1', 'd1', { expiresAt: '2026-12-10', notes: 'prórroga acordada' });
    expect(db.salesDeposit.update.mock.calls[0][0].data).toEqual({ expiresAt: utc(2026, 12, 10), notes: 'prórroga acordada' });
  });

  it('una reserva no puede quedar sin vencimiento ni vencer en el pasado, y una cerrada no se toca', async () => {
    const { service, db } = build();
    found(db, deposit());
    await expect(service.update('op1', 'd1', { expiresAt: null })).rejects.toMatchObject({ response: { error: 'EXPIRY_REQUIRED' } });
    await expect(service.update('op1', 'd1', { expiresAt: '2026-11-01' })).rejects.toMatchObject({ response: { error: 'EXPIRY_IN_PAST' } });
    found(db, deposit({ kind: 'Sena' }));
    await service.update('op1', 'd1', { expiresAt: null });
    expect(db.salesDeposit.update.mock.calls[0][0].data).toEqual({ expiresAt: null });
    found(db, deposit({ status: 'Devuelta' }));
    await expect(service.update('op1', 'd1', { notes: 'x' })).rejects.toMatchObject({ response: { error: 'DEPOSIT_CLOSED' } });
    found(db, null);
    await expect(service.update('op1', 'zz', { notes: 'x' })).rejects.toMatchObject({ response: { error: 'DEPOSIT_NOT_FOUND' } });
  });
});

describe('SalesDepositsService.receive', () => {
  it('con la inmobiliaria como depositaria entra a caja con categoría Sena', async () => {
    const { service, db, cash } = build();
    found(db, deposit());
    const res = await service.receive('op1', 'd1', { receivedAt: '2026-11-09', method: 'Transferencia', accountId: IDS.account });
    expect(cash.resolveAgencyAccount).toHaveBeenCalledWith(db, 't1', { accountId: IDS.account, currency: 'USD', method: 'Transferencia' });
    expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({
      accountId: IDS.account,
      direction: 'In',
      category: 'Sena',
      amount: '5000.00',
      counterpartyId: IDS.buyer,
      sourceType: 'SalesDeposit',
      sourceId: 'd1',
      date: utc(2026, 11, 9),
    });
    expect(db.salesDeposit.update.mock.calls[0][0].data).toEqual({ status: 'Recibida', receivedAt: utc(2026, 11, 9), receivedMovementId: 'm1' });
    expect(res.status).toBe('Recibida');
  });

  it('si lo guarda el vendedor o el escribano solo se anota, sin caja', async () => {
    const { service, db, cash } = build();
    found(db, deposit({ kind: 'Sena', holder: 'Escribano', expiresAt: null }));
    await service.receive('op1', 'd1', { note: 'recibo del escribano' });
    expect(cash.recordMovement).not.toHaveBeenCalled();
    expect(db.salesDeposit.update.mock.calls[0][0].data).toEqual({ status: 'Recibida', receivedAt: utc(2026, 11, 10), receivedMovementId: null });
  });

  it('rechaza una ya recibida, una reserva vencida y una fecha futura', async () => {
    const { service, db } = build();
    found(db, received());
    await expect(service.receive('op1', 'd1', {})).rejects.toMatchObject({ response: { error: 'DEPOSIT_NOT_PENDING' } });
    found(db, deposit({ expiresAt: utc(2026, 11, 9) }));
    await expect(service.receive('op1', 'd1', {})).rejects.toMatchObject({ response: { error: 'DEPOSIT_EXPIRED' } });
    found(db, deposit());
    await expect(service.receive('op1', 'd1', { receivedAt: '2026-11-11' })).rejects.toMatchObject({ response: { error: 'DATE_IN_FUTURE' } });
  });
});

describe('SalesDepositsService.refund', () => {
  it('sale de la misma cuenta donde entró y registra lo devuelto', async () => {
    const { service, db, cash } = build();
    found(db, received());
    db.cashMovement.findFirst.mockResolvedValue({ accountId: IDS.account });
    await service.refund('op1', 'd1', { at: '2026-11-09', amount: '4000', note: 'desistió' });
    expect(cash.resolveAgencyAccount.mock.calls[0][2]).toMatchObject({ accountId: IDS.account, currency: 'USD' });
    expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({ direction: 'Out', category: 'Sena', amount: '4000', sourceType: 'SalesDepositRefund' });
    expect(db.salesDeposit.update.mock.calls[0][0].data).toMatchObject({
      status: 'Devuelta',
      resolvedAt: utc(2026, 11, 9),
      resolvedAmount: '4000',
      resolutionMovementId: 'm1',
      resolutionNote: 'desistió',
    });
  });

  it('sin movimiento de entrada usa la cuenta por defecto, y con otro depositario no toca la caja', async () => {
    const { service, db, cash } = build();
    found(db, received({ receivedMovementId: null }));
    await service.refund('op1', 'd1', {});
    expect(cash.recordMovement.mock.calls[0][1].amount).toBe('5000.00');
    found(db, received({ holder: 'Vendedor' }));
    await service.refund('op1', 'd1', {});
    expect(cash.recordMovement).toHaveBeenCalledTimes(1);
  });

  it('no devuelve más de lo recibido ni algo que no entró ni en el futuro', async () => {
    const { service, db } = build();
    found(db, received());
    await expect(service.refund('op1', 'd1', { amount: '5000.01' })).rejects.toMatchObject({ response: { error: 'REFUND_EXCEEDS_DEPOSIT' } });
    await expect(service.refund('op1', 'd1', { at: '2026-11-11' })).rejects.toMatchObject({ response: { error: 'DATE_IN_FUTURE' } });
    found(db, deposit());
    await expect(service.refund('op1', 'd1', {})).rejects.toMatchObject({ response: { error: 'NO_MONEY_TO_RESOLVE' } });
    found(db, received({ status: 'Devuelta', resolvedAt: utc(2026, 11, 8) }));
    await expect(service.refund('op1', 'd1', {})).rejects.toMatchObject({ response: { error: 'NO_MONEY_TO_RESOLVE' } });
  });
});

describe('SalesDepositsService.forfeit', () => {
  it('registra la retención con su motivo y no mueve la caja', async () => {
    const { service, db, cash, audit } = build();
    found(db, received({ status: 'Vencida' }));
    await service.forfeit('op1', 'd1', { note: 'cláusula de pérdida de la seña' });
    expect(cash.recordMovement).not.toHaveBeenCalled();
    expect(db.salesDeposit.update.mock.calls[0][0].data).toMatchObject({ status: 'Retenida', resolvedAmount: '5000.00', resolutionNote: 'cláusula de pérdida de la seña', resolutionMovementId: null });
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'sales-deposit-forfeit' }) }));
  });

  it('exige motivo, no retiene de más ni dinero que no entró', async () => {
    const { service, db } = build();
    found(db, received());
    await expect(service.forfeit('op1', 'd1', {})).rejects.toBeDefined();
    await expect(service.forfeit('op1', 'd1', { note: 'x', amount: '9999' })).rejects.toMatchObject({ response: { error: 'FORFEIT_EXCEEDS_DEPOSIT' } });
    await expect(service.forfeit('op1', 'd1', { note: 'x', at: '2026-12-01' })).rejects.toMatchObject({ response: { error: 'DATE_IN_FUTURE' } });
    found(db, deposit());
    await expect(service.forfeit('op1', 'd1', { note: 'x' })).rejects.toMatchObject({ response: { error: 'NO_MONEY_TO_RESOLVE' } });
  });
});

describe('SalesDepositsService.pending', () => {
  it('lista el dinero en juego con sus marcas y suma lo retenido por moneda y depositario', async () => {
    const { service, db } = build();
    db.salesDeposit.findMany.mockResolvedValue([deposit({ expiresAt: utc(2026, 11, 1) })]);
    db.salesDeposit.count.mockResolvedValue(1);
    db.salesDeposit.groupBy.mockResolvedValue([{ currency: 'USD', holder: 'Inmobiliaria', _sum: { amount: '5000.00' } }, { currency: 'ARS', holder: 'Escribano', _sum: { amount: null } }]);
    const res = await service.pending({ holder: 'Inmobiliaria', status: 'Recibida' });
    expect(res.items[0].expired).toBe(true);
    expect(res.held).toEqual([
      { currency: 'USD', holder: 'Inmobiliaria', amount: '5000.00' },
      { currency: 'ARS', holder: 'Escribano', amount: '0' },
    ]);
    const where = db.salesDeposit.findMany.mock.calls[0][0].where;
    expect(where.holder).toBe('Inmobiliaria');
    expect(where.AND).toEqual([{ status: 'Recibida' }]);
    expect(where.OR).toHaveLength(2);
  });
});

describe('SalesDepositsService.expireReservations', () => {
  const today = utc(2026, 11, 10);

  it('vence las reservas y libera la operación que queda sin reserva ni seña viva', async () => {
    const { service, db, audit } = build();
    db.salesDeposit.findMany.mockResolvedValue([{ id: 'd1', salesOpId: 'op1' }]);
    db.salesOperation.findFirst.mockResolvedValue({ id: 'op1', status: 'Reservada', deposits: [deposit({ status: 'Vencida' })] });
    expect(await service.expireReservations(today)).toBe(1);
    expect(db.salesDeposit.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'd1', kind: 'Reserva' }, data: { status: 'Vencida' } });
    expect(db.salesOperation.update.mock.calls[0][0]).toEqual({ where: { id: 'op1' }, data: { status: 'Publicada' } });
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'sales-reservation-expire', released: true }), userId: null }));
  });

  it('no libera si queda otra reserva o seña viva, ni una operación que ya no está reservada', async () => {
    const { service, db } = build();
    db.salesDeposit.findMany.mockResolvedValue([{ id: 'd1', salesOpId: 'op1' }]);
    db.salesOperation.findFirst.mockResolvedValue({ id: 'op1', status: 'Reservada', deposits: [deposit({ status: 'Vencida' }), deposit({ id: 'd2', kind: 'Sena' })] });
    await service.expireReservations(today);
    db.salesOperation.findFirst.mockResolvedValue({ id: 'op1', status: 'SenaRecibida', deposits: [] });
    await service.expireReservations(today);
    db.salesOperation.findFirst.mockResolvedValue(null);
    await service.expireReservations(today);
    expect(db.salesOperation.update).not.toHaveBeenCalled();
  });

  it('es idempotente: lo que otro proceso ya venció no se cuenta de nuevo', async () => {
    const { service, db } = build();
    db.salesDeposit.findMany.mockResolvedValue([{ id: 'd1', salesOpId: 'op1' }]);
    db.salesDeposit.updateMany.mockResolvedValue({ count: 0 });
    expect(await service.expireReservations(today)).toBe(0);
    expect(db.salesOperation.update).not.toHaveBeenCalled();
  });

  it('sin reservas vencidas no hace nada', async () => {
    const { service, db } = build();
    expect(await service.expireReservations()).toBe(0);
    expect(db.salesDeposit.findMany.mock.calls[0][0].where.expiresAt.lt).toEqual(utc(2026, 11, 10));
  });
});
