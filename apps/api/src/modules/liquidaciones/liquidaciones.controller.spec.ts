import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { LiquidacionesController } from './liquidaciones.controller';
import { LiquidacionesService } from './liquidaciones.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const LIQ_ID = 'lq000000-0000-0000-0000-000000000001';

const MOCK_LIQ = {
  id: LIQ_ID,
  status: 'Borrador',
  month: 4,
  year: 2026,
  totalAmount: '75000.00',
};

function buildMocks() {
  const liquidacionesService = {
    findAll: jest.fn().mockResolvedValue({ items: [MOCK_LIQ], total: 1, page: 1, limit: 20 }),
    generate: jest.fn().mockResolvedValue({ created: 3, skipped: 0 }),
    bulkApprove: jest.fn().mockResolvedValue({ approved: 2 }),
    bulkSend: jest.fn().mockResolvedValue({ sent: 2 }),
    findOne: jest.fn().mockResolvedValue({ ...MOCK_LIQ, lineItems: [], payments: [] }),
    generatePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
    addLineItem: jest.fn().mockResolvedValue({ id: 'li-001', description: 'Honorarios', amount: '5000.00' }),
    updateLineItem: jest.fn().mockResolvedValue({ id: 'li-001', amount: '6000.00' }),
    removeLineItem: jest.fn().mockResolvedValue({ id: 'li-001', removed: true }),
    transition: jest.fn().mockResolvedValue({ ...MOCK_LIQ, status: 'Aprobada' }),
    registerPayment: jest.fn().mockResolvedValue({ id: 'pay-001', amount: '75000.00', method: 'transferencia' }),
    findPayments: jest.fn().mockResolvedValue([{ id: 'pay-001', amount: '75000.00' }]),
    remove: jest.fn().mockResolvedValue({ ...MOCK_LIQ, isActive: false }),
  };
  return { liquidacionesService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LiquidacionesController', () => {
  let controller: LiquidacionesController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LiquidacionesController],
      providers: [{ provide: LiquidacionesService, useValue: mocks.liquidacionesService }],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<LiquidacionesController>(LiquidacionesController);
  });

  // ─── GET /liquidaciones ───────────────────────────────────────────────────

  describe('GET /liquidaciones', () => {
    it('returns paginated list on happy path', async () => {
      const result = await controller.findAll({});
      expect(result).toMatchObject({ items: [MOCK_LIQ], total: 1 });
    });

    it('coerces page, limit, month, year to numbers', async () => {
      await controller.findAll({ page: '1', limit: '20', month: '4', year: '2026' });
      expect(mocks.liquidacionesService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, limit: 20, month: 4, year: 2026 }),
      );
    });
  });

  // ─── POST /liquidaciones/generate ────────────────────────────────────────

  describe('POST /liquidaciones/generate', () => {
    it('generates liquidaciones for month/year', async () => {
      const result = await controller.generate({ month: 4, year: 2026 });
      expect(result).toMatchObject({ created: 3, skipped: 0 });
      expect(mocks.liquidacionesService.generate).toHaveBeenCalledWith({ month: 4, year: 2026 });
    });
  });

  // ─── POST /liquidaciones/bulk-approve ─────────────────────────────────────

  describe('POST /liquidaciones/bulk-approve', () => {
    it('bulk approves and returns count', async () => {
      const result = await controller.bulkApprove({ ids: [LIQ_ID, 'lq2'] });
      expect(result).toMatchObject({ approved: 2 });
    });
  });

  // ─── POST /liquidaciones/bulk-send ────────────────────────────────────────

  describe('POST /liquidaciones/bulk-send', () => {
    it('bulk sends and returns count', async () => {
      const result = await controller.bulkSend({ ids: [LIQ_ID, 'lq2'] });
      expect(result).toMatchObject({ sent: 2 });
    });
  });

  // ─── GET /liquidaciones/:id ───────────────────────────────────────────────

  describe('GET /liquidaciones/:id', () => {
    it('returns liquidación detail with line items and payments', async () => {
      const result = await controller.findOne(LIQ_ID);
      expect(result).toMatchObject({ id: LIQ_ID });
      expect(result).toHaveProperty('lineItems');
      expect(result).toHaveProperty('payments');
    });

    it('propagates NotFoundException when not found', async () => {
      mocks.liquidacionesService.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findOne('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── GET /liquidaciones/:id/pdf ───────────────────────────────────────────

  describe('GET /liquidaciones/:id/pdf', () => {
    it('calls generatePdf and streams response', async () => {
      const mockRes = {
        set: jest.fn(),
        end: jest.fn(),
      } as any;
      await controller.getPdf(LIQ_ID, mockRes);
      expect(mocks.liquidacionesService.generatePdf).toHaveBeenCalledWith(LIQ_ID);
      expect(mockRes.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'application/pdf' }));
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  // ─── POST /liquidaciones/:id/line-items ───────────────────────────────────

  describe('POST /liquidaciones/:id/line-items', () => {
    it('adds line item', async () => {
      const result = await controller.addLineItem(LIQ_ID, { description: 'Honorarios', amount: '5000.00' });
      expect(result).toMatchObject({ description: 'Honorarios' });
    });
  });

  // ─── PATCH /liquidaciones/:id/line-items/:lineItemId ──────────────────────

  describe('PATCH /liquidaciones/:id/line-items/:lineItemId', () => {
    it('updates line item amount', async () => {
      const result = await controller.updateLineItem('li-001', { amount: '6000.00' });
      expect(result).toMatchObject({ amount: '6000.00' });
    });
  });

  // ─── DELETE /liquidaciones/:id/line-items/:lineItemId ─────────────────────

  describe('DELETE /liquidaciones/:id/line-items/:lineItemId', () => {
    it('removes line item', async () => {
      const result = await controller.removeLineItem('li-001');
      expect(result).toMatchObject({ removed: true });
    });
  });

  // ─── POST /liquidaciones/:id/transition ───────────────────────────────────

  describe('POST /liquidaciones/:id/transition', () => {
    it('transitions liquidación to Aprobada', async () => {
      const result = await controller.transition(LIQ_ID, { status: 'Aprobada' });
      expect(result).toMatchObject({ status: 'Aprobada' });
    });
  });

  // ─── POST /liquidaciones/:id/payments ─────────────────────────────────────

  describe('POST /liquidaciones/:id/payments', () => {
    it('registers a payment', async () => {
      const result = await controller.registerPayment(LIQ_ID, { amount: '75000.00', method: 'transferencia' });
      expect(result).toMatchObject({ amount: '75000.00', method: 'transferencia' });
    });
  });

  // ─── GET /liquidaciones/:id/payments ──────────────────────────────────────

  describe('GET /liquidaciones/:id/payments', () => {
    it('returns payment list', async () => {
      const result = await controller.findPayments(LIQ_ID);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toMatchObject({ id: 'pay-001' });
    });
  });

  // ─── DELETE /liquidaciones/:id ────────────────────────────────────────────

  describe('DELETE /liquidaciones/:id', () => {
    it('removes liquidación', async () => {
      const result = await controller.remove(LIQ_ID);
      expect(result).toMatchObject({ isActive: false });
      expect(mocks.liquidacionesService.remove).toHaveBeenCalledWith(LIQ_ID);
    });
  });
});
