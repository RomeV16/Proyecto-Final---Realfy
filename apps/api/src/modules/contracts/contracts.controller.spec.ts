import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@realfy/shared';
import { RbacGuard } from '../../common/auth/rbac.guard';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';
import { ContractRulesService } from './contract-rules.service';
import { ContractLessorsService } from './contract-lessors.service';
import { ContractAdjustmentService } from '../index-data/contract-adjustment.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CONTRACT_ID = 'c0000000-0000-0000-0000-000000000001';

const MOCK_CONTRACT = {
  id: CONTRACT_ID,
  status: 'Vigente',
  isActive: true,
  currentRent: '50000.00',
};

const MOCK_PREVIEW = {
  period: '2026-05',
  indexType: 'ICL',
  factor: 1.123456,
  currentRent: '50000.00',
  projectedRent: '56172.80',
  projectedDelta: '6172.80',
  toFixed: (n: number) => '1.123456',
};

function buildMocks() {
  const contractsService = {
    findAll: jest.fn().mockResolvedValue({ items: [MOCK_CONTRACT], total: 1, page: 1, limit: 20 }),
    findOne: jest.fn().mockResolvedValue(MOCK_CONTRACT),
    create: jest.fn().mockResolvedValue(MOCK_CONTRACT),
    update: jest.fn().mockResolvedValue({ ...MOCK_CONTRACT, status: 'Renovado' }),
    terminate: jest.fn().mockResolvedValue({ ...MOCK_CONTRACT, status: 'Rescindido', isActive: false }),
    activate: jest.fn().mockResolvedValue({ ...MOCK_CONTRACT, status: 'Activo', isActive: true }),
    calculateAdjustment: jest.fn().mockResolvedValue({ factor: 1.1, projectedRent: '55000.00' }),
    applyAdjustment: jest.fn().mockResolvedValue({ id: 'adj-001', applied: true }),
    findAdjustments: jest.fn().mockResolvedValue([]),
  };

  const contractAdjustmentService = {
    preview: jest.fn().mockResolvedValue({
      period: '2026-05',
      indexType: 'ICL',
      factor: { toFixed: (n: number) => '1.123456' },
      currentRent: { toFixed: (n: number) => '50000.00' },
      projectedRent: { toFixed: (n: number) => '56172.80' },
      projectedDelta: { toFixed: (n: number) => '6172.80' },
    }),
  };

  const lessors = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue([]),
    replace: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
  };

  const rules = {
    listTerms: jest.fn().mockResolvedValue({ current: null, versions: [] }),
    listPeriods: jest.fn().mockResolvedValue([]),
    listAgreements: jest.fn().mockResolvedValue([]),
    createAgreement: jest.fn().mockResolvedValue({}),
    updateAgreement: jest.fn().mockResolvedValue({}),
    removeAgreement: jest.fn().mockResolvedValue({ deleted: true }),
  };

  return { contractsService, contractAdjustmentService, lessors, rules };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractsController', () => {
  let controller: ContractsController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContractsController],
      providers: [
        { provide: ContractsService, useValue: mocks.contractsService },
        { provide: ContractAdjustmentService, useValue: mocks.contractAdjustmentService },
        { provide: ContractLessorsService, useValue: mocks.lessors },
        { provide: ContractRulesService, useValue: mocks.rules },
      ],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ContractsController>(ContractsController);
  });

  // ─── GET /contracts ───────────────────────────────────────────────────────

  describe('GET /contracts', () => {
    it('returns paginated list', async () => {
      const result = await controller.findAll({});
      expect(result).toMatchObject({ items: [MOCK_CONTRACT], total: 1 });
    });

    it('coerces numeric query params', async () => {
      await controller.findAll({ page: '2', limit: '10', guaranteeExpiringWithinDays: '30' });
      expect(mocks.contractsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, limit: 10, guaranteeExpiringWithinDays: 30 }),
      );
    });

    it('passes non-numeric query params through unchanged', async () => {
      await controller.findAll({ status: 'Vigente' });
      expect(mocks.contractsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Vigente' }),
      );
    });
  });

  // ─── GET /contracts/:id ───────────────────────────────────────────────────

  describe('GET /contracts/:id', () => {
    it('returns contract detail on happy path', async () => {
      const result = await controller.findOne(CONTRACT_ID);
      expect(result).toMatchObject({ id: CONTRACT_ID });
      expect(mocks.contractsService.findOne).toHaveBeenCalledWith(CONTRACT_ID);
    });

    it('propagates NotFoundException when contract missing', async () => {
      mocks.contractsService.findOne.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST /contracts ──────────────────────────────────────────────────────

  describe('POST /contracts', () => {
    const VALID_BODY = { propertyId: 'prop-001', startDate: '2026-01-01' };

    it('creates and returns contract', async () => {
      const result = await controller.create(VALID_BODY);
      expect(result).toMatchObject({ id: CONTRACT_ID });
      expect(mocks.contractsService.create).toHaveBeenCalledWith(VALID_BODY);
    });
  });

  // ─── PATCH /contracts/:id ─────────────────────────────────────────────────

  describe('PATCH /contracts/:id', () => {
    it('updates and returns modified contract', async () => {
      const result = await controller.update(CONTRACT_ID, { status: 'Renovado' });
      expect(result).toMatchObject({ status: 'Renovado' });
      expect(mocks.contractsService.update).toHaveBeenCalledWith(CONTRACT_ID, { status: 'Renovado' });
    });
  });

  // ─── POST /contracts/:id/activate ────────────────────────────────────────

  describe('POST /contracts/:id/activate', () => {
    it('activa el contrato y devuelve el detalle', async () => {
      const result = await controller.activate(CONTRACT_ID);
      expect(result).toMatchObject({ status: 'Activo' });
      expect(mocks.contractsService.activate).toHaveBeenCalledWith(CONTRACT_ID);
    });

    it('propaga los motivos por los que no se puede activar', async () => {
      mocks.contractsService.activate.mockRejectedValueOnce(
        new BadRequestException({
          error: 'CONTRACT_NOT_ACTIVATABLE',
          problems: [{ code: 'MISSING_INQUILINO' }],
        }),
      );
      await expect(controller.activate(CONTRACT_ID)).rejects.toThrow(BadRequestException);
    });
  });

  // ─── POST /contracts/:id/terminate ───────────────────────────────────────

  describe('POST /contracts/:id/terminate', () => {
    it('terminates contract and returns rescinded state', async () => {
      const result = await controller.terminate(CONTRACT_ID);
      expect(result).toMatchObject({ status: 'Rescindido', isActive: false });
      expect(mocks.contractsService.terminate).toHaveBeenCalledWith(CONTRACT_ID);
    });

    it('propagates NotFoundException when contract missing', async () => {
      mocks.contractsService.terminate.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.terminate('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── POST /contracts/:id/adjustments/calculate ───────────────────────────

  describe('POST /contracts/:id/adjustments/calculate', () => {
    it('calculates adjustment when scheduleId provided', async () => {
      const result = await controller.calculateAdjustment(CONTRACT_ID, { scheduleId: 'sched-001' });
      expect(result).toMatchObject({ factor: 1.1 });
    });

    it('throws BadRequestException when scheduleId missing', async () => {
      await expect(controller.calculateAdjustment(CONTRACT_ID, {})).rejects.toThrow(BadRequestException);
    });
  });

  // ─── POST /contracts/:id/adjustments/:adjId/apply ────────────────────────

  describe('POST /contracts/:id/adjustments/:adjId/apply', () => {
    it('applies adjustment on happy path', async () => {
      const result = await controller.applyAdjustment(CONTRACT_ID, 'adj-001');
      expect(result).toMatchObject({ applied: true });
      expect(mocks.contractsService.applyAdjustment).toHaveBeenCalledWith(CONTRACT_ID, 'adj-001');
    });
  });

  // ─── GET /contracts/:id/adjustments ──────────────────────────────────────

  describe('GET /contracts/:id/adjustments', () => {
    it('returns adjustment history', async () => {
      const result = await controller.findAdjustments(CONTRACT_ID);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── POST /contracts/:id/preview-adjustment ───────────────────────────────

  describe('POST /contracts/:id/preview-adjustment', () => {
    it('returns formatted preview with 6-decimal factor', async () => {
      const result = await controller.previewAdjustment(CONTRACT_ID);
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('factor');
      expect(result).toHaveProperty('projectedRent');
      expect(mocks.contractAdjustmentService.preview).toHaveBeenCalledWith(CONTRACT_ID);
    });
  });

  // ─── Roles ────────────────────────────────────────────────────────────────

  describe('roles (RbacGuard real sobre la metadata de @Roles)', () => {
    const guard = new RbacGuard(new Reflector());

    function contextFor(handler: (...args: any[]) => unknown, role: UserRole) {
      return {
        getHandler: () => handler,
        getClass: () => ContractsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      } as unknown as ExecutionContext;
    }

    const activate = ContractsController.prototype.activate;
    const create = ContractsController.prototype.create;
    const terminate = ContractsController.prototype.terminate;

    it.each([UserRole.Admin, UserRole.Gerente, UserRole.Ventas])(
      '%s puede activar un contrato',
      (role) => {
        expect(guard.canActivate(contextFor(activate, role))).toBe(true);
      },
    );

    it.each([
      UserRole.Liquidaciones,
      UserRole.Marketing,
      UserRole.Soporte,
      UserRole.Lectura,
    ])('%s no puede activar un contrato', (role) => {
      expect(() => guard.canActivate(contextFor(activate, role))).toThrow(
        ForbiddenException,
      );
    });

    it('activar exige los mismos roles que crear', () => {
      for (const role of Object.values(UserRole)) {
        let canCreate = true;
        let canActivate = true;
        try {
          guard.canActivate(contextFor(create, role));
        } catch {
          canCreate = false;
        }
        try {
          guard.canActivate(contextFor(activate, role));
        } catch {
          canActivate = false;
        }
        expect(canActivate).toBe(canCreate);
      }
    });

    it('Ventas activa pero no rescinde', () => {
      expect(guard.canActivate(contextFor(activate, UserRole.Ventas))).toBe(true);
      expect(() => guard.canActivate(contextFor(terminate, UserRole.Ventas))).toThrow(
        ForbiddenException,
      );
    });
  });

  // ─── Locadores ────────────────────────────────────────────────────────────

  describe('locadores', () => {
    it('GET /contracts/:id/lessors delega con la fecha pedida', async () => {
      await controller.listLessors(CONTRACT_ID, '2026-06-01');

      expect(mocks.lessors.list).toHaveBeenCalledWith(CONTRACT_ID, '2026-06-01');
    });

    it('POST, PUT, PATCH y DELETE delegan en el servicio de locadores', async () => {
      await controller.addLessor(CONTRACT_ID, { personId: 'p' });
      await controller.replaceLessors(CONTRACT_ID, { lessors: [] });
      await controller.updateLessor(CONTRACT_ID, 'l1', { payoutPct: '50' });
      await controller.removeLessor(CONTRACT_ID, 'l1');

      expect(mocks.lessors.create).toHaveBeenCalledWith(CONTRACT_ID, { personId: 'p' });
      expect(mocks.lessors.replace).toHaveBeenCalledWith(CONTRACT_ID, { lessors: [] });
      expect(mocks.lessors.update).toHaveBeenCalledWith(CONTRACT_ID, 'l1', { payoutPct: '50' });
      expect(mocks.lessors.remove).toHaveBeenCalledWith(CONTRACT_ID, 'l1');
    });

    describe('roles', () => {
      const guard = new RbacGuard(new Reflector());
      const contextFor = (handler: (...args: any[]) => unknown, role: UserRole) =>
        ({
          getHandler: () => handler,
          getClass: () => ContractsController,
          switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
        }) as unknown as ExecutionContext;
      const writes = [
        ContractsController.prototype.addLessor,
        ContractsController.prototype.replaceLessors,
        ContractsController.prototype.updateLessor,
        ContractsController.prototype.removeLessor,
      ];

      it.each([UserRole.Admin, UserRole.Gerente, UserRole.Ventas])(
        '%s puede cambiar los locadores',
        (role) => {
          for (const handler of writes) {
            expect(guard.canActivate(contextFor(handler, role))).toBe(true);
          }
        },
      );

      it.each([UserRole.Liquidaciones, UserRole.Marketing, UserRole.Soporte, UserRole.Lectura])(
        '%s no puede cambiar los locadores',
        (role) => {
          for (const handler of writes) {
            expect(() => guard.canActivate(contextFor(handler, role))).toThrow(ForbiddenException);
          }
        },
      );

      it('leer los locadores no exige rol', () => {
        expect(guard.canActivate(contextFor(ContractsController.prototype.listLessors, UserRole.Lectura))).toBe(true);
      });
    });
  });

  // ─── Reglas versionadas y convenios ───────────────────────────────────────

  describe('reglas y convenios', () => {
    const guard = new RbacGuard(new Reflector());
    const contextFor = (handler: (...args: any[]) => unknown, role: UserRole) =>
      ({
        getHandler: () => handler,
        getClass: () => ContractsController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as unknown as ExecutionContext;
    const writes = [
      ContractsController.prototype.createAgreement,
      ContractsController.prototype.updateAgreement,
      ContractsController.prototype.removeAgreement,
    ];

    it('las lecturas delegan en el servicio de reglas', async () => {
      await controller.listTerms(CONTRACT_ID, '2026-06-01');
      await controller.listPeriods(CONTRACT_ID);
      await controller.listAgreements(CONTRACT_ID);

      expect(mocks.rules.listTerms).toHaveBeenCalledWith(CONTRACT_ID, '2026-06-01');
      expect(mocks.rules.listPeriods).toHaveBeenCalledWith(CONTRACT_ID);
      expect(mocks.rules.listAgreements).toHaveBeenCalledWith(CONTRACT_ID);
    });

    it('POST, PATCH y DELETE de convenios delegan en el servicio', async () => {
      await controller.createAgreement(CONTRACT_ID, { kind: 'Rebaja' });
      await controller.updateAgreement(CONTRACT_ID, 'a1', { notes: 'x' });
      await controller.removeAgreement(CONTRACT_ID, 'a1');

      expect(mocks.rules.createAgreement).toHaveBeenCalledWith(CONTRACT_ID, { kind: 'Rebaja' });
      expect(mocks.rules.updateAgreement).toHaveBeenCalledWith(CONTRACT_ID, 'a1', { notes: 'x' });
      expect(mocks.rules.removeAgreement).toHaveBeenCalledWith(CONTRACT_ID, 'a1');
    });

    it.each([UserRole.Admin, UserRole.Gerente])('%s puede registrar convenios', (role) => {
      for (const handler of writes) {
        expect(guard.canActivate(contextFor(handler, role))).toBe(true);
      }
    });

    it.each([UserRole.Ventas, UserRole.Liquidaciones, UserRole.Marketing, UserRole.Soporte, UserRole.Lectura])(
      '%s no puede registrar convenios',
      (role) => {
        for (const handler of writes) {
          expect(() => guard.canActivate(contextFor(handler, role))).toThrow(ForbiddenException);
        }
      },
    );
  });
});
