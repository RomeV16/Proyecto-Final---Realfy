/**
 * Tests for the tenant isolation Prisma extension logic.
 *
 * Since Prisma.defineExtension wraps the config into a closure `(client) => client.$extends(config)`,
 * we can't easily extract the handler. Instead, we import the extension config builder,
 * mock a minimal Prisma $extends surface, and verify the handler modifies args correctly.
 */

import { TenantContextService } from '../../src/common/tenant/tenant-context.service';

// We need to mock Prisma.defineExtension to capture the config before it gets wrapped
jest.mock('@prisma/client', () => {
  return {
    Prisma: {
      defineExtension: (config: any) => config,
    },
  };
});

// Import AFTER mock is set up
import { createTenantExtension } from '../../src/common/tenant/prisma-tenant.extension';
import { TenantIsolationError } from '../../src/common/tenant/tenant-isolation.error';

function createMockTenantContext(overrides: Partial<Record<string, any>> = {}): TenantContextService {
  return {
    getTenantId: jest.fn().mockReturnValue('tenant-123'),
    setTenantId: jest.fn(),
    getUserId: jest.fn().mockReturnValue('user-456'),
    setUserId: jest.fn(),
    getUserRole: jest.fn().mockReturnValue('Admin'),
    setUserRole: jest.fn(),
    getIpAddress: jest.fn().mockReturnValue('127.0.0.1'),
    setIpAddress: jest.fn(),
    isTenantFilterBypassed: jest.fn().mockReturnValue(false),
    setBypassTenantFilter: jest.fn(),
    ...overrides,
  } as unknown as TenantContextService;
}

describe('Prisma Tenant Extension', () => {
  let tenantContext: TenantContextService;
  let handler: (params: { model: string; operation: string; args: any; query: jest.Mock }) => Promise<any>;

  beforeEach(() => {
    tenantContext = createMockTenantContext();
    // With the mock, createTenantExtension returns the raw config object
    const config = createTenantExtension(tenantContext) as any;
    handler = config.query.$allModels.$allOperations;
  });

  it('should return a valid extension config', () => {
    const config = createTenantExtension(tenantContext) as any;
    expect(config.name).toBe('tenant-isolation');
    expect(config.query.$allModels.$allOperations).toBeDefined();
  });

  it('should inject tenantId into findMany WHERE clause', async () => {
    const mockQuery = jest.fn().mockResolvedValue([]);
    const args = { where: { isActive: true } };

    await handler({ model: 'User', operation: 'findMany', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-123',
          isActive: true,
        }),
      }),
    );
  });

  it('should inject tenantId into findFirst WHERE clause', async () => {
    const mockQuery = jest.fn().mockResolvedValue(null);
    const args = { where: { email: 'test@test.com' } };

    await handler({ model: 'User', operation: 'findFirst', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-123',
          email: 'test@test.com',
        }),
      }),
    );
  });

  it('should inject tenantId into create data', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ id: 'new-id' });
    const args = {
      data: { email: 'test@test.com', firstName: 'Test', lastName: 'User' },
    };

    await handler({ model: 'User', operation: 'create', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          email: 'test@test.com',
        }),
      }),
    );
  });

  it('should NOT overwrite explicitly set tenantId on create', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ id: 'new-id' });
    const args = {
      data: { email: 'test@test.com', tenantId: 'explicit-tenant' },
    };

    await handler({ model: 'User', operation: 'create', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'explicit-tenant',
        }),
      }),
    );
  });

  it('should NOT inject tenantId for non-tenant-scoped models (RefreshToken)', async () => {
    const mockQuery = jest.fn().mockResolvedValue([]);
    const args = { where: { userId: 'user-123' } };

    await handler({ model: 'RefreshToken', operation: 'findMany', args, query: mockQuery });

    // Should pass through unchanged
    expect(mockQuery).toHaveBeenCalledWith(args);
  });

  it('should skip filtering when bypassTenantFilter is true', async () => {
    (tenantContext.isTenantFilterBypassed as jest.Mock).mockReturnValue(true);

    const mockQuery = jest.fn().mockResolvedValue([]);
    const args = { where: { email: 'test@test.com' } };

    await handler({ model: 'User', operation: 'findMany', args, query: mockQuery });

    // Should pass through unchanged (no tenantId injected)
    expect(mockQuery).toHaveBeenCalledWith(args);
  });

  it('should inject tenantId into update WHERE clause', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ id: 'user-1' });
    const args = {
      where: { id: 'user-1' },
      data: { firstName: 'Updated' },
    };

    await handler({ model: 'User', operation: 'update', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'user-1',
          tenantId: 'tenant-123',
        }),
      }),
    );
  });

  it('should inject tenantId into deleteMany WHERE clause', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ count: 0 });
    const args = { where: { isActive: false } };

    await handler({ model: 'User', operation: 'deleteMany', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          isActive: false,
          tenantId: 'tenant-123',
        }),
      }),
    );
  });

  it('should use id field for Tenant model instead of tenantId', async () => {
    const mockQuery = jest.fn().mockResolvedValue(null);
    const args = { where: {} };

    await handler({ model: 'Tenant', operation: 'findFirst', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'tenant-123',
        }),
      }),
    );
  });

  it('should NOT inject tenantId into Tenant create data (uses id)', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ id: 'tenant-123' });
    const args = { data: { name: 'New Tenant', cuit: '30-12345678-9' } };

    await handler({ model: 'Tenant', operation: 'create', args, query: mockQuery });

    // For Tenant model, tenantField is 'id', and we skip injection for 'id' on create
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Tenant',
        }),
      }),
    );
    // Should NOT have tenantId in the data
    const calledArgs = mockQuery.mock.calls[0][0];
    expect(calledArgs.data.tenantId).toBeUndefined();
  });

  describe('fail-closed behaviour with no tenantId in context', () => {
    beforeEach(() => {
      (tenantContext.getTenantId as jest.Mock).mockReturnValue(undefined);
    });

    it('should refuse a read on a tenant-scoped model instead of running it unfiltered', async () => {
      const mockQuery = jest.fn().mockResolvedValue([]);

      await expect(
        handler({ model: 'User', operation: 'findMany', args: { where: {} }, query: mockQuery }),
      ).rejects.toThrow(TenantIsolationError);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should name the offending model and operation in the error', async () => {
      const mockQuery = jest.fn();

      await expect(
        handler({ model: 'Contract', operation: 'deleteMany', args: {}, query: mockQuery }),
      ).rejects.toMatchObject({
        name: 'TenantIsolationError',
        model: 'Contract',
        operation: 'deleteMany',
      });
    });

    it('should refuse writes too, not just reads', async () => {
      const mockQuery = jest.fn();

      await expect(
        handler({
          model: 'Property',
          operation: 'create',
          args: { data: { title: 'Depto' } },
          query: mockQuery,
        }),
      ).rejects.toThrow(TenantIsolationError);

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('should still let non-tenant-scoped models through', async () => {
      const mockQuery = jest.fn().mockResolvedValue([]);
      const args = { where: { userId: 'user-123' } };

      await handler({ model: 'RefreshToken', operation: 'findMany', args, query: mockQuery });

      expect(mockQuery).toHaveBeenCalledWith(args);
    });

    it('should still let an explicit bypass through — login and slug resolution rely on it', async () => {
      (tenantContext.isTenantFilterBypassed as jest.Mock).mockReturnValue(true);

      const mockQuery = jest.fn().mockResolvedValue([]);
      const args = { where: { email: 'test@test.com' } };

      await handler({ model: 'User', operation: 'findMany', args, query: mockQuery });

      expect(mockQuery).toHaveBeenCalledWith(args);
    });
  });

  it('should inject tenantId into count WHERE clause', async () => {
    const mockQuery = jest.fn().mockResolvedValue(5);
    const args = { where: { isActive: true } };

    await handler({ model: 'User', operation: 'count', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-123',
          isActive: true,
        }),
      }),
    );
  });

  it('should inject tenantId into upsert where and create', async () => {
    const mockQuery = jest.fn().mockResolvedValue({ id: 'user-1' });
    const args = {
      where: { id: 'user-1' },
      create: { email: 'test@test.com' },
      update: { email: 'updated@test.com' },
    };

    await handler({ model: 'User', operation: 'upsert', args, query: mockQuery });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'user-1',
          tenantId: 'tenant-123',
        }),
        create: expect.objectContaining({
          tenantId: 'tenant-123',
          email: 'test@test.com',
        }),
      }),
    );
  });
});
