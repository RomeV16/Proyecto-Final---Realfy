import { PersonPowersService } from './person-powers.service';

const TENANT_ID = 'tenant-1';
const PRINCIPAL = 'a0000000-0000-4000-8000-000000000001';
const AGENT = 'a0000000-0000-4000-8000-000000000002';
const AGENT_2 = 'a0000000-0000-4000-8000-000000000003';
const CONTRACT = 'c0000000-0000-4000-8000-000000000001';
const START = new Date('2026-01-01T00:00:00.000Z');

function setup() {
  const client: any = {
    person: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: where.id, tenantId: TENANT_ID }),
      ),
    },
    contract: { findFirst: jest.fn().mockResolvedValue({ id: CONTRACT, startDate: START }) },
    property: { findFirst: jest.fn().mockResolvedValue({ id: 'prop-1' }) },
    powerOfAttorney: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w1', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w1', ...data })),
      delete: jest.fn().mockResolvedValue({}),
    },
    contractLessor: { count: jest.fn().mockResolvedValue(0) },
    personRoleAssignment: { upsert: jest.fn().mockResolvedValue({}) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const service = new PersonPowersService(
    { client } as any,
    { getTenantId: () => TENANT_ID } as any,
  );
  return { client, service };
}

async function errorBody(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err.getResponse();
  }
  throw new Error('se esperaba un rechazo');
}

describe('PersonPowersService', () => {
  describe('create', () => {
    it('crea un poder general y etiqueta al apoderado', async () => {
      const { client, service } = setup();

      const power = await service.create(PRINCIPAL, { agentId: AGENT, scopes: ['Cobrar', 'Cobrar', 'Firmar'] });

      expect(power).toMatchObject({
        principalId: PRINCIPAL,
        agentId: AGENT,
        scopes: ['Cobrar', 'Firmar'],
        signatureMode: 'Indistinta',
        groupKey: null,
        contractId: null,
        propertyId: null,
      });
      expect(client.personRoleAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ personId: AGENT, role: 'Apoderado' }),
        }),
      );
    });

    it('un poder de contrato vale desde el inicio del contrato', async () => {
      const { service } = setup();

      const power: any = await service.create(PRINCIPAL, {
        agentId: AGENT,
        scopes: ['Firmar'],
        contractId: CONTRACT,
      });

      expect(power.validFrom).toEqual(START);
    });

    it('la firma conjunta agrupa a los apoderados del mismo alcance con la misma clave', async () => {
      const { service } = setup();

      const a: any = await service.create(PRINCIPAL, {
        agentId: AGENT,
        scopes: ['Firmar'],
        signatureMode: 'Conjunta',
        contractId: CONTRACT,
      });
      const b: any = await service.create(PRINCIPAL, {
        agentId: AGENT_2,
        scopes: ['Firmar'],
        signatureMode: 'Conjunta',
        contractId: CONTRACT,
      });

      expect(a.groupKey).toBe(`${PRINCIPAL}:${CONTRACT}`);
      expect(b.groupKey).toBe(a.groupKey);
    });

    it('la clave de grupo solo tiene sentido con firma conjunta', async () => {
      const { service } = setup();

      const body = await errorBody(
        service.create(PRINCIPAL, { agentId: AGENT, scopes: ['Firmar'], groupKey: 'g1' }),
      );

      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('valida los alcances', async () => {
      const { service } = setup();

      for (const scopes of [[], ['Vender']]) {
        const body = await errorBody(service.create(PRINCIPAL, { agentId: AGENT, scopes }));
        expect(body.error).toBe('VALIDATION_ERROR');
      }
    });

    it('nadie se da poder a sí mismo', async () => {
      const { service } = setup();

      const body = await errorBody(service.create(PRINCIPAL, { agentId: PRINCIPAL, scopes: ['Cobrar'] }));

      expect(body.error).toBe('POWER_SELF');
    });

    it('un poder es de un contrato o de una propiedad, no de ambos', async () => {
      const { service } = setup();

      const body = await errorBody(
        service.create(PRINCIPAL, {
          agentId: AGENT,
          scopes: ['Cobrar'],
          contractId: CONTRACT,
          propertyId: 'a0000000-0000-4000-8000-0000000000aa',
        }),
      );

      expect(body.error).toBe('VALIDATION_ERROR');
    });

    it('el contrato tiene que existir', async () => {
      const { client, service } = setup();
      client.contract.findFirst.mockResolvedValue(null);

      const body = await errorBody(
        service.create(PRINCIPAL, { agentId: AGENT, scopes: ['Cobrar'], contractId: CONTRACT }),
      );

      expect(body.error).toBe('CONTRACT_NOT_FOUND');
    });
  });

  describe('list', () => {
    it('por defecto lista los poderes que otorgó la persona', async () => {
      const { client, service } = setup();

      await service.list(PRINCIPAL, {});

      expect(client.powerOfAttorney.findMany.mock.calls[0][0].where).toEqual({ principalId: PRINCIPAL });
    });

    it('con as=agent lista los que tiene como apoderada, vigentes en una fecha', async () => {
      const { client, service } = setup();

      await service.list(AGENT, { as: 'agent', activeOn: '2026-06-01T00:00:00.000Z' });

      const where = client.powerOfAttorney.findMany.mock.calls[0][0].where;
      expect(where.agentId).toBe(AGENT);
      expect(where.validFrom).toEqual({ lte: new Date('2026-06-01T00:00:00.000Z') });
      expect(where.OR).toEqual([{ validTo: null }, { validTo: { gt: new Date('2026-06-01T00:00:00.000Z') } }]);
    });
  });

  describe('revocar o recortar un poder en uso', () => {
    const power = { id: 'w1', principalId: PRINCIPAL, agentId: AGENT, scopes: ['Cobrar'], signatureMode: 'Indistinta', groupKey: null, validFrom: START, validTo: null };

    it('no se revoca si un locador lo usa para que cobre el apoderado', async () => {
      const { client, service } = setup();
      client.powerOfAttorney.findFirst.mockResolvedValue(power);
      client.contractLessor.count.mockResolvedValue(1);

      const body = await errorBody(service.remove(PRINCIPAL, 'w1'));

      expect(body.error).toBe('POWER_IN_USE');
      expect(client.powerOfAttorney.delete).not.toHaveBeenCalled();
    });

    it('no se le quita el alcance Cobrar ni se le pone fin si está en uso', async () => {
      const { client, service } = setup();
      client.powerOfAttorney.findFirst.mockResolvedValue(power);
      client.contractLessor.count.mockResolvedValue(1);

      expect((await errorBody(service.update(PRINCIPAL, 'w1', { scopes: ['Firmar'] }))).error).toBe('POWER_IN_USE');
      expect(
        (await errorBody(service.update(PRINCIPAL, 'w1', { validTo: '2027-01-01T00:00:00.000Z' }))).error,
      ).toBe('POWER_IN_USE');
    });

    it('sin uso se revoca', async () => {
      const { client, service } = setup();
      client.powerOfAttorney.findFirst.mockResolvedValue(power);

      await expect(service.remove(PRINCIPAL, 'w1')).resolves.toEqual({ deleted: true });
    });

    it('404 si el poder no es de esa persona', async () => {
      const { client, service } = setup();
      client.powerOfAttorney.findFirst.mockResolvedValue(null);

      expect((await errorBody(service.remove(PRINCIPAL, 'nope'))).error).toBe('POWER_NOT_FOUND');
    });
  });
});
