import { getApoderadosAt, getLessorsAt, getParties, getParty } from './contract-parties';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('getParty / getParties', () => {
  const contract = {
    persons: [
      { role: 'Inquilino', personId: 'a' },
      { role: 'Garante', personId: 'b' },
      { role: 'Garante', personId: 'c' },
    ],
  };

  it('devuelve la primera parte con el rol', () => {
    expect(getParty(contract, 'Garante')?.personId).toBe('b');
    expect(getParty(contract, 'Inquilino')?.personId).toBe('a');
  });

  it('devuelve undefined si no hay nadie con el rol o no se cargaron las partes', () => {
    expect(getParty(contract, 'Comprador')).toBeUndefined();
    expect(getParty({}, 'Inquilino')).toBeUndefined();
    expect(getParty({ persons: null }, 'Inquilino')).toBeUndefined();
  });

  it('getParties devuelve todas', () => {
    expect(getParties(contract, 'Garante').map((p) => p.personId)).toEqual(['b', 'c']);
    expect(getParties({}, 'Garante')).toEqual([]);
  });
});

describe('getLessorsAt', () => {
  const lessors = [
    { id: 'l1', payoutPct: '40', validFrom: d('2026-01-01'), validTo: d('2026-07-01') },
    { id: 'l2', payoutPct: '60', validFrom: d('2026-01-01'), validTo: null },
    { id: 'l3', payoutPct: '40', validFrom: d('2026-07-01'), validTo: null },
  ];

  it('filtra por vigencia y ordena de mayor a menor porcentaje, sin consultar la base', async () => {
    const db = { contractLessor: { findMany: jest.fn() } };

    const before = await getLessorsAt(db, { id: 'c', lessors }, d('2026-03-01'));
    const after = await getLessorsAt(db, { id: 'c', lessors }, d('2026-07-01'));

    expect(before.map((l) => l.id)).toEqual(['l2', 'l1']);
    expect(after.map((l) => l.id)).toEqual(['l2', 'l3']);
    expect(db.contractLessor.findMany).not.toHaveBeenCalled();
  });

  it('con el id del contrato consulta la base por vigencia', async () => {
    const rows = [{ id: 'l2' }];
    const db = { contractLessor: { findMany: jest.fn().mockResolvedValue(rows) } };

    const result = await getLessorsAt(db, 'c1', d('2026-03-01'));

    expect(result).toBe(rows);
    expect(db.contractLessor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contractId: 'c1',
          validFrom: { lte: d('2026-03-01') },
          OR: [{ validTo: null }, { validTo: { gt: d('2026-03-01') } }],
        },
      }),
    );
  });
});

describe('getApoderadosAt', () => {
  it('sin locadores no consulta', async () => {
    const db = { powerOfAttorney: { findMany: jest.fn() } };

    expect(await getApoderadosAt(db, { id: 'c', propertyId: 'p', lessors: [] }, new Date())).toEqual([]);
    expect(db.powerOfAttorney.findMany).not.toHaveBeenCalled();
  });

  it('busca los poderes de los locadores del contrato, de su propiedad y los generales', async () => {
    const db = { powerOfAttorney: { findMany: jest.fn().mockResolvedValue([{ id: 'w1' }]) } };
    const on = d('2026-03-01');

    const result = await getApoderadosAt(
      db,
      { id: 'c', propertyId: 'p', lessors: [{ personId: 'x' }, { personId: 'x' }, { personId: 'y' }] },
      on,
    );

    expect(result).toEqual([{ id: 'w1' }]);
    const where = db.powerOfAttorney.findMany.mock.calls[0][0].where;
    expect(where.principalId).toEqual({ in: ['x', 'y'] });
    expect(where.AND).toEqual([
      { OR: [{ validTo: null }, { validTo: { gt: on } }] },
      { OR: [{ contractId: null }, { contractId: 'c' }] },
      { OR: [{ propertyId: null }, { propertyId: 'p' }] },
    ]);
  });
});
