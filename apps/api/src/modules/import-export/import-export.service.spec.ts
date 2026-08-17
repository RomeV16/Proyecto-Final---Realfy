import { BadRequestException } from '@nestjs/common';
import { ImportExportService } from './import-export.service';
import { CsvParserService } from './csv-parser.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

function createMockPrismaService() {
  return {
    client: {
      property: { create: jest.fn().mockResolvedValue({ id: 'prop-1' }) },
      person: { create: jest.fn().mockResolvedValue({ id: 'person-1' }) },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
  } as unknown as TenantContextService;
}

describe('ImportExportService', () => {
  let service: ImportExportService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    // Real CsvParserService: exercising the actual parsing/normalization logic
    // is more useful here than mocking it away.
    service = new ImportExportService(prisma as any, tenantContext as any, new CsvParserService());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('upload', () => {
    it('parses the CSV and returns a fileId with headers and sample rows', () => {
      const csv = 'title,price\nCasa,150000\nDepto,90000';
      const result = service.upload(Buffer.from(csv, 'utf-8'), 'propiedades.csv');

      expect(result.fileId).toEqual(expect.any(String));
      expect(result.headers).toEqual(['title', 'price']);
      expect(result.rowCount).toBe(2);
      expect(result.sampleRows).toEqual([
        ['Casa', '150000'],
        ['Depto', '90000'],
      ]);
    });

    it('rejects a CSV with no headers', () => {
      expect(() => service.upload(Buffer.from('', 'utf-8'), 'vacio.csv')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('validate', () => {
    function upload(csv: string) {
      return service.upload(Buffer.from(csv, 'utf-8'), 'propiedades.csv');
    }

    it('normalizes comma-decimal prices before validating', () => {
      const { fileId } = upload('title,price\nCasa en venta,"150.000,50"');

      const result = service.validate(
        fileId,
        'property',
        [
          { sourceColumn: 'title', targetField: 'title' },
          { sourceColumn: 'price', targetField: 'price' },
        ],
      );

      expect(result.errorRows).toBe(0);
      expect(result.validRows).toBe(1);
      expect(result.preview[0].price).toBeCloseTo(150000.5);
    });

    it('flags rows missing a required field', () => {
      const { fileId } = upload('title,price\n,90000');

      const result = service.validate(fileId, 'property', [
        { sourceColumn: 'title', targetField: 'title' },
        { sourceColumn: 'price', targetField: 'price' },
      ]);

      expect(result.validRows).toBe(0);
      expect(result.errorRows).toBe(1);
      expect(result.errors[0]).toMatchObject({ row: 1, field: 'title' });
    });

    it('matches a column mapping against a header that differs only by accent/case/spacing', () => {
      const { fileId } = upload('Título,  Precio\nCasa en venta,120000');

      const result = service.validate(fileId, 'property', [
        { sourceColumn: 'titulo', targetField: 'title' },
        { sourceColumn: 'PRECIO', targetField: 'price' },
      ]);

      expect(result.validRows).toBe(1);
      expect(result.preview[0]).toMatchObject({ title: 'Casa en venta', price: 120000 });
    });

    it('rejects a mapping whose source column is not in the uploaded headers', () => {
      const { fileId } = upload('title,price\nCasa,150000');

      expect(() =>
        service.validate(fileId, 'property', [
          { sourceColumn: 'unknown-column', targetField: 'title' },
        ]),
      ).toThrow(BadRequestException);
    });

    it('throws when the fileId does not exist', () => {
      expect(() => service.validate('missing-file-id', 'property', [])).toThrow(
        BadRequestException,
      );
    });
  });

  describe('execute', () => {
    function upload(csv: string) {
      return service.upload(Buffer.from(csv, 'utf-8'), 'propiedades.csv');
    }

    it('creates a property row per valid record and skips invalid ones', async () => {
      const { fileId } = upload('title,price\nCasa en venta,150000\n,90000');

      const result = await service.execute(fileId, 'property', [
        { sourceColumn: 'title', targetField: 'title' },
        { sourceColumn: 'price', targetField: 'price' },
      ]);

      expect(result.importedRows).toBe(1);
      expect(result.skippedRows).toBe(1);
      expect(prisma.client.property.create).toHaveBeenCalledTimes(1);
      expect(prisma.client.property.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ title: 'Casa en venta', tenantId: 'tenant-1' }),
      });
    });

    it('creates person rows using the tenant from the request context', async () => {
      const { fileId } = upload('firstName,lastName\nAna,Gomez');

      const result = await service.execute(fileId, 'person', [
        { sourceColumn: 'firstName', targetField: 'firstName' },
        { sourceColumn: 'lastName', targetField: 'lastName' },
      ]);

      expect(result.importedRows).toBe(1);
      expect(prisma.client.person.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ firstName: 'Ana', lastName: 'Gomez', tenantId: 'tenant-1' }),
      });
    });

    it('removes the upload from memory so it cannot be executed twice', async () => {
      const { fileId } = upload('title,price\nCasa,150000');

      await service.execute(fileId, 'property', [
        { sourceColumn: 'title', targetField: 'title' },
      ]);

      expect(() =>
        service.validate(fileId, 'property', [{ sourceColumn: 'title', targetField: 'title' }]),
      ).toThrow(BadRequestException);
    });
  });
});
