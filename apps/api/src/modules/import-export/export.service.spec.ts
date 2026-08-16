import { ExportService } from './export.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

function createMockPrismaService() {
  return {
    client: {
      property: {
        findMany: jest.fn(),
      },
      person: {
        findMany: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
  } as unknown as TenantContextService;
}

const MOCK_PROPERTY = {
  title: 'Casa en venta',
  type: 'HOUSE',
  street: 'Av. Siempre Viva',
  number: '742',
  floor: null,
  apartment: null,
  city: 'Cordoba',
  province: 'Cordoba',
  zipCode: '5000',
  country: 'Argentina',
  area: 120,
  rooms: 4,
  bedrooms: 3,
  bathrooms: 2,
  garages: 1,
  age: 10,
  price: 150000,
  currency: 'USD',
};

const MOCK_PERSON = {
  firstName: 'Ana',
  lastName: 'Gomez',
  email: 'ana@example.com',
  phone: '3511234567',
  phone2: null,
  cuit: '20304050607',
  fiscalCondition: 'RESPONSABLE_INSCRIPTO',
  bankName: 'Banco Nacion',
  cbu: '0110599520000001234567',
  bankAlias: 'ana.gomez',
  notes: null,
};

describe('ExportService', () => {
  let service: ExportService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new ExportService(prisma as any, tenantContext as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('exportPropertiesCsv', () => {
    it('builds a BOM-prefixed CSV with only active properties', async () => {
      (prisma.client.property.findMany as jest.Mock).mockResolvedValue([MOCK_PROPERTY]);

      const { buffer, fileName } = await service.exportPropertiesCsv();
      const text = buffer.toString('utf-8');

      expect(prisma.client.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(text.charCodeAt(0)).toBe(0xfeff);
      expect(text).toContain('Título');
      expect(text).toContain('Casa en venta');
      expect(fileName).toMatch(/^propiedades-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('escapes fields containing commas or quotes', async () => {
      (prisma.client.property.findMany as jest.Mock).mockResolvedValue([
        { ...MOCK_PROPERTY, title: 'Casa, con "jardin"' },
      ]);

      const { buffer } = await service.exportPropertiesCsv();
      const text = buffer.toString('utf-8');

      expect(text).toContain('"Casa, con ""jardin"""');
    });
  });

  describe('exportPropertiesExcel', () => {
    it('produces a non-empty xlsx buffer', async () => {
      (prisma.client.property.findMany as jest.Mock).mockResolvedValue([MOCK_PROPERTY]);

      const { buffer, fileName } = await service.exportPropertiesExcel();

      expect(buffer.length).toBeGreaterThan(0);
      expect(fileName).toMatch(/^propiedades-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });
  });

  describe('exportPersonsCsv', () => {
    it('builds a CSV with the Spanish person column headers', async () => {
      (prisma.client.person.findMany as jest.Mock).mockResolvedValue([MOCK_PERSON]);

      const { buffer, fileName } = await service.exportPersonsCsv();
      const text = buffer.toString('utf-8');

      expect(prisma.client.person.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(text).toContain('Apellido');
      expect(text).toContain('Gomez');
      expect(fileName).toMatch(/^personas-\d{4}-\d{2}-\d{2}\.csv$/);
    });
  });

  describe('exportPersonsExcel', () => {
    it('produces a non-empty xlsx buffer', async () => {
      (prisma.client.person.findMany as jest.Mock).mockResolvedValue([MOCK_PERSON]);

      const { buffer, fileName } = await service.exportPersonsExcel();

      expect(buffer.length).toBeGreaterThan(0);
      expect(fileName).toMatch(/^personas-\d{4}-\d{2}-\d{2}\.xlsx$/);
    });
  });
});
