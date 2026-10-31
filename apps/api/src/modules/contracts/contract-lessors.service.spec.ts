import { ContractLessorsService } from './contract-lessors.service';

const TENANT_ID = 'tenant-1';
const CONTRACT_ID = 'c0000000-0000-4000-8000-000000000001';
const P1 = 'a0000000-0000-4000-8000-000000000001';
const P2 = 'a0000000-0000-4000-8000-000000000002';
const AGENT = 'a0000000-0000-4000-8000-000000000009';
const ACCOUNT = 'b0000000-0000-4000-8000-000000000001';

const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2028-01-01T00:00:00.000Z');

function contract(status: string) {
  return { id: CONTRACT_ID, propertyId: 'prop-1', status, startDate: START, endDate: END };
}

/**
 * Doble de la base. `stored` son los locadores que ve la validación de la suma
 * después de la mutación (en las pruebas se fijan a mano).
 */
function setup(status = 'Borrador') {
  const client: any = {
    contract: { findFirst: jest.fn().mockResolvedValue(contract(status)) },
    contractLessor: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    person: { findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, tenantId: TENANT_ID })) },
    personBankAccount: { findFirst: jest.fn().mockResolvedValue({ id: ACCOUNT }) },
    powerOfAttorney: { findFirst: jest.fn().mockResolvedValue({ id: 'w1' }) },
    personRoleAssignment: { upsert: jest.fn().mockResolvedValue({}) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const service = new ContractLessorsService(
    { client } as any,
    { getTenantId: () => TENANT_ID } as any,
  );
  return { client, service };
}

const row = (payoutPct: string, over: Record<string, unknown> = {}) => ({
  payoutPct,
  validFrom: START,
  validTo: null,
  ...over,
});

async function errorBody(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err: any) {
    return err.getResponse();
  }
  throw new Error('se esperaba un rechazo');
}

describe('ContractLessorsService', () => {
  describe('create', () => {
    it('en Borrador agrega de a uno sin exigir la suma, y etiqueta a la persona', async () => {
      const { client, service } = setup('Borrador');

      await service.create(CONTRACT_ID, { personId: P1, payoutPct: '50' });

      expect(client.contractLessor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          contractId: CONTRACT_ID,
          personId: P1,
          capacity: 'Propietario',
          payoutPct: '50',
          validFrom: START,
          validTo: null,
        }),
      });
      expect(client.personRoleAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ personId: P1, role: 'Propietario' }),
        }),
      );
      expect(client.contractLessor.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.anything() }),
      );
    });

    it('en un contrato activo rechaza si la suma no es 100', async () => {
      const { client, service } = setup('Activo');
      client.contractLessor.findMany.mockImplementation(({ select }: any) =>
        Promise.resolve(select ? [row('100'), row('50')] : []),
      );

      const body = await errorBody(service.create(CONTRACT_ID, { personId: P2, payoutPct: '50' }));

      expect(body.error).toBe('LESSOR_SHARES_INVALID');
      expect(body.details.invalidDates).toEqual([{ date: '2026-01-01', sum: '150.0000' }]);
    });

    it('en un contrato activo acepta una cesión que no se pisa', async () => {
      const { client, service } = setup('Activo');
      const cession = new Date('2026-07-01T00:00:00.000Z');
      client.contractLessor.findMany.mockImplementation(({ select }: any) =>
        Promise.resolve(
          select ? [row('100', { validTo: cession }), row('100', { validFrom: cession })] : [],
        ),
      );

      await expect(
        service.create(CONTRACT_ID, { personId: P2, payoutPct: '100', validFrom: cession.toISOString() }),
      ).resolves.toBeDefined();
    });

    it('la cuenta tiene que ser del locador', async () => {
      const { client, service } = setup();
      client.personBankAccount.findFirst.mockResolvedValue(null);

      const body = await errorBody(
        service.create(CONTRACT_ID, { personId: P1, payoutPct: '100', bankAccountId: ACCOUNT }),
      );

      expect(body.error).toBe('BANK_ACCOUNT_NOT_OF_LESSOR');
      expect(client.personBankAccount.findFirst).toHaveBeenCalledWith({
        where: { id: ACCOUNT, personId: P1 },
      });
      expect(client.contractLessor.create).not.toHaveBeenCalled();
    });

    it('el cobrador necesita un poder vigente con alcance Cobrar del locador', async () => {
      const { client, service } = setup();
      client.powerOfAttorney.findFirst.mockResolvedValue(null);

      const body = await errorBody(
        service.create(CONTRACT_ID, { personId: P1, payoutPct: '100', payeePersonId: AGENT }),
      );

      expect(body.error).toBe('PAYEE_WITHOUT_POWER');
      const where = client.powerOfAttorney.findFirst.mock.calls[0][0].where;
      expect(where.principalId).toBe(P1);
      expect(where.agentId).toBe(AGENT);
      expect(where.scopes).toEqual({ has: 'Cobrar' });
      expect(client.contractLessor.create).not.toHaveBeenCalled();
    });

    it('con poder, el cobrador queda guardado', async () => {
      const { client, service } = setup();

      await service.create(CONTRACT_ID, { personId: P1, payoutPct: '100', payeePersonId: AGENT });

      expect(client.contractLessor.create.mock.calls[0][0].data.payeePersonId).toBe(AGENT);
    });

    it('rechaza porcentajes fuera de rango', async () => {
      const { service } = setup();

      for (const payoutPct of ['0', '100.0001', '-5', 'abc']) {
        const body = await errorBody(service.create(CONTRACT_ID, { personId: P1, payoutPct }));
        expect(body.error).toBe('VALIDATION_ERROR');
      }
    });

    it('404 si el contrato no existe', async () => {
      const { client, service } = setup();
      client.contract.findFirst.mockResolvedValue(null);

      const body = await errorBody(service.create(CONTRACT_ID, { personId: P1, payoutPct: '100' }));

      expect(body.error).toBe('CONTRACT_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('cambiar el porcentaje baja la marca de revisión', async () => {
      const { client, service } = setup('Borrador');
      client.contractLessor.findFirst.mockResolvedValue({
        id: 'l1',
        personId: P1,
        validFrom: START,
        validTo: null,
        needsReview: true,
        bankAccountId: null,
        payeePersonId: null,
      });

      await service.update(CONTRACT_ID, 'l1', { payoutPct: '50' });

      expect(client.contractLessor.update.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ payoutPct: '50', needsReview: false }),
      );
    });

    it('404 si el locador no es de ese contrato', async () => {
      const { client, service } = setup();
      client.contractLessor.findFirst.mockResolvedValue(null);

      const body = await errorBody(service.update(CONTRACT_ID, 'nope', { payoutPct: '50' }));

      expect(body.error).toBe('LESSOR_NOT_FOUND');
    });

    it('no deja una vigencia que termina antes de empezar', async () => {
      const { client, service } = setup();
      client.contractLessor.findFirst.mockResolvedValue({
        id: 'l1',
        personId: P1,
        validFrom: START,
        validTo: null,
        needsReview: false,
        bankAccountId: null,
        payeePersonId: null,
      });

      const body = await errorBody(
        service.update(CONTRACT_ID, 'l1', { validTo: '2025-01-01T00:00:00.000Z' }),
      );

      expect(body.error).toBe('VALIDATION_ERROR');
    });
  });

  describe('remove', () => {
    it('en un contrato activo no se puede quitar al único locador', async () => {
      const { client, service } = setup('Activo');
      client.contractLessor.findFirst.mockResolvedValue({ id: 'l1' });
      client.contractLessor.findMany.mockResolvedValue([]);

      const body = await errorBody(service.remove(CONTRACT_ID, 'l1'));

      expect(body.error).toBe('LESSOR_SHARES_INVALID');
    });

    it('en Borrador se quita sin más', async () => {
      const { client, service } = setup('Borrador');
      client.contractLessor.findFirst.mockResolvedValue({ id: 'l1' });

      await expect(service.remove(CONTRACT_ID, 'l1')).resolves.toEqual({ deleted: true });
    });
  });

  describe('replace', () => {
    it('reemplaza el conjunto y siempre exige que sume 100, también en Borrador', async () => {
      const { client, service } = setup('Borrador');
      client.contractLessor.findMany.mockImplementation(({ select }: any) =>
        Promise.resolve(select ? [row('70'), row('20')] : []),
      );

      const body = await errorBody(
        service.replace(CONTRACT_ID, {
          lessors: [
            { personId: P1, payoutPct: '70' },
            { personId: P2, payoutPct: '20' },
          ],
        }),
      );

      expect(body.error).toBe('LESSOR_SHARES_INVALID');
    });

    it('actualiza las filas con id, crea las nuevas y borra las que no vienen', async () => {
      const { client, service } = setup('Activo');
      const existingId = 'd0000000-0000-4000-8000-000000000001';
      client.contractLessor.findFirst.mockResolvedValue({ id: existingId });
      client.contractLessor.findMany.mockImplementation(({ select }: any) =>
        Promise.resolve(select ? [row('60'), row('40')] : []),
      );

      await service.replace(CONTRACT_ID, {
        lessors: [
          { id: existingId, personId: P1, payoutPct: '60' },
          { personId: P2, payoutPct: '40' },
        ],
      });

      expect(client.contractLessor.deleteMany).toHaveBeenCalledWith({
        where: { contractId: CONTRACT_ID, id: { notIn: [existingId] } },
      });
      expect(client.contractLessor.update).toHaveBeenCalledTimes(1);
      expect(client.contractLessor.create).toHaveBeenCalledTimes(1);
    });
  });
});
