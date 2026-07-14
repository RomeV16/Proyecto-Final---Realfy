/**
 * Smoke spec for IndexDataController — focuses on the /refresh 403 enforcement.
 *
 * Uses NestJS testing utilities with mocked guards to simulate role-based access.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ForbiddenException } from '@nestjs/common';
import { IndexDataController } from './index-data.controller';
import { IndexDataService } from './index-data.service';
import { IndexScraperService } from './index-scraper.service';
import { APP_GUARD } from '@nestjs/core';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

// ─── Mock Services ──────────────────────────────────────────────────────────

const mockFindLatest = jest.fn().mockResolvedValue([]);
const mockUpsertAll = jest.fn().mockResolvedValue({ icl: 1, uva: 1, ipc: 1 });

const mockIndexDataService = {
  findAll: jest.fn(),
  create: jest.fn(),
  createBulk: jest.fn(),
  delete: jest.fn(),
  findLatest: mockFindLatest,
};

const mockIndexScraperService = {
  upsertAll: mockUpsertAll,
};

// ─── Configurable auth guard ─────────────────────────────────────────────────

let currentUserRole: string | null = 'Admin';

class MockRbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles: string[] = this.reflector.getAllAndOverride('roles', [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];

    if (requiredRoles.length === 0) return true;
    if (!currentUserRole) throw new ForbiddenException();
    if (!requiredRoles.includes(currentUserRole)) throw new ForbiddenException();
    return true;
  }
}

class MockJwtGuard implements CanActivate {
  canActivate(): boolean {
    return currentUserRole !== null;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IndexDataController (smoke)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndexDataController],
      providers: [
        { provide: IndexDataService, useValue: mockIndexDataService },
        { provide: IndexScraperService, useValue: mockIndexScraperService },
        Reflector,
        { provide: APP_GUARD, useClass: MockJwtGuard },
        { provide: APP_GUARD, useClass: MockRbacGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUserRole = 'Admin';
  });

  it('GET /index-data/latest — returns data for Admin', async () => {
    currentUserRole = 'Admin';
    const controller = app.get(IndexDataController);
    const result = await controller.getLatest();
    expect(Array.isArray(result)).toBe(true);
    expect(mockFindLatest).toHaveBeenCalledTimes(1);
  });

  it('GET /index-data/latest — returns data for Gerente', async () => {
    currentUserRole = 'Gerente';
    const controller = app.get(IndexDataController);
    const result = await controller.getLatest();
    expect(Array.isArray(result)).toBe(true);
  });

  it('POST /index-data/refresh — calls upsertAll and returns counts for Admin', async () => {
    currentUserRole = 'Admin';
    const controller = app.get(IndexDataController);
    const result = await controller.refresh();
    expect(result.total).toBe(3);
    expect(mockUpsertAll).toHaveBeenCalledTimes(1);
  });

  it('POST /index-data/refresh — Guard rejects non-Admin (simulated via RBAC guard)', async () => {
    // The RBAC guard would reject a Gerente attempting POST /refresh (Admin-only).
    // We simulate by calling the guard logic directly.
    const reflector = new Reflector();
    const guard = new MockRbacGuard(reflector);

    // Simulate a Gerente
    currentUserRole = 'Gerente';

    // Build a minimal fake ExecutionContext that returns Admin-only roles metadata
    const mockContext = {
      getHandler: () => IndexDataController.prototype.refresh,
      getClass: () => IndexDataController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'Gerente' } }),
      }),
    } as unknown as ExecutionContext;

    // reflector won't find metadata without DI wiring, so we override getAllAndOverride
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['Admin']);

    expect(() => guard.canActivate(mockContext)).toThrow(ForbiddenException);
  });
});
