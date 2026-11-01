import { ImportPersonSchema, ImportPropertySchema } from '@realfy/shared';
import { accountKey, personFields, personImporter } from './person.importer';
import { propertyFields, propertyImporter, propertyTitle } from './property.importer';
import { ImportContext, ImportRowError } from './import-types';

const ctx = { tenantId: 't1', defaults: {} } as unknown as ImportContext;
const CBU = '0000000000000000000001';

const parsePerson = (raw: unknown) => ImportPersonSchema.parse(raw);
const parseProperty = (raw: unknown) => ImportPropertySchema.parse(raw);

describe('personFields', () => {
  it('una persona física toma nombre y apellido', () => {
    const f = personFields(parsePerson({ externalRef: 'P', firstName: 'Ana', lastName: 'Paz', dni: '1' }));
    expect(f).toMatchObject({ personType: 'Fisica', firstName: 'Ana', lastName: 'Paz', dni: '1' });
  });

  it('una razón social va en firstName y deja el apellido vacío', () => {
    const f = personFields(parsePerson({ externalRef: 'P', personType: 'Juridica', businessName: 'Ejemplo SA' }));
    expect(f).toMatchObject({ firstName: 'Ejemplo SA', lastName: '' });
  });

  it('lo que la fila no informa queda indefinido, para no pisarlo al actualizar', () => {
    const f = personFields(parsePerson({ externalRef: 'P', firstName: 'Ana' }));
    expect(f.email).toBeUndefined();
    expect(f.lastName).toBeUndefined();
  });
});

describe('ImportPersonSchema', () => {
  it.each([
    [{ externalRef: 'P' }, 'firstName'],
    [{ externalRef: 'P', personType: 'Juridica', firstName: 'x' }, 'businessName'],
    [{ firstName: 'Ana' }, 'externalRef'],
    [{ externalRef: 'P', firstName: 'Ana', bankAccounts: [{ currency: 'ARS' }] }, 'bankAccounts'],
    [{ externalRef: 'P', firstName: 'Ana', desconocido: 1 }, ''],
  ])('rechaza %j', (raw, field) => {
    const r = ImportPersonSchema.safeParse(raw);
    expect(r.success).toBe(false);
    if (!r.success && field) expect(r.error.issues[0].path[0]).toBe(field);
  });
});

describe('accountKey', () => {
  it('usa el CBU y, sin CBU, el alias', () => {
    expect(accountKey({ cbu: CBU, alias: 'a' })).toBe(`cbu:${CBU}`);
    expect(accountKey({ alias: 'mi.alias' })).toBe('alias:mi.alias');
    expect(accountKey({ cbu: null, alias: null })).toBe('alias:');
  });
});

describe('personImporter.upsert (reglas de idempotencia)', () => {
  function fakeDb(existing: any | null) {
    return {
      person: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          if (args.select) return { tenantId: 't1' };
          return existing;
        }),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      personRoleAssignment: { upsert: jest.fn().mockResolvedValue({}) },
      personBankAccount: {
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'acc', ...data })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({}),
      },
    };
  }
  const stored = (extra: Record<string, unknown> = {}) => ({
    id: 'p1',
    firstName: 'Ana',
    lastName: 'Paz',
    personType: 'Fisica',
    email: 'ana@ejemplo.test',
    roles: [{ role: 'Propietario' }],
    bankAccounts: [{ id: 'a1', currency: 'ARS', cbu: CBU, alias: 'ana', bankName: null, holder: 'Ana Paz', isDefault: true }],
    ...extra,
  });
  const input = (extra: Record<string, unknown> = {}) =>
    parsePerson({ externalRef: 'P', firstName: 'Ana', lastName: 'Paz', email: 'ana@ejemplo.test', roles: ['Propietario'], ...extra });

  it('una persona nueva es Creado con su cuenta predeterminada y sus roles', async () => {
    const db = fakeDb(null);
    const out = await personImporter.upsert(db, ctx, input({ bankAccounts: [{ currency: 'ARS', cbu: CBU }] }));
    expect(out).toEqual({ action: 'Creado', entityId: 'new' });
    expect(db.person.create.mock.calls[0][0].data).toMatchObject({ tenantId: 't1', externalRef: 'P', lastName: 'Paz' });
    expect(db.personBankAccount.create.mock.calls[0][0].data).toMatchObject({ isDefault: true, holder: 'Ana Paz' });
    expect(db.personRoleAssignment.upsert).toHaveBeenCalledTimes(1);
  });

  it('los mismos datos son SinCambios y no escriben', async () => {
    const db = fakeDb(stored());
    const out = await personImporter.upsert(db, ctx, input({ bankAccounts: [{ currency: 'ARS', cbu: CBU, alias: 'ana' }] }));
    expect(out.action).toBe('SinCambios');
    expect(db.person.update).not.toHaveBeenCalled();
    expect(db.personBankAccount.update).not.toHaveBeenCalled();
    expect(db.personBankAccount.create).not.toHaveBeenCalled();
    expect(db.personRoleAssignment.upsert).not.toHaveBeenCalled();
  });

  it('un campo distinto es Actualizado y sólo escribe ese campo', async () => {
    const db = fakeDb(stored());
    const out = await personImporter.upsert(db, ctx, input({ email: 'otra@ejemplo.test' }));
    expect(out.action).toBe('Actualizado');
    expect(db.person.update.mock.calls[0][0].data).toEqual({ email: 'otra@ejemplo.test' });
  });

  it('un campo ausente en la fila no se borra', async () => {
    const db = fakeDb(stored());
    const out = await personImporter.upsert(db, ctx, parsePerson({ externalRef: 'P', firstName: 'Ana' }));
    expect(out.action).toBe('SinCambios');
  });

  it('un rol que falta es Actualizado; los roles de más no se quitan', async () => {
    const db = fakeDb(stored());
    const out = await personImporter.upsert(db, ctx, input({ roles: ['Propietario', 'Inquilino'] }));
    expect(out.action).toBe('Actualizado');
    expect(db.personRoleAssignment.upsert).toHaveBeenCalledTimes(1);

    const db2 = fakeDb(stored({ roles: [{ role: 'Propietario' }, { role: 'Garante' }] }));
    expect((await personImporter.upsert(db2, ctx, input())).action).toBe('SinCambios');
  });

  it('una cuenta nueva se agrega y la existente cambiada se corrige, sin borrar otras', async () => {
    const db = fakeDb(stored());
    const out = await personImporter.upsert(
      db,
      ctx,
      input({
        bankAccounts: [
          { currency: 'ARS', cbu: CBU, alias: 'ana.nuevo' },
          { currency: 'USD', alias: 'ana.usd' },
        ],
      }),
    );
    expect(out.action).toBe('Actualizado');
    expect(db.personBankAccount.update.mock.calls[0][0].data).toEqual({ alias: 'ana.nuevo' });
    expect(db.personBankAccount.create.mock.calls[0][0].data).toMatchObject({ currency: 'USD', isDefault: true });
  });

  it('marcar una cuenta como predeterminada desmarca las otras de la moneda', async () => {
    const db = fakeDb(stored());
    await personImporter.upsert(db, ctx, input({ bankAccounts: [{ currency: 'ARS', alias: 'segunda', isDefault: true }] }));
    expect(db.personBankAccount.updateMany).toHaveBeenCalledWith({
      where: { personId: 'p1', currency: 'ARS', isDefault: true, id: { not: 'acc' } },
      data: { isDefault: false },
    });
  });
});

describe('propertyTitle y propertyFields', () => {
  it('arma el título con la dirección y la unidad', () => {
    expect(propertyTitle(parseProperty({ externalRef: 'U', type: 'Departamento', street: 'Calle', number: '1', floor: '2', unit: 'B' }))).toBe(
      'Calle 1, Piso 2 Depto B',
    );
  });

  it('un título explícito manda y sin dirección no hay título', () => {
    expect(propertyTitle(parseProperty({ externalRef: 'U', type: 'Casa', title: 'La casa', street: 'x' }))).toBe('La casa');
    expect(propertyTitle(parseProperty({ externalRef: 'U', type: 'Casa' }))).toBeUndefined();
  });

  it('unit se guarda como apartment', () => {
    expect(propertyFields(parseProperty({ externalRef: 'U', type: 'Casa', unit: '3' })).apartment).toBe('3');
  });
});

describe('propertyImporter.upsert', () => {
  const stored = (extra: Record<string, unknown> = {}) => ({
    id: 'u1',
    title: 'Calle 1',
    type: 'Casa',
    street: 'Calle',
    number: '1',
    city: null,
    parentPropertyId: null,
    ownerships: [{ personId: 'own1', sharePct: '100' }],
    ...extra,
  });
  function fakeDb(existing: any | null, people: Record<string, string> = { O1: 'own1' }) {
    return {
      property: {
        findFirst: jest.fn().mockImplementation(async (args: any) => (args.include ? existing : { id: 'parent' })),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      person: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          people[where.externalRef] ? { id: people[where.externalRef] } : null,
        ),
      },
      propertyOwnership: { deleteMany: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
    };
  }
  const input = (extra: Record<string, unknown> = {}) =>
    parseProperty({ externalRef: 'U', type: 'Casa', street: 'Calle', number: '1', ...extra });

  it('nueva: Creado con el título derivado o, sin dirección, la referencia', async () => {
    const db = fakeDb(null);
    expect((await propertyImporter.upsert(db, ctx, input())).action).toBe('Creado');
    expect(db.property.create.mock.calls[0][0].data.title).toBe('Calle 1');
    await propertyImporter.upsert(db, ctx, parseProperty({ externalRef: 'SIN-DIR', type: 'Lote' }));
    expect(db.property.create.mock.calls[1][0].data.title).toBe('SIN-DIR');
  });

  it('igual: SinCambios', async () => {
    const db = fakeDb(stored());
    const out = await propertyImporter.upsert(db, ctx, input({ owners: [{ personExternalRef: 'O1', sharePct: 100 }] }));
    expect(out.action).toBe('SinCambios');
    expect(db.propertyOwnership.deleteMany).not.toHaveBeenCalled();
  });

  it('un dato o la titularidad distinta: Actualizado', async () => {
    const db = fakeDb(stored());
    expect((await propertyImporter.upsert(db, ctx, input({ city: 'Cordoba' }))).action).toBe('Actualizado');
    expect(db.property.update.mock.calls[0][0].data).toEqual({ city: 'Cordoba' });

    const db2 = fakeDb(stored());
    const out = await propertyImporter.upsert(db2, ctx, input({ owners: [{ personExternalRef: 'O1', sharePct: 50 }] }));
    expect(out.action).toBe('Actualizado');
    expect(db2.propertyOwnership.create).toHaveBeenCalledTimes(1);
  });

  it('un titular que no existe es REFERENCE_NOT_FOUND con el campo', async () => {
    const db = fakeDb(stored());
    const err = await propertyImporter
      .upsert(db, ctx, input({ owners: [{ personExternalRef: 'NADIE' }] }))
      .catch((e) => e as ImportRowError);
    expect(err).toBeInstanceOf(ImportRowError);
    expect((err as ImportRowError).details[0]).toMatchObject({ code: 'REFERENCE_NOT_FOUND', field: 'owners[0].personExternalRef' });
  });

  it('un titular repetido es error de la fila', async () => {
    const db = fakeDb(stored());
    const err = await propertyImporter
      .upsert(db, ctx, input({ owners: [{ personExternalRef: 'O1' }, { personExternalRef: 'O1' }] }))
      .catch((e) => e as ImportRowError);
    expect((err as ImportRowError).details[0].code).toBe('VALIDATION_ERROR');
  });
});
