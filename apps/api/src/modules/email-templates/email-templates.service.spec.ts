import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmailTemplatesService } from './email-templates.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CommonEmailService } from '../../common/email/common-email.service';

function createMockPrismaService() {
  return {
    client: {
      emailTemplate: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
  } as unknown as TenantContextService;
}

function createMockEmailService() {
  return {
    isConfigured: jest.fn().mockReturnValue(true),
    sendEmail: jest.fn(),
  } as unknown as CommonEmailService;
}

describe('EmailTemplatesService', () => {
  let service: EmailTemplatesService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;
  let emailService: ReturnType<typeof createMockEmailService>;

  const TENANT_ID = 'tenant-abc';

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    emailService = createMockEmailService();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(TENANT_ID);
    service = new EmailTemplatesService(
      prisma as any,
      tenantContext as any,
      emailService as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('auto-extracts variables from subject and body when none provided', async () => {
      (prisma.client.emailTemplate.create as jest.Mock).mockImplementation(
        ({ data }: any) => Promise.resolve({ id: 't1', ...data }),
      );

      const result: any = await service.create({
        name: 'Bienvenida',
        subject: 'Hola {{nombre}}',
        body: 'Estimado {{nombre}}, su propiedad {{propiedad}} espera.',
      });

      expect(result.variables).toEqual(['nombre', 'propiedad']);
      expect(prisma.client.emailTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tenantId: TENANT_ID }),
        }),
      );
    });

    it('throws a validation error for invalid input', async () => {
      await expect(service.create({ name: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('maps a P2002 unique violation to a friendly error', async () => {
      (prisma.client.emailTemplate.create as jest.Mock).mockRejectedValue({
        code: 'P2002',
      });

      await expect(
        service.create({
          name: 'Dup',
          subject: 'S',
          body: 'B',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns a paginated envelope', async () => {
      (prisma.client.emailTemplate.findMany as jest.Mock).mockResolvedValue([
        { id: 't1' },
      ]);
      (prisma.client.emailTemplate.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result).toEqual({
        items: [{ id: 't1' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('builds a search OR filter when search is provided', async () => {
      (prisma.client.emailTemplate.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.client.emailTemplate.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ search: 'bienvenida' });

      const call = (prisma.client.emailTemplate.findMany as jest.Mock).mock
        .calls[0][0];
      expect(call.where.OR).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when the template is missing', async () => {
      (prisma.client.emailTemplate.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('recomputes variables when the body changes', async () => {
      (prisma.client.emailTemplate.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        subject: 'Hola',
        body: 'Original',
      });
      (prisma.client.emailTemplate.update as jest.Mock).mockImplementation(
        ({ data }: any) => Promise.resolve({ id: 't1', ...data }),
      );

      const result: any = await service.update('t1', {
        body: 'Hola {{cliente}}',
      });

      expect(result.variables).toEqual(['cliente']);
    });
  });

  describe('remove', () => {
    it('deletes an existing template', async () => {
      (prisma.client.emailTemplate.findFirst as jest.Mock).mockResolvedValue({
        id: 't1',
        name: 'X',
        tenantId: TENANT_ID,
      });
      (prisma.client.emailTemplate.delete as jest.Mock).mockResolvedValue({});

      const result = await service.remove('t1');

      expect(result).toEqual({ deleted: true });
    });
  });

  describe('preview', () => {
    it('renders subject and body with the supplied variables', async () => {
      const result = await service.preview('t1', {
        subject: 'Hola {{nombre}}',
        body: 'Bienvenido {{nombre}}',
        variables: { nombre: 'Ana' },
      });

      expect(result.subject).toBe('Hola Ana');
      expect(result.body).toBe('Bienvenido Ana');
    });
  });
});
