import { KeysService, daysOverdue } from './keys.service';
import { IDS, makeDb, makeTenantContext, utc } from '../sales/sales.testing';

const NOW = new Date('2026-11-10T15:00:00Z');

beforeAll(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask', 'hrtime', 'performance'],
  });
});
afterAll(() => jest.useRealTimers());

const today = utc(2026, 11, 10);

function build() {
  const db = makeDb();
  const audit = { record: jest.fn() };
  const service = new KeysService({ client: db } as any, makeTenantContext() as any, audit as any);
  db.property.findFirst.mockResolvedValue({ id: IDS.prop });
  return { service, db, audit };
}

const keySet = (over: Record<string, unknown> = {}) => ({
  id: 'k1',
  isActive: true,
  holder: 'Oficina',
  label: 'Principal',
  movements: [],
  ...over,
});
const open = (over: Record<string, unknown> = {}) => ({ id: 'mv1', holder: 'Empleado', outAt: utc(2026, 11, 5), returnedAt: null, expectedReturnAt: null, notes: null, ...over });

describe('daysOverdue', () => {
  it('cuenta los días pasados de la fecha de vuelta', () => {
    expect(daysOverdue(utc(2026, 11, 7), today)).toBe(3);
    expect(daysOverdue(utc(2026, 11, 10), today)).toBe(0);
    expect(daysOverdue(utc(2026, 11, 20), today)).toBe(0);
    expect(daysOverdue(null, today)).toBe(0);
  });
});

describe('KeysService lectura', () => {
  it('lista los juegos de la propiedad con la salida abierta y el atraso', async () => {
    const { service, db } = build();
    db.keySet.findMany.mockResolvedValue([
      keySet({ holder: 'Empleado', movements: [open({ expectedReturnAt: utc(2026, 11, 8) }), open({ id: 'old', returnedAt: utc(2026, 11, 1) })] }),
      keySet({ id: 'k2' }),
    ]);
    const res = await service.listByProperty(IDS.prop);
    expect(res.items[0]).toMatchObject({ overdue: true, daysOverdue: 2, openMovement: { id: 'mv1' } });
    expect(res.items[1]).toMatchObject({ overdue: false, daysOverdue: 0, openMovement: null });
  });

  it('una propiedad inexistente es 404', async () => {
    const { service, db } = build();
    db.property.findFirst.mockResolvedValue(null);
    await expect(service.listByProperty(IDS.prop)).rejects.toMatchObject({ response: { error: 'PROPERTY_NOT_FOUND' } });
  });

  it('"llaves fuera" filtra por quien las tiene, propiedad y atraso, y marca las atrasadas', async () => {
    const { service, db } = build();
    db.keyMovement.findMany.mockResolvedValue([open({ expectedReturnAt: utc(2026, 11, 1) }), open({ id: 'mv2', expectedReturnAt: null })]);
    db.keyMovement.count.mockResolvedValue(2);
    const res = await service.listOut({ holder: 'Empleado', propertyId: IDS.prop, overdue: 'true' });
    expect(db.keyMovement.findMany.mock.calls[0][0].where).toEqual({
      returnedAt: null,
      holder: 'Empleado',
      keySet: { propertyId: IDS.prop },
      expectedReturnAt: { lt: today },
    });
    expect(res.items.map((m: any) => [m.overdue, m.daysOverdue])).toEqual([
      [true, 9],
      [false, 0],
    ]);
    expect(res.total).toBe(2);
  });

  it('findOne devuelve el juego o 404', async () => {
    const { service, db } = build();
    await expect(service.findOne('k1')).rejects.toMatchObject({ response: { error: 'KEY_SET_NOT_FOUND' } });
    db.keySet.findFirst.mockResolvedValue(keySet());
    await expect(service.findOne('k1')).resolves.toMatchObject({ id: 'k1', openMovement: null });
  });
});

describe('KeysService.create', () => {
  it('un juego en la oficina nace sin salida', async () => {
    const { service, db, audit } = build();
    db.keySet.create.mockResolvedValue({ id: 'k1' });
    db.keySet.findFirst.mockResolvedValue(keySet());
    await service.create(IDS.prop, { label: 'Principal', copies: 2, location: 'Caja fuerte, gancho 12' });
    expect(db.keySet.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', propertyId: IDS.prop, copies: 2, holder: 'Oficina', location: 'Caja fuerte, gancho 12' });
    expect(db.keyMovement.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ entity: 'KeySet', action: 'CREATE' }));
  });

  it('un juego que nace con el propietario queda con su salida abierta', async () => {
    const { service, db } = build();
    db.keySet.create.mockResolvedValue({ id: 'k1' });
    db.keySet.findFirst.mockResolvedValue(keySet({ holder: 'Propietario' }));
    db.person.findFirst.mockResolvedValue({ id: IDS.seller });
    await service.create(IDS.prop, { label: 'Principal', holder: 'Propietario', holderPersonId: IDS.seller });
    expect(db.keyMovement.create.mock.calls[0][0].data).toMatchObject({ keySetId: 'k1', holder: 'Propietario', holderPersonId: IDS.seller, outAt: today, outById: 'u1' });
  });

  it('quien las tiene debe existir', async () => {
    const { service, db } = build();
    await expect(service.create(IDS.prop, { label: 'P', holder: 'Propietario', holderPersonId: IDS.seller })).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
    db.person.findFirst.mockResolvedValue({ id: 'x' });
    await expect(service.create(IDS.prop, { label: 'P', holder: 'Empleado', holderUserId: IDS.user })).rejects.toMatchObject({ response: { error: 'USER_NOT_FOUND' } });
  });
});

describe('KeysService.update', () => {
  it('cambia lo enviado y no da de baja un juego que está fuera', async () => {
    const { service, db } = build();
    db.keySet.findFirst.mockResolvedValue(keySet());
    await service.update('k1', { label: 'Garaje', copies: 3, isActive: false });
    expect(db.keySet.update.mock.calls[0][0].data).toEqual({ label: 'Garaje', copies: 3, isActive: false });
    db.keySet.findFirst.mockResolvedValue(keySet({ holder: 'Empleado' }));
    await expect(service.update('k1', { isActive: false })).rejects.toMatchObject({ response: { error: 'KEY_SET_OUT' } });
  });

  it('un juego inexistente es 404', async () => {
    const { service, db } = build();
    db.$queryRaw.mockResolvedValue([]);
    await expect(service.update('k1', { label: 'x' })).rejects.toMatchObject({ response: { error: 'KEY_SET_NOT_FOUND' } });
  });
});

describe('KeysService.checkOut', () => {
  const out = { holder: 'Empleado', holderUserId: IDS.user, reason: 'Visita', expectedReturnAt: '2026-11-12' };

  it('abre la salida y deja el juego con quien lo retira', async () => {
    const { service, db, audit } = build();
    db.keySet.findFirst.mockResolvedValue(keySet());
    db.user.findFirst.mockResolvedValue({ id: IDS.user });
    await service.checkOut('k1', out);
    expect(db.keyMovement.create.mock.calls[0][0].data).toMatchObject({
      keySetId: 'k1',
      holder: 'Empleado',
      holderUserId: IDS.user,
      reason: 'Visita',
      outAt: today,
      expectedReturnAt: utc(2026, 11, 12),
      outById: 'u1',
    });
    expect(db.keySet.update.mock.calls[0][0].data).toEqual({ holder: 'Empleado', holderPersonId: null, holderUserId: IDS.user, holderName: null });
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'key-check-out' }) }));
  });

  it('rechaza un juego inactivo, ya fuera, una fecha futura, una vuelta anterior a la salida y un usuario inexistente', async () => {
    const { service, db } = build();
    db.keySet.findFirst.mockResolvedValue(keySet({ isActive: false }));
    await expect(service.checkOut('k1', out)).rejects.toMatchObject({ response: { error: 'KEY_SET_INACTIVE' } });
    db.keySet.findFirst.mockResolvedValue(keySet());
    db.keyMovement.count.mockResolvedValue(1);
    await expect(service.checkOut('k1', out)).rejects.toMatchObject({ response: { error: 'KEY_ALREADY_OUT' } });
    db.keyMovement.count.mockResolvedValue(0);
    await expect(service.checkOut('k1', { ...out, outAt: '2026-11-11' })).rejects.toMatchObject({ response: { error: 'DATE_IN_FUTURE' } });
    await expect(service.checkOut('k1', { ...out, outAt: '2026-11-09', expectedReturnAt: '2026-11-08' })).rejects.toMatchObject({ response: { error: 'RETURN_BEFORE_OUT' } });
    await expect(service.checkOut('k1', out)).rejects.toMatchObject({ response: { error: 'USER_NOT_FOUND' } });
  });

  it('una salida sin fecha de vuelta queda abierta sin plazo', async () => {
    const { service, db } = build();
    db.keySet.findFirst.mockResolvedValue(keySet());
    await service.checkOut('k1', { holder: 'Tercero', holderName: 'Escribana Gómez' });
    expect(db.keyMovement.create.mock.calls[0][0].data).toMatchObject({ expectedReturnAt: null, holderName: 'Escribana Gómez' });
  });
});

describe('KeysService.checkIn', () => {
  it('cierra la salida abierta y el juego vuelve a la oficina', async () => {
    const { service, db, audit } = build();
    db.keySet.findFirst.mockResolvedValue(keySet({ holder: 'Empleado' }));
    db.keyMovement.findFirst.mockResolvedValue(open({ notes: 'visita' }));
    await service.checkIn('k1', { returnedAt: '2026-11-09', location: 'Gancho 3', notes: 'sin novedades' });
    expect(db.keyMovement.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'mv1' },
      data: { returnedAt: utc(2026, 11, 9), returnedById: 'u1', notes: 'visita | sin novedades' },
    });
    expect(db.keySet.update.mock.calls[0][0].data).toEqual({ holder: 'Oficina', holderPersonId: null, holderUserId: null, holderName: null, location: 'Gancho 3' });
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'key-check-in' }) }));
  });

  it('sin notas ni lugar nuevos conserva lo que había', async () => {
    const { service, db } = build();
    db.keySet.findFirst.mockResolvedValue(keySet({ holder: 'Empleado' }));
    db.keyMovement.findFirst.mockResolvedValue(open({ notes: 'visita' }));
    await service.checkIn('k1', {});
    expect(db.keyMovement.update.mock.calls[0][0].data).toMatchObject({ returnedAt: today, notes: 'visita' });
    expect(db.keySet.update.mock.calls[0][0].data).not.toHaveProperty('location');
  });

  it('rechaza un juego que ya está en la oficina, fechas futuras y devoluciones anteriores a la salida', async () => {
    const { service, db } = build();
    db.keySet.findFirst.mockResolvedValue(keySet());
    await expect(service.checkIn('k1', {})).rejects.toMatchObject({ response: { error: 'KEY_NOT_OUT' } });
    db.keyMovement.findFirst.mockResolvedValue(open());
    await expect(service.checkIn('k1', { returnedAt: '2026-11-11' })).rejects.toMatchObject({ response: { error: 'DATE_IN_FUTURE' } });
    await expect(service.checkIn('k1', { returnedAt: '2026-11-04' })).rejects.toMatchObject({ response: { error: 'RETURN_BEFORE_OUT' } });
  });
});
