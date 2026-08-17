import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ContractClosureService } from '../ai/contract-closure.service';
import { ContractsService } from './contracts.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';
const CONTRACT_ID = 'con-1';

const ACTIVE_CONTRACT = {
  id: CONTRACT_ID,
  status: 'Activo',
  startDate: new Date('2024-03-01T12:00:00.000Z'),
  endDate: new Date('2026-03-01T12:00:00.000Z'),
  adjustmentPeriod: 'Trimestral',
};

function buildMocks() {
  const prisma = {
    client: {
      contract: {
        findFirst: jest.fn().mockResolvedValue(ACTIVE_CONTRACT),
        update: jest.fn().mockResolvedValue(ACTIVE_CONTRACT),
      },
      adjustmentSchedule: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    },
  };
  const closureSummaries = { generateOnClosure: jest.fn().mockResolvedValue(undefined) };
  return { prisma, closureSummaries };
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
    ],
  }).compile();

  return { module, service: module.get(ContractsService) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractsService — disparo del resumen de cierre', () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    await module?.close();
    module = undefined;
  });

  describe('terminate', () => {
    it('resume la gestion cuando el contrato se rescinde', async () => {
      const mocks = buildMocks();
      const built = await buildService(mocks);
      module = built.module;

      await built.service.terminate(CONTRACT_ID);

      expect(mocks.closureSummaries.generateOnClosure).toHaveBeenCalledWith(
        TENANT_ID,
        CONTRACT_ID,
      );
    });

    it('rescinde el contrato aunque el resumen no se pueda generar', async () => {
      const mocks = buildMocks();
      // `generateOnClosure` no lanza por contrato, pero si algún día lo hiciera,
      // la rescisión ya está aplicada antes de pedirlo.
      const built = await buildService(mocks);
      module = built.module;

      await built.service.terminate(CONTRACT_ID);

      expect(mocks.prisma.client.contract.update).toHaveBeenCalledWith({
        where: { id: CONTRACT_ID },
        data: { status: 'Rescindido', isActive: false },
      });
    });
  });

  describe('update', () => {
    it('resume la gestion cuando el contrato pasa a Vencido', async () => {
      const mocks = buildMocks();
      const built = await buildService(mocks);
      module = built.module;

      await built.service.update(CONTRACT_ID, { status: 'Vencido' });

      expect(mocks.closureSummaries.generateOnClosure).toHaveBeenCalledWith(
        TENANT_ID,
        CONTRACT_ID,
      );
    });

    it('resume la gestion cuando el contrato se renueva', async () => {
      const mocks = buildMocks();
      const built = await buildService(mocks);
      module = built.module;

      await built.service.update(CONTRACT_ID, { status: 'Renovado' });

      expect(mocks.closureSummaries.generateOnClosure).toHaveBeenCalled();
    });

    it('no resume nada si el contrato sigue vigente', async () => {
      const mocks = buildMocks();
      const built = await buildService(mocks);
      module = built.module;

      await built.service.update(CONTRACT_ID, { notes: 'Se acordó una prórroga verbal' });

      expect(mocks.closureSummaries.generateOnClosure).not.toHaveBeenCalled();
    });

    it('no vuelve a resumir un contrato que ya estaba cerrado', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.contract.findFirst.mockResolvedValue({
        ...ACTIVE_CONTRACT,
        status: 'Vencido',
      });
      const built = await buildService(mocks);
      module = built.module;

      await built.service.update(CONTRACT_ID, { status: 'Archivado' });

      expect(mocks.closureSummaries.generateOnClosure).not.toHaveBeenCalled();
    });
  });
});
