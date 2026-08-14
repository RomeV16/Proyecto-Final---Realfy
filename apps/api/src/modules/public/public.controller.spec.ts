import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { PublicTenantGuard } from './public-tenant.guard';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_A = {
  id: 'tn000000-0000-0000-0000-00000000000a',
  name: 'Inmobiliaria A',
  slug: 'inmobiliaria-a',
  province: 'Buenos Aires',
  logoUrl: null,
  brandPrimary: '#112233',
  brandSecondary: '#445566',
  isActive: true,
};

const TENANT_B = {
  ...TENANT_A,
  id: 'tn000000-0000-0000-0000-00000000000b',
  name: 'Inmobiliaria B',
  slug: 'inmobiliaria-b',
};

const PROPERTY_ID = 'p0000000-0000-0000-0000-000000000001';

const MOCK_PROPERTY_ITEM = {
  id: PROPERTY_ID,
  title: 'Depto en Palermo',
  type: 'Departamento',
  operationType: 'Alquiler',
  price: 100000,
  currency: 'ARS',
  city: 'CABA',
  province: 'Buenos Aires',
  street: 'Av. Santa Fe',
  area: 45,
  rooms: 2,
  bedrooms: 1,
  bathrooms: 1,
  garages: 0,
  coverUrl: 'https://cdn.example.com/cover.jpg',
  mediaCount: 3,
};

function buildMocks() {
  const publicService = {
    findProperties: jest.fn().mockResolvedValue({
      items: [MOCK_PROPERTY_ITEM],
      total: 1,
      page: 1,
      limit: 12,
    }),
    findProperty: jest.fn().mockResolvedValue({
      ...MOCK_PROPERTY_ITEM,
      description: 'Luminoso departamento con balcon',
      amenities: ['Pileta'],
      media: [
        { url: 'https://cdn.example.com/1.jpg', thumbnailUrl: null, sortOrder: 0, isPrimary: true },
      ],
    }),
    createInquiry: jest.fn().mockResolvedValue({ id: 'lead-001' }),
  };
  return { publicService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PublicController', () => {
  let controller: PublicController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicController],
      providers: [{ provide: PublicService, useValue: mocks.publicService }],
    })
      .overrideGuard(PublicTenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PublicController>(PublicController);
  });

  // ─── GET /public/:slug ────────────────────────────────────────────────────

  describe('GET /public/:slug', () => {
    it('returns only the whitelisted profile fields', async () => {
      const req: any = { publicTenant: TENANT_A };
      const result = await controller.getProfile(req);

      expect(result).toEqual({
        id: TENANT_A.id,
        name: TENANT_A.name,
        slug: TENANT_A.slug,
        province: TENANT_A.province,
        logoUrl: TENANT_A.logoUrl,
        brandPrimary: TENANT_A.brandPrimary,
        brandSecondary: TENANT_A.brandSecondary,
      });
      expect(result).not.toHaveProperty('isActive');
      expect(result).not.toHaveProperty('cuit');
    });
  });

  // ─── GET /public/:slug/properties ─────────────────────────────────────────

  describe('GET /public/:slug/properties', () => {
    it('scopes the listing to the resolved tenant', async () => {
      const req: any = { publicTenant: TENANT_A };
      const result = await controller.listProperties(req, {});

      expect(result).toMatchObject({ items: [MOCK_PROPERTY_ITEM], total: 1 });
      expect(mocks.publicService.findProperties).toHaveBeenCalledWith(TENANT_A.id, {});
    });

    it('coerces page and limit to numbers', async () => {
      const req: any = { publicTenant: TENANT_A };
      await controller.listProperties(req, { page: '2', limit: '24' });

      expect(mocks.publicService.findProperties).toHaveBeenCalledWith(
        TENANT_A.id,
        expect.objectContaining({ page: 2, limit: 24 }),
      );
    });

    it('a property from another tenant never leaks into this tenant listing', async () => {
      // The controller only ever forwards the slug-resolved tenant's id — a
      // property that belongs to TENANT_B has no way to surface here.
      mocks.publicService.findProperties.mockResolvedValueOnce({
        items: [],
        total: 0,
        page: 1,
        limit: 12,
      });

      const req: any = { publicTenant: TENANT_A };
      const result = await controller.listProperties(req, {});

      expect(mocks.publicService.findProperties).toHaveBeenCalledWith(TENANT_A.id, {});
      expect(mocks.publicService.findProperties).not.toHaveBeenCalledWith(
        TENANT_B.id,
        expect.anything(),
      );
      expect(result.items).toHaveLength(0);
    });
  });

  // ─── GET /public/:slug/properties/:id ─────────────────────────────────────

  describe('GET /public/:slug/properties/:id', () => {
    it('returns full detail with ordered media', async () => {
      const req: any = { publicTenant: TENANT_A };
      const result = await controller.getProperty(req, PROPERTY_ID);

      expect(result).toMatchObject({ id: PROPERTY_ID, description: 'Luminoso departamento con balcon' });
      expect(result.media).toHaveLength(1);
      expect(mocks.publicService.findProperty).toHaveBeenCalledWith(TENANT_A.id, PROPERTY_ID);
    });

    it('404s for a property belonging to another tenant', async () => {
      mocks.publicService.findProperty.mockRejectedValueOnce(new NotFoundException());

      const req: any = { publicTenant: TENANT_A };
      await expect(controller.getProperty(req, 'foreign-property-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mocks.publicService.findProperty).toHaveBeenCalledWith(TENANT_A.id, 'foreign-property-id');
    });
  });

  // ─── POST /public/:slug/inquiries ─────────────────────────────────────────

  describe('POST /public/:slug/inquiries', () => {
    it('creates a lead scoped to the resolved tenant', async () => {
      const body = {
        firstName: 'Ana',
        lastName: 'Diaz',
        email: 'ana@example.com',
        message: 'Me interesa la propiedad',
      };
      const req: any = { publicTenant: TENANT_A };
      const result = await controller.createInquiry(req, body);

      expect(result).toEqual({ id: 'lead-001' });
      expect(mocks.publicService.createInquiry).toHaveBeenCalledWith(TENANT_A.id, body);
    });

    it('propagates ConflictException when the tenant has no embudo configured', async () => {
      mocks.publicService.createInquiry.mockRejectedValueOnce(new ConflictException());

      const req: any = { publicTenant: TENANT_A };
      await expect(
        controller.createInquiry(req, {
          firstName: 'Ana',
          lastName: 'Diaz',
          phone: '+541122334455',
          message: 'Hola',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
