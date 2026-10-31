import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ContractClosureService } from '../ai/contract-closure.service';
import { IndexDataService } from '../index-data/index-data.service';
import { ContractsService } from './contracts.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';
const CONTRACT_ID = 'con-borrador';
const PROPERTY_ID = 'prop-1';
const OPERATION_ID = 'op-alquiler';

const DRAFT = {
  id: CONTRACT_ID,
  tenantId: TENANT_ID,
  propertyId: PROPERTY_ID,
  contractType: 'Alquiler',
  status: 'Borrador',
  startDate: new Date('2026-11-01T12:00:00.000Z'),
  endDate: new Date('2028-11-01T12:00:00.000Z'),
  adjustmentPeriod: 'Trimestral',
  persons: [
    { personId: 'p-prop', role: 'Propietario' },
    { personId: 'p-inq', role: 'Inquilino' },
  ],
};

const PROPERTY = { id: PROPERTY_ID, isActive: true };

// Un locador que cobra el 100 % desde el inicio del contrato.
const FULL_LESSOR = {
  payoutPct: '100.0000',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validTo: null,
};

function buildMocks() {
  const client: any = {
    contract: {
      findFirst: jest.fn().mockResolvedValue(DRAFT),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(DRAFT),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: CONTRACT_ID }),
    },
    property: { findFirst: jest.fn().mockResolvedValue(PROPERTY) },
    propertyOperation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    person: {
      findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          tenantId: TENANT_ID,
          roles: [{ role: where.id === 'p-prop' ? 'Propietario' : 'Inquilino' }],
        }),
      ),
    },
    contractPerson: { create: jest.fn().mockResolvedValue({}) },
    contractLessor: {
      findMany: jest.fn().mockResolvedValue([FULL_LESSOR]),
      create: jest.fn().mockResolvedValue({}),
    },
    personRoleAssignment: { upsert: jest.fn().mockResolvedValue({}) },
    contractGuarantee: { create: jest.fn().mockResolvedValue({}) },
    adjustmentSchedule: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  // La transacción corre sobre el mismo doble: lo que importa es qué escribe.
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));

  const prisma = { client };
  const closureSummaries = { generateOnClosure: jest.fn().mockResolvedValue(undefined) };
  return { prisma, client, closureSummaries };
}

async function buildService(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ContractsService,
      { provide: PrismaService, useValue: mocks.prisma },
      {
        provide: TenantContextService,
        useValue: { getTenantId: jest.fn().mockReturnValue(TENANT_ID) },
      },
      { provide: ContractClosureService, useValue: mocks.closureSummaries },
      { provide: IndexDataService, useValue: { getForPeriod: jest.fn().mockResolvedValue([]) } },
    ],
  }).compile();

  return { module, service: module.get(ContractsService) };
}

/** Ejecuta y devuelve el cuerpo de la excepción, para mirar los motivos. */
async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse();
  }
  throw new Error('se esperaba un rechazo');
}

function codes(body: any): string[] {
  return (body.problems ?? []).map((p: { code: string }) => p.code);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractsService — activación del contrato', () => {
  let module: TestingModule | undefined;
  let mocks: ReturnType<typeof buildMocks>;
  let service: ContractsService;

  beforeEach(async () => {
    mocks = buildMocks();
    const built = await buildService(mocks);
    module = built.module;
    service = built.service;
  });

  afterEach(async () => {
    await module?.close();
    module = undefined;
  });

  describe('transición', () => {
    it('activa un borrador completo', async () => {
      await service.activate(CONTRACT_ID);

      expect(mocks.client.contract.update).toHaveBeenCalledWith({
        where: { id: CONTRACT_ID },
        data: { status: 'Activo', isActive: true },
      });
    });

    it('no activa un contrato que ya está activo', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({ ...DRAFT, status: 'Activo' });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(body.error).toBe('INVALID_TRANSITION');
      expect(mocks.client.contract.update).not.toHaveBeenCalled();
    });

    it('no reactiva un contrato rescindido', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({ ...DRAFT, status: 'Rescindido' });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(body.error).toBe('INVALID_TRANSITION');
    });

    it('responde 404 si el contrato no existe', async () => {
      mocks.client.contract.findFirst.mockResolvedValue(null);

      await expect(service.activate('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reglas', () => {
    it('exige un inquilino', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({
        ...DRAFT,
        persons: [{ personId: 'p-prop', role: 'Propietario' }],
      });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(body.error).toBe('CONTRACT_NOT_ACTIVATABLE');
      expect(codes(body)).toEqual(['MISSING_INQUILINO']);
      expect(mocks.client.contract.update).not.toHaveBeenCalled();
    });

    it('exige locadores', async () => {
      mocks.client.contractLessor.findMany.mockResolvedValue([]);

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual(['LESSOR_SHARES_INVALID']);
      expect(body.problems[0].invalidDates).toEqual([
        { date: DRAFT.startDate, sum: '0.0000' },
      ]);
    });

    it('un propietario cargado solo como parte del contrato no es locador', async () => {
      mocks.client.contractLessor.findMany.mockResolvedValue([]);

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toContain('LESSOR_SHARES_INVALID');
    });

    it('rechaza locadores que no suman 100 al inicio', async () => {
      mocks.client.contractLessor.findMany.mockResolvedValue([
        { ...FULL_LESSOR, payoutPct: '60.0000' },
        { ...FULL_LESSOR, payoutPct: '30.0000' },
      ]);

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual(['LESSOR_SHARES_INVALID']);
      expect(body.problems[0].invalidDates[0].sum).toBe('90.0000');
    });

    it('acepta varios locadores que suman exactamente 100', async () => {
      mocks.client.contractLessor.findMany.mockResolvedValue([
        { ...FULL_LESSOR, payoutPct: '33.3334' },
        { ...FULL_LESSOR, payoutPct: '33.3333' },
        { ...FULL_LESSOR, payoutPct: '33.3333' },
      ]);

      await expect(service.activate(CONTRACT_ID)).resolves.toBeDefined();
    });

    it('rechaza una cesión que deja un hueco en la mitad del contrato', async () => {
      const cession = new Date('2027-06-01T12:00:00.000Z');
      mocks.client.contractLessor.findMany.mockResolvedValue([
        { ...FULL_LESSOR, validTo: cession },
      ]);

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(body.problems[0].invalidDates).toEqual([{ date: cession, sum: '0.0000' }]);
    });

    it('un garante no cuenta como inquilino', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({
        ...DRAFT,
        persons: [{ personId: 'p-gar', role: 'Garante' }],
      });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual(['MISSING_INQUILINO']);
    });

    it('una venta no necesita inquilino', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({
        ...DRAFT,
        contractType: 'Venta',
        persons: [{ personId: 'p-prop', role: 'Propietario' }],
      });

      await expect(service.activate(CONTRACT_ID)).resolves.toBeDefined();
    });

    it('exige que la propiedad exista', async () => {
      mocks.client.property.findFirst.mockResolvedValue(null);

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual(['PROPERTY_NOT_FOUND']);
    });

    it('no activa sobre una propiedad dada de baja', async () => {
      mocks.client.property.findFirst.mockResolvedValue({ ...PROPERTY, isActive: false });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toContain('PROPERTY_INACTIVE');
    });

    it('exige que el fin sea posterior al inicio', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({
        ...DRAFT,
        endDate: DRAFT.startDate,
      });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual(['INVALID_DATES']);
    });

    it('junta todos los motivos en una sola respuesta', async () => {
      mocks.client.property.findFirst.mockResolvedValue(null);
      mocks.client.contractLessor.findMany.mockResolvedValue([]);
      mocks.client.contract.findFirst.mockResolvedValue({
        ...DRAFT,
        endDate: DRAFT.startDate,
        persons: [],
      });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual([
        'PROPERTY_NOT_FOUND',
        'LESSOR_SHARES_INVALID',
        'MISSING_INQUILINO',
        'INVALID_DATES',
      ]);
    });
  });

  describe('superposición con otro alquiler activo', () => {
    const OTHER = {
      id: 'con-vigente',
      startDate: new Date('2025-06-01T12:00:00.000Z'),
      endDate: new Date('2027-06-01T12:00:00.000Z'),
    };

    it('rechaza si otro alquiler activo de la propiedad se pisa con las fechas', async () => {
      mocks.client.contract.findMany.mockResolvedValue([OTHER]);

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(body.problems).toEqual([
        {
          code: 'OVERLAPPING_CONTRACT',
          contractId: OTHER.id,
          startDate: OTHER.startDate,
          endDate: OTHER.endDate,
        },
      ]);
      expect(mocks.client.propertyOperation.update).not.toHaveBeenCalled();
    });

    it('busca sólo alquileres activos de la misma propiedad, sin contarse a sí mismo', async () => {
      await service.activate(CONTRACT_ID);

      expect(mocks.client.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            propertyId: PROPERTY_ID,
            contractType: 'Alquiler',
            status: 'Activo',
            id: { not: CONTRACT_ID },
            startDate: { lt: DRAFT.endDate },
            endDate: { gt: DRAFT.startDate },
          },
        }),
      );
    });

    it('un contrato temporario no ocupa la propiedad ni busca superposición', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({
        ...DRAFT,
        contractType: 'AlquilerTemporario',
      });

      await service.activate(CONTRACT_ID);

      expect(mocks.client.contract.findMany).not.toHaveBeenCalled();
      expect(mocks.client.propertyOperation.create).not.toHaveBeenCalled();
      expect(mocks.client.propertyOperation.update).not.toHaveBeenCalled();
    });
  });

  describe('estado de la propiedad al activar', () => {
    it('crea la operación de alquiler ya alquilada si la propiedad no la tenía', async () => {
      await service.activate(CONTRACT_ID);

      expect(mocks.client.propertyOperation.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          propertyId: PROPERTY_ID,
          operationType: 'Alquiler',
          state: 'Alquilado',
        },
      });
    });

    it('pasa una operación disponible a alquilada', async () => {
      mocks.client.propertyOperation.findFirst.mockResolvedValue({
        id: OPERATION_ID,
        operationType: 'Alquiler',
        state: 'Disponible',
      });

      await service.activate(CONTRACT_ID);

      expect(mocks.client.propertyOperation.update).toHaveBeenCalledWith({
        where: { id: OPERATION_ID },
        data: { state: 'Alquilado' },
      });
    });

    it('recorre cada paso por la máquina de estados de la propiedad', async () => {
      mocks.client.propertyOperation.findFirst.mockResolvedValue({
        id: OPERATION_ID,
        operationType: 'Alquiler',
        state: 'Borrador',
      });

      await service.activate(CONTRACT_ID);

      const states = mocks.client.propertyOperation.update.mock.calls.map(
        ([arg]: any[]) => arg.data.state,
      );
      expect(states).toEqual(['Disponible', 'Reservado', 'Alquilado']);
    });

    it('no toca una operación que ya estaba alquilada', async () => {
      mocks.client.propertyOperation.findFirst.mockResolvedValue({
        id: OPERATION_ID,
        operationType: 'Alquiler',
        state: 'Alquilado',
      });

      await service.activate(CONTRACT_ID);

      expect(mocks.client.propertyOperation.update).not.toHaveBeenCalled();
      expect(mocks.client.propertyOperation.create).not.toHaveBeenCalled();
    });

    it('no activa si la operación de alquiler está archivada', async () => {
      mocks.client.propertyOperation.findFirst.mockResolvedValue({
        id: OPERATION_ID,
        operationType: 'Alquiler',
        state: 'Archivado',
      });

      const body = await rejection(service.activate(CONTRACT_ID));

      expect(codes(body)).toEqual(['RENTAL_OPERATION_ARCHIVED']);
      expect(mocks.client.contract.update).not.toHaveBeenCalled();
    });

    it('cambia el contrato y la propiedad en la misma transacción', async () => {
      const order: string[] = [];
      mocks.client.$transaction.mockImplementation(async (fn: (tx: any) => unknown) => {
        order.push('begin');
        const result = await fn(mocks.client);
        order.push('commit');
        return result;
      });
      mocks.client.contract.update.mockImplementation(async () => {
        order.push('contract');
        return DRAFT;
      });
      mocks.client.propertyOperation.create.mockImplementation(async () => {
        order.push('operation');
        return {};
      });

      await service.activate(CONTRACT_ID);

      expect(order).toEqual(['begin', 'contract', 'operation', 'commit']);
    });
  });

  describe('crear un contrato ya activo', () => {
    const BODY = {
      propertyId: '11111111-1111-4111-8111-111111111111',
      contractType: 'Alquiler',
      status: 'Activo',
      startDate: '2026-11-01T00:00:00.000Z',
      endDate: '2028-11-01T00:00:00.000Z',
      rentAmount: '500000',
      adjustmentType: 'ICL',
      adjustmentPeriod: 'Anual',
      persons: [
        { personId: '22222222-2222-4222-8222-222222222222', role: 'Propietario' },
        { personId: '33333333-3333-4333-8333-333333333333', role: 'Inquilino' },
      ],
    };

    beforeEach(() => {
      mocks.client.person.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve({
          id: where.id,
          tenantId: TENANT_ID,
          roles: [
            {
              role: where.id.startsWith('2222') ? 'Propietario' : 'Inquilino',
            },
          ],
        }),
      );
    });

    it('pasa por las mismas reglas: no se crea si se pisa con otro alquiler activo', async () => {
      mocks.client.contract.findMany.mockResolvedValue([
        { id: 'con-vigente', startDate: new Date(), endDate: new Date() },
      ]);

      const body = await rejection(service.create(BODY));

      expect(codes(body)).toEqual(['OVERLAPPING_CONTRACT']);
    });

    it('ocupa la propiedad al crearse', async () => {
      await service.create(BODY);

      expect(mocks.client.propertyOperation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ state: 'Alquilado' }),
        }),
      );
    });

    it('los propietarios de persons se guardan como locadores, no como partes', async () => {
      await service.create(BODY);

      expect(mocks.client.contractLessor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          personId: '22222222-2222-4222-8222-222222222222',
          capacity: 'Propietario',
          payoutPct: '100.0000',
          needsReview: false,
        }),
      });
      expect(mocks.client.contractPerson.create).toHaveBeenCalledTimes(1);
      expect(mocks.client.contractPerson.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ role: 'Inquilino' }),
      });
    });

    it('un locador sin el rol de propietario puede firmar: se le pone el rol', async () => {
      mocks.client.person.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve({ id: where.id, tenantId: TENANT_ID, roles: [{ role: 'Inquilino' }] }),
      );

      await service.create({
        ...BODY,
        persons: [{ personId: '33333333-3333-4333-8333-333333333333', role: 'Inquilino' }],
        lessors: [{ personId: '22222222-2222-4222-8222-222222222222', payoutPct: '100' }],
      });

      expect(mocks.client.personRoleAssignment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            personId: '22222222-2222-4222-8222-222222222222',
            role: 'Propietario',
          }),
        }),
      );
    });

    it('varios propietarios se reparten el 100 % y quedan marcados para revisar', async () => {
      await service.create({
        ...BODY,
        status: undefined,
        persons: [
          { personId: '22222222-2222-4222-8222-222222222222', role: 'Propietario' },
          { personId: '44444444-4444-4444-8444-444444444444', role: 'Propietario' },
          { personId: '55555555-5555-4555-8555-555555555555', role: 'Propietario' },
        ],
      });

      const created = mocks.client.contractLessor.create.mock.calls.map((c: any) => c[0].data);
      expect(created.map((d: any) => d.payoutPct)).toEqual(['33.3333', '33.3333', '33.3334']);
      expect(created.every((d: any) => d.needsReview === true)).toBe(true);
    });

    it('un borrador no ocupa la propiedad', async () => {
      await service.create({ ...BODY, status: undefined });

      expect(mocks.client.propertyOperation.create).not.toHaveBeenCalled();
      expect(mocks.client.contract.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'Borrador' }),
        }),
      );
    });
  });

  describe('liberar la propiedad al rescindir', () => {
    const ACTIVE = { ...DRAFT, status: 'Activo' };

    beforeEach(() => {
      mocks.client.contract.findFirst.mockResolvedValue(ACTIVE);
      mocks.client.propertyOperation.findFirst.mockResolvedValue({
        id: OPERATION_ID,
        operationType: 'Alquiler',
        state: 'Alquilado',
      });
    });

    it('vuelve la operación a disponible si no queda otro alquiler activo', async () => {
      await service.terminate(CONTRACT_ID);

      expect(mocks.client.contract.count).toHaveBeenCalledWith({
        where: {
          propertyId: PROPERTY_ID,
          contractType: 'Alquiler',
          status: 'Activo',
          id: { not: CONTRACT_ID },
        },
      });
      expect(mocks.client.propertyOperation.update).toHaveBeenCalledWith({
        where: { id: OPERATION_ID },
        data: { state: 'Disponible' },
      });
    });

    it('la deja alquilada si otro contrato activo sigue ocupándola', async () => {
      mocks.client.contract.count.mockResolvedValue(1);

      await service.terminate(CONTRACT_ID);

      expect(mocks.client.propertyOperation.update).not.toHaveBeenCalled();
    });

    it('respeta una operación que alguien ya movió de estado', async () => {
      mocks.client.propertyOperation.findFirst.mockResolvedValue({
        id: OPERATION_ID,
        operationType: 'Alquiler',
        state: 'Suspendido',
      });

      await service.terminate(CONTRACT_ID);

      expect(mocks.client.propertyOperation.update).not.toHaveBeenCalled();
    });

    it('rescindir un borrador no toca la propiedad', async () => {
      mocks.client.contract.findFirst.mockResolvedValue(DRAFT);

      await service.terminate(CONTRACT_ID);

      expect(mocks.client.propertyOperation.findFirst).not.toHaveBeenCalled();
    });

    it('no rescinde dos veces', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({ ...ACTIVE, status: 'Rescindido' });

      const body = await rejection(service.terminate(CONTRACT_ID));

      expect(body.error).toBe('INVALID_TRANSITION');
    });

    it('un vencimiento cargado a mano también libera la propiedad', async () => {
      await service.update(CONTRACT_ID, { status: 'Vencido' });

      expect(mocks.client.propertyOperation.update).toHaveBeenCalledWith({
        where: { id: OPERATION_ID },
        data: { state: 'Disponible' },
      });
    });
  });

  describe('PATCH no activa', () => {
    it('rechaza pasar a Activo por edición', async () => {
      const body = await rejection(service.update(CONTRACT_ID, { status: 'Activo' }));

      expect(body.error).toBe('ACTIVATION_REQUIRED');
      expect(mocks.client.contract.update).not.toHaveBeenCalled();
    });

    it('rechaza transiciones inválidas por edición', async () => {
      const body = await rejection(service.update(CONTRACT_ID, { status: 'Vencido' }));

      expect(body.error).toBe('INVALID_TRANSITION');
      expect(body.validTransitions).toEqual(['Activo', 'Rescindido', 'Archivado']);
    });

    it('extender un contrato activo no puede pisar a otro alquiler activo', async () => {
      mocks.client.contract.findFirst.mockResolvedValue({ ...DRAFT, status: 'Activo' });
      mocks.client.contract.findMany.mockResolvedValue([
        { id: 'con-siguiente', startDate: new Date(), endDate: new Date() },
      ]);

      const body = await rejection(
        service.update(CONTRACT_ID, { endDate: '2029-11-01T00:00:00.000Z' }),
      );

      expect(codes(body)).toEqual(['OVERLAPPING_CONTRACT']);
      expect(mocks.client.contract.update).not.toHaveBeenCalled();
    });
  });
});
