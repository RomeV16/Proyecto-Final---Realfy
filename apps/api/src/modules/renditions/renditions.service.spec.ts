import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RendicionStatus, RendicionLineItemType, CommissionType } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

// The PDF service does `require('pdfmake/src/printer')` at module load time,
// and the jest mock for that native module isn't wired up in this repo yet
// (tracked separately). A factory mock here keeps the real file — and its
// pdfmake import — from ever being evaluated, so this suite stays green
// regardless of that pending fix.
jest.mock('./rendition-pdf.service', () => ({
  RenditionPdfService: jest.fn(),
}));

import { RenditionsService } from './renditions.service';

// ─── Mocks ──────────────────────────────────────────────────────────────────

function createMockPrismaService() {
  return {
    client: {
      contract: { findFirst: jest.fn() },
      contractPerson: { findFirst: jest.fn() },
      contractCommission: { findFirst: jest.fn() },
      payment: { findMany: jest.fn() },
      ownerRendicion: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      rendicionLineItem: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
    getUserId: jest.fn().mockReturnValue('user-1'),
  } as unknown as TenantContextService;
}

const CONTRACT_ID = 'c0000000-0000-0000-0000-000000000001';
const OWNER_ID = 'p0000000-0000-0000-0000-000000000001';
const RENDICION_ID = 'r0000000-0000-0000-0000-000000000001';

describe('RenditionsService', () => {
  let service: RenditionsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new RenditionsService(
      prisma as any,
      tenantContext as any,
      {} as any, // RenditionPdfService — not exercised by these specs
      {} as any, // RenditionEmailService — not exercised by these specs
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── generate() — armado de la rendicion y sus totales ─────────────────────

  describe('generate', () => {
    function stubHappyPath(overrides: {
      commission?: Partial<Record<string, any>>;
      payments?: Array<{ amount: string }>;
    } = {}) {
      (prisma.client.contract.findFirst as jest.Mock).mockResolvedValue({
        id: CONTRACT_ID,
        tenantId: 'tenant-1',
        property: { id: 'prop-1' },
      });
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.client.contractCommission.findFirst as jest.Mock).mockResolvedValue({
        type: CommissionType.FixedPercent,
        percentage: '10.00',
        fixedAmount: null,
        adminFee: '50.00',
        currency: 'ARS',
        ...overrides.commission,
      });
      (prisma.client.contractPerson.findFirst as jest.Mock).mockResolvedValue({
        personId: OWNER_ID,
        person: { id: OWNER_ID, firstName: 'Ana', lastName: 'Owner' },
      });
      (prisma.client.payment.findMany as jest.Mock).mockResolvedValue(
        (overrides.payments ?? [{ amount: '1000.00' }]).map((p, i) => ({
          id: `pay-${i}`,
          amount: p.amount,
          liquidacion: { period: new Date(2026, 4, 1) },
        })),
      );

      const created: any = { id: RENDICION_ID, lineItems: [] };
      const txClient = {
        ownerRendicion: {
          create: jest.fn().mockResolvedValue(created),
          findFirst: jest.fn().mockImplementation(() =>
            Promise.resolve({ ...created, lineItems: created.lineItems }),
          ),
        },
        rendicionLineItem: {
          create: jest.fn().mockImplementation(({ data }: any) => {
            created.lineItems.push(data);
            return Promise.resolve(data);
          }),
        },
      };
      (prisma.client.$transaction as jest.Mock).mockImplementation((cb: any) => cb(txClient));

      return { txClient };
    }

    it('builds the rendicion with FixedPercent commission and admin fee, and computes totals correctly', async () => {
      const { txClient } = stubHappyPath({ payments: [{ amount: '1000.00' }, { amount: '500.00' }] });

      await service.generate({ contractId: CONTRACT_ID, month: 5, year: 2026 });

      expect(txClient.ownerRendicion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rentCollected: '1500.00',
            commissionAmount: '150.00', // 10% of 1500
            adminFeeAmount: '50.00',
            deductionTotal: '0.00',
            netDeposit: '1300.00', // 1500 - 150 - 50
            status: RendicionStatus.Borrador,
            ownerId: OWNER_ID,
          }),
        }),
      );

      // Alquiler x2 + Comision + AdminFee = 4 line items
      expect(txClient.rendicionLineItem.create).toHaveBeenCalledTimes(4);
      const types = (txClient.rendicionLineItem.create as jest.Mock).mock.calls.map(
        ([{ data }]: any) => data.type,
      );
      expect(types).toEqual([
        RendicionLineItemType.Alquiler,
        RendicionLineItemType.Alquiler,
        RendicionLineItemType.Comision,
        RendicionLineItemType.AdminFee,
      ]);
    });

    it('computes totals correctly for a Mixed commission with no admin fee', async () => {
      const { txClient } = stubHappyPath({
        commission: { type: CommissionType.Mixed, percentage: '5.00', fixedAmount: '100.00', adminFee: null },
        payments: [{ amount: '2000.00' }],
      });

      await service.generate({ contractId: CONTRACT_ID, month: 6, year: 2026 });

      // commission = 100 + 5% of 2000 = 100 + 100 = 200
      expect(txClient.ownerRendicion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rentCollected: '2000.00',
            commissionAmount: '200.00',
            adminFeeAmount: '0.00',
            netDeposit: '1800.00',
          }),
        }),
      );

      // No AdminFee line item when adminFee is 0
      const types = (txClient.rendicionLineItem.create as jest.Mock).mock.calls.map(
        ([{ data }]: any) => data.type,
      );
      expect(types).not.toContain(RendicionLineItemType.AdminFee);
    });

    it('is idempotent — returns the existing rendicion without recomputing', async () => {
      (prisma.client.contract.findFirst as jest.Mock).mockResolvedValue({
        id: CONTRACT_ID,
        tenantId: 'tenant-1',
        property: {},
      });
      const existing = { id: RENDICION_ID, lineItems: [] };
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue(existing);

      const result = await service.generate({ contractId: CONTRACT_ID, month: 5, year: 2026 });

      expect(result).toBe(existing);
      expect(prisma.client.contractCommission.findFirst).not.toHaveBeenCalled();
      expect(prisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('throws COMMISSION_NOT_CONFIGURED when the contract has no commission set up', async () => {
      (prisma.client.contract.findFirst as jest.Mock).mockResolvedValue({
        id: CONTRACT_ID,
        tenantId: 'tenant-1',
        property: {},
      });
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.client.contractCommission.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generate({ contractId: CONTRACT_ID, month: 5, year: 2026 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NO_OWNER when the contract has no Propietario', async () => {
      (prisma.client.contract.findFirst as jest.Mock).mockResolvedValue({
        id: CONTRACT_ID,
        tenantId: 'tenant-1',
        property: {},
      });
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.client.contractCommission.findFirst as jest.Mock).mockResolvedValue({
        type: CommissionType.FixedAmount,
        fixedAmount: '100.00',
        percentage: null,
        adminFee: null,
        currency: 'ARS',
      });
      (prisma.client.contractPerson.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generate({ contractId: CONTRACT_ID, month: 5, year: 2026 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the contract does not exist for the tenant', async () => {
      (prisma.client.contract.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generate({ contractId: CONTRACT_ID, month: 5, year: 2026 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Line items — recalculo de totales ─────────────────────────────────────

  describe('addLineItem / removeLineItem — recalculateTotals', () => {
    function stubDraftRendicion(lineItems: Array<{ id: string; type: string; amount: string }>) {
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue({
        id: RENDICION_ID,
        tenantId: 'tenant-1',
        status: RendicionStatus.Borrador,
        currency: 'ARS',
        lineItems,
      });
      (prisma.client.rendicionLineItem.findMany as jest.Mock).mockResolvedValue(lineItems);
    }

    it('recalculates totals after adding a Deduccion line item', async () => {
      stubDraftRendicion([
        { id: 'li-1', type: 'Alquiler', amount: '1000.00' },
        { id: 'li-2', type: 'Comision', amount: '100.00' },
      ]);
      (prisma.client.rendicionLineItem.findFirst as jest.Mock).mockResolvedValue(null); // maxSort lookup
      (prisma.client as any).rendicionLineItem.create = jest.fn().mockResolvedValue({ id: 'li-3' });

      // After the write, recalculateTotals re-reads line items including the new one
      (prisma.client.rendicionLineItem.findMany as jest.Mock).mockResolvedValue([
        { id: 'li-1', type: 'Alquiler', amount: '1000.00' },
        { id: 'li-2', type: 'Comision', amount: '100.00' },
        { id: 'li-3', type: 'Deduccion', amount: '50.00' },
      ]);

      await service.addLineItem(RENDICION_ID, {
        type: RendicionLineItemType.Deduccion,
        description: 'Reparación',
        amount: '50.00',
        isDebit: true,
      });

      expect(prisma.client.ownerRendicion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rentCollected: '1000.00',
            commissionAmount: '100.00',
            deductionTotal: '50.00',
            netDeposit: '850.00',
          }),
        }),
      );
    });

    it('rejects adding a line item when the rendicion is not Borrador', async () => {
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue({
        id: RENDICION_ID,
        tenantId: 'tenant-1',
        status: RendicionStatus.Aprobada,
        currency: 'ARS',
        lineItems: [],
      });

      await expect(
        service.addLineItem(RENDICION_ID, {
          type: RendicionLineItemType.Deduccion,
          description: 'Reparación',
          amount: '50.00',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('recalculates totals after removing a line item', async () => {
      stubDraftRendicion([
        { id: 'li-1', type: 'Alquiler', amount: '1000.00' },
        { id: 'li-2', type: 'Deduccion', amount: '50.00' },
      ]);
      (prisma.client.rendicionLineItem.findFirst as jest.Mock).mockResolvedValue({
        id: 'li-2',
        rendicionId: RENDICION_ID,
      });

      // After the delete, recalculateTotals re-reads the remaining line items
      (prisma.client.rendicionLineItem.findMany as jest.Mock).mockResolvedValue([
        { id: 'li-1', type: 'Alquiler', amount: '1000.00' },
      ]);

      await service.removeLineItem(RENDICION_ID, 'li-2');

      expect(prisma.client.rendicionLineItem.delete).toHaveBeenCalledWith({ where: { id: 'li-2' } });
      expect(prisma.client.ownerRendicion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rentCollected: '1000.00',
            deductionTotal: '0.00',
            netDeposit: '1000.00',
          }),
        }),
      );
    });
  });

  // ─── transition() — maquina de estados ──────────────────────────────────────

  describe('transition', () => {
    it('moves a Borrador rendicion to Aprobada', async () => {
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue({
        id: RENDICION_ID,
        tenantId: 'tenant-1',
        status: RendicionStatus.Borrador,
        lineItems: [],
      });

      await service.transition(RENDICION_ID, { status: RendicionStatus.Aprobada });

      expect(prisma.client.ownerRendicion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: RENDICION_ID },
          data: expect.objectContaining({ status: RendicionStatus.Aprobada }),
        }),
      );
    });

    it('stamps sentAt when transitioning to Enviada', async () => {
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue({
        id: RENDICION_ID,
        tenantId: 'tenant-1',
        status: RendicionStatus.Aprobada,
        lineItems: [],
      });

      await service.transition(RENDICION_ID, { status: RendicionStatus.Enviada });

      expect(prisma.client.ownerRendicion.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: RendicionStatus.Enviada, sentAt: expect.any(Date) }),
        }),
      );
    });

    it('rejects an invalid transition (Borrador -> Depositada)', async () => {
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue({
        id: RENDICION_ID,
        tenantId: 'tenant-1',
        status: RendicionStatus.Borrador,
        lineItems: [],
      });

      await expect(
        service.transition(RENDICION_ID, { status: RendicionStatus.Depositada }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.client.ownerRendicion.update).not.toHaveBeenCalled();
    });

    it('rejects transitioning out of the terminal Depositada state', async () => {
      (prisma.client.ownerRendicion.findFirst as jest.Mock).mockResolvedValue({
        id: RENDICION_ID,
        tenantId: 'tenant-1',
        status: RendicionStatus.Depositada,
        lineItems: [],
      });

      await expect(
        service.transition(RENDICION_ID, { status: RendicionStatus.Borrador }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
