import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MERGE_RULES } from './person-merge.config';
import { PersonMergeService } from './person-merge.service';

const KEEP = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;

const matches = (row: Row, where: Row = {}): boolean =>
  Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && 'in' in v ? (v.in as unknown[]).includes(row[k]) : row[k] === v,
  );

/** Base en memoria con las operaciones que usa la unión. */
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  const db: Record<string, any> = { tables, audit: [] as Row[] };
  const names = new Set([...Object.keys(seed), ...MERGE_RULES.map((r) => r.delegate), 'person', 'personBankAccount', 'contractLessor', 'powerOfAttorney']);
  for (const name of names) {
    tables[name] = (seed[name] ?? []).map((r) => ({ ...r }));
    db[name] = {
      findMany: async ({ where }: Row = {}) => tables[name].filter((r) => matches(r, where)).map((r) => ({ ...r })),
      count: async ({ where }: Row = {}) => tables[name].filter((r) => matches(r, where)).length,
      updateMany: async ({ where, data }: Row) => {
        const rows = tables[name].filter((r) => matches(r, where));
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
      deleteMany: async ({ where }: Row) => {
        const before = tables[name].length;
        tables[name] = tables[name].filter((r) => !matches(r, where));
        return { count: before - tables[name].length };
      },
      update: async ({ where, data }: Row) => {
        const row = tables[name].find((r) => matches(r, where))!;
        Object.assign(row, data);
        return { ...row };
      },
    };
  }
  db.$transaction = async (fn: (tx: any) => Promise<any>) => {
    const snapshot = JSON.stringify(tables);
    try {
      return await fn(db);
    } catch (e) {
      for (const k of Object.keys(tables)) tables[k] = JSON.parse(snapshot)[k];
      throw e;
    }
  };
  return db;
}

const person = (id: string, extra: Row = {}): Row => ({
  id,
  firstName: 'Ana',
  lastName: 'Sintética',
  isActive: true,
  cuit: null,
  email: null,
  phone: null,
  notes: null,
  ...extra,
});

function setup(seed: Record<string, Row[]>) {
  const db = fakeDb({ person: [person(KEEP), person(A), person(B)], ...seed });
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new PersonMergeService({ client: db } as any, audit as any);
  return { db, audit, service };
}

describe('PersonMergeService', () => {
  it('rechaza un pedido inválido', async () => {
    const { service } = setup({});
    await expect(service.merge({ keepId: KEEP, mergeIds: [KEEP] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.preview({ keepId: 'x', mergeIds: [] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 si falta alguna persona y 409 si alguna está dada de baja', async () => {
    const missing = setup({ person: [person(KEEP)] });
    await expect(missing.service.merge({ keepId: KEEP, mergeIds: [A] })).rejects.toBeInstanceOf(NotFoundException);

    const inactive = setup({ person: [person(KEEP), person(A, { isActive: false })] });
    await expect(inactive.service.merge({ keepId: KEEP, mergeIds: [A] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('mueve lo que apunta a las unidas, descarta lo repetido y da de baja a las unidas', async () => {
    const { db, audit, service } = setup({
      person: [
        person(KEEP, { email: null }),
        person(A, { email: 'a@ejemplo.com', cuit: '20123456786', notes: 'nota previa' }),
        person(B),
      ],
      personRoleAssignment: [
        { id: 'r1', personId: KEEP, role: 'Propietario', guarantorForPersonId: null },
        { id: 'r2', personId: A, role: 'Propietario', guarantorForPersonId: null },
        { id: 'r3', personId: A, role: 'Inquilino', guarantorForPersonId: null },
        { id: 'r4', personId: B, role: 'Garante', guarantorForPersonId: A },
      ],
      contractPerson: [
        { id: 'cp1', personId: KEEP, contractId: 'c1', role: 'Inquilino' },
        { id: 'cp2', personId: A, contractId: 'c1', role: 'Inquilino' },
        { id: 'cp3', personId: A, contractId: 'c2', role: 'Inquilino' },
      ],
      propertyOwnership: [{ id: 'o1', personId: A }, { id: 'o2', personId: B }],
      contractLessor: [
        { id: 'l1', personId: A, payeePersonId: B, bankAccountId: 'acc-a' },
        { id: 'l2', personId: 'otro', payeePersonId: A, bankAccountId: null },
      ],
      personBankAccount: [
        { id: 'acc-k', personId: KEEP, currency: 'ARS', cbu: '0170000040000000123456', isDefault: true, createdAt: 1 },
        { id: 'acc-a', personId: A, currency: 'ARS', cbu: '0170 0000 4000 0000 1234 56', isDefault: true, createdAt: 2 },
        { id: 'acc-b', personId: B, currency: 'ARS', cbu: '0170000040000000999999', isDefault: true, createdAt: 3 },
      ],
    });

    const result = await service.merge({ keepId: KEEP, mergeIds: [A, B] });

    expect(result.merged).toBe(2);
    const t = db.tables;
    expect(t.personRoleAssignment.map((r: Row) => `${r.personId === KEEP ? 'K' : r.personId}:${r.role}`).sort()).toEqual([
      'K:Garante',
      'K:Inquilino',
      'K:Propietario',
    ]);
    expect(t.personRoleAssignment.find((r: Row) => r.id === 'r4')!.guarantorForPersonId).toBe(KEEP);
    expect(t.contractPerson.map((r: Row) => `${r.id}:${r.personId === KEEP ? 'K' : r.personId}`).sort()).toEqual(['cp1:K', 'cp3:K']);
    expect(t.propertyOwnership.every((r: Row) => r.personId === KEEP)).toBe(true);
    expect(t.contractLessor.find((r: Row) => r.id === 'l1')).toMatchObject({ personId: KEEP, payeePersonId: KEEP, bankAccountId: 'acc-k' });
    expect(t.contractLessor.find((r: Row) => r.id === 'l2')!.payeePersonId).toBe(KEEP);
    // La cuenta repetida se descarta; la otra pasa a la conservada sin volverse la predeterminada.
    expect(t.personBankAccount.map((r: Row) => r.id).sort()).toEqual(['acc-b', 'acc-k']);
    expect(t.personBankAccount.find((r: Row) => r.id === 'acc-b')).toMatchObject({ personId: KEEP, isDefault: false });

    const keep = t.person.find((r: Row) => r.id === KEEP);
    expect(keep).toMatchObject({ email: 'a@ejemplo.com', cuit: '20123456786', isActive: true });
    const merged = t.person.find((r: Row) => r.id === A);
    expect(merged.isActive).toBe(false);
    expect(merged.cuit).toBeNull();
    expect(merged.notes).toContain('nota previa');
    expect(merged.notes).toContain(`Unida con Sintética, Ana (${KEEP})`);

    expect(result.discarded).toEqual(
      expect.arrayContaining([
        { entity: 'personRoleAssignment', field: 'personId', count: 1 },
        { entity: 'contractPerson', field: 'personId', count: 1 },
        { entity: 'personBankAccount', field: 'cbu', count: 1 },
      ]),
    );
    expect(result.items).toEqual(expect.arrayContaining([{ entity: 'propertyOwnership', field: 'personId', count: 2 }]));

    // Auditoría: una fila para la conservada con antes y después, y una por cada unida.
    expect(audit.record).toHaveBeenCalledTimes(3);
    const first = audit.record.mock.calls[0];
    expect(first[0]).toBe(db);
    expect(first[1]).toMatchObject({
      action: 'UPDATE',
      entity: 'Person',
      entityId: KEEP,
      before: expect.objectContaining({ email: null }),
      after: expect.objectContaining({ email: 'a@ejemplo.com' }),
      metadata: expect.objectContaining({ operation: 'persons.merge', mergedIds: [A, B] }),
    });
    expect(audit.record.mock.calls[1][1]).toMatchObject({ entityId: A, after: { isActive: false, cuit: null, mergedInto: KEEP } });
  });

  it('la vista previa cuenta sin cambiar nada', async () => {
    const { db, service } = setup({ propertyOwnership: [{ id: 'o1', personId: A }] });
    const plan = await service.preview({ keepId: KEEP, mergeIds: [A] });
    expect(plan.items).toEqual([{ entity: 'propertyOwnership', field: 'personId', count: 1 }]);
    expect(db.tables.propertyOwnership[0].personId).toBe(A);
    expect(db.tables.person.every((p: Row) => p.isActive)).toBe(true);
  });

  it('409 y sin cambios si las dos personas tienen perfil de proveedor', async () => {
    const { db, audit, service } = setup({
      providerProfile: [{ id: 'pp1', personId: KEEP }, { id: 'pp2', personId: A }],
      propertyOwnership: [{ id: 'o1', personId: A }],
    });
    const err = await service.merge({ keepId: KEEP, mergeIds: [A] }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      error: 'MERGE_CONFLICT',
      conflicts: [{ entity: 'providerProfile', field: 'personId', count: 1 }],
    });
    expect(db.tables.propertyOwnership[0].personId).toBe(A);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('mueve el perfil de proveedor si sólo lo tiene la unida; dos unidas con perfil chocan entre sí', async () => {
    const one = setup({ providerProfile: [{ id: 'pp2', personId: A }] });
    await one.service.merge({ keepId: KEEP, mergeIds: [A] });
    expect(one.db.tables.providerProfile[0].personId).toBe(KEEP);

    const two = setup({ providerProfile: [{ id: 'pp1', personId: A }, { id: 'pp2', personId: B }] });
    await expect(two.service.merge({ keepId: KEEP, mergeIds: [A, B] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 si las dos tienen una rendición del mismo contrato y período', async () => {
    const { service } = setup({
      ownerRendicion: [
        { id: 'x1', ownerId: KEEP, contractId: 'c1', period: '2026-05' },
        { id: 'x2', ownerId: A, contractId: 'c1', period: '2026-05' },
        { id: 'x3', ownerId: A, contractId: 'c1', period: '2026-06' },
      ],
    });
    await expect(service.merge({ keepId: KEEP, mergeIds: [A] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('custodias: mueve la de otra moneda, choca si las dos tienen custodia en la misma; repunta libro y compensaciones', async () => {
    const custody = (id: string, ownerPersonId: string, currency: string) => ({ id, kind: 'Custodia', ownerPersonId, currency });
    const clash = setup({ financialAccount: [custody('f1', KEEP, 'USD'), custody('f2', A, 'USD')] });
    await expect(clash.service.merge({ keepId: KEEP, mergeIds: [A] })).rejects.toBeInstanceOf(ConflictException);

    const { db, service } = setup({
      financialAccount: [custody('f1', KEEP, 'USD'), custody('f2', A, 'EUR')],
      cashMovement: [{ id: 'm1', counterpartyId: A }],
      compensation: [{ id: 'c1', fromLessorId: A, toLessorId: B }],
    });
    await service.merge({ keepId: KEEP, mergeIds: [A] });
    expect(db.tables.financialAccount.find((r: Row) => r.id === 'f2').ownerPersonId).toBe(KEEP);
    expect(db.tables.cashMovement[0].counterpartyId).toBe(KEEP);
    expect(db.tables.compensation[0]).toMatchObject({ fromLessorId: KEEP, toLessorId: B });
  });

  it('409 si un poder queda de una persona hacia sí misma', async () => {
    const { service } = setup({ powerOfAttorney: [{ id: 'w1', principalId: A, agentId: KEEP }] });
    const err = await service.preview({ keepId: KEEP, mergeIds: [A] }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().conflicts).toEqual([{ entity: 'powerOfAttorney', field: 'principalId', count: 1 }]);
  });
});
