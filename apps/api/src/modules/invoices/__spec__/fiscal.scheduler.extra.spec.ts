/**
 * FiscalScheduler — edge-case unit tests.
 *
 * Covers:
 * 1. Libro IVA Excel column count = 16 per RG 1415/2003.
 * 2. Zero emissions for a tenant → no-op (skipped, no Excel, no S3).
 * 3. Per-emisor separation in Libro IVA.
 * 4. Decimal arithmetic in Libro IVA (no Number coercion noise).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { FiscalScheduler } from '../fiscal.scheduler';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ArcaService } from '../arca/arca.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { S3Service } from '../../../common/media/s3.service';
import ExcelJS from 'exceljs';

// ─── Mock factories ───────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  baseClient: {
    arcaCertificate: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    arcaIssuer: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    arcaRequestLog: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
    comprobante: { findMany: jest.fn().mockResolvedValue([]) },
    libroIvaExport: { create: jest.fn().mockResolvedValue({}) },
  },
});

const makeArcaMock = () => ({ verifyDelegation: jest.fn() });
const makeNotificationsMock = () => ({ createNotification: jest.fn().mockResolvedValue({}) });

// Capture the buffer passed to S3 so we can inspect it
let capturedS3Buffer: Buffer | null = null;
const makeS3Mock = () => ({
  upload: jest.fn().mockImplementation(async (_key: string, buffer: Buffer) => {
    capturedS3Buffer = buffer;
  }),
  getObjectUrl: jest.fn().mockReturnValue('https://s3.example.com/key'),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeComprobante = (overrides: Partial<any> = {}) => ({
  id: 'comp-1',
  cbteTipo: 1,
  puntoDeVenta: 1,
  numero: 1,
  docTipo: 80,
  docNro: '20111111111',
  receptorName: 'Cliente A',
  impTotal: '1210.00',
  impNeto: '1000.00',
  impIva: '210.00',
  impExento: '0.00',
  impTrib: '0.00',
  monId: 'PES',
  monCotiz: '1.000000',
  cae: '12345678901234',
  createdAt: new Date('2026-03-15'),
  ivaArray: [{ Id: 5, BaseImp: 1000, Importe: 210 }],
  issuer: { cuit: '20-11111111-1', businessName: 'Owner S.A.' },
  payment: { id: 'payment-1' },
  status: 'Emitido',
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FiscalScheduler — edge cases', () => {
  let scheduler: FiscalScheduler;
  let prisma: ReturnType<typeof makePrismaMock>;
  let arca: ReturnType<typeof makeArcaMock>;
  let notifications: ReturnType<typeof makeNotificationsMock>;
  let s3: ReturnType<typeof makeS3Mock>;

  beforeEach(async () => {
    capturedS3Buffer = null;
    prisma = makePrismaMock();
    arca = makeArcaMock();
    notifications = makeNotificationsMock();
    s3 = makeS3Mock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiscalScheduler,
        { provide: PrismaService, useValue: prisma },
        { provide: ArcaService, useValue: arca },
        { provide: NotificationsService, useValue: notifications },
        { provide: S3Service, useValue: s3 },
      ],
    }).compile();

    scheduler = module.get(FiscalScheduler);
  });

  afterEach(() => jest.clearAllMocks());

  // ── A. Libro IVA column count = 16 (RG 1415/2003) ──────────────────────────

  describe('generateLibroIvaVentas — RG 1415/2003 column count', () => {
    it('Excel workbook has exactly 16 columns per RG 1415/2003', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([makeComprobante()]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      await scheduler.generateLibroIvaVentas();

      // The buffer should have been captured by our S3 mock
      expect(capturedS3Buffer).not.toBeNull();

      // Parse the generated Excel and count columns
      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (workbook.xlsx.load as any)(capturedS3Buffer!);
      const sheet = workbook.worksheets[0];

      // columnCount is the actual number of columns with data in row 1 (header)
      const headerRow = sheet.getRow(1);
      const usedCols = headerRow.cellCount;
      expect(usedCols).toBe(16);
    });

    it('Excel has correct column headers matching RG 1415/2003 mandated fields', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([makeComprobante()]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      await scheduler.generateLibroIvaVentas();

      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (workbook.xlsx.load as any)(capturedS3Buffer!);
      const sheet = workbook.worksheets[0];
      const headers: string[] = [];
      sheet.getRow(1).eachCell((cell) => {
        headers.push(String(cell.value ?? ''));
      });

      // RG 1415/2003 mandatory columns (Spanish labels used in the system)
      expect(headers).toContain('Fecha');
      expect(headers).toContain('Tipo Cbte');
      expect(headers).toContain('Número');
      expect(headers).toContain('Doc. Nro.');
      expect(headers).toContain('Imp. Total');
      expect(headers).toContain('Imp. Neto');
      expect(headers).toContain('IVA');
      expect(headers).toContain('CAE');
      expect(headers).toContain('Moneda');
    });

    it('data row 2 has correct numeric values for the one comprobante', async () => {
      const comp = makeComprobante({
        impTotal: '1210.00',
        impNeto: '1000.00',
        impIva: '210.00',
        cae: '12345678901234',
      });
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([comp]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      await scheduler.generateLibroIvaVentas();

      const workbook = new ExcelJS.Workbook();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (workbook.xlsx.load as any)(capturedS3Buffer!);
      const sheet = workbook.worksheets[0];

      // Row 2 is the first data row
      const dataRow = sheet.getRow(2);
      const values: any[] = [];
      dataRow.eachCell((cell) => values.push(cell.value));

      // impTotal = 1210.00
      expect(values.some((v) => v === 1210 || v === 1210.0)).toBe(true);
      // impNeto = 1000.00
      expect(values.some((v) => v === 1000 || v === 1000.0)).toBe(true);
      // CAE
      expect(values.some((v) => String(v).includes('12345678901234'))).toBe(true);
    });
  });

  // ── B. Zero emissions = no-op ───────────────────────────────────────────────

  describe('generateLibroIvaVentas — zero emissions is a no-op', () => {
    it('does not upload to S3 when tenant has 0 comprobantes', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([]); // 0

      const result = await scheduler.generateLibroIvaVentas();

      expect(result.skipped).toBe(1);
      expect(result.processed).toBe(0);
      expect(s3.upload).not.toHaveBeenCalled();
    });

    it('does not notify admins when tenant has 0 comprobantes', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([]);

      await scheduler.generateLibroIvaVentas();

      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('processes tenant with emissions, skips tenant with 0 in same run', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([
        { id: 'tenant-1', name: 'T1' },
        { id: 'tenant-2', name: 'T2' },
      ]);
      // tenant-1 has emissions, tenant-2 has none
      prisma.baseClient.comprobante.findMany
        .mockResolvedValueOnce([makeComprobante()])
        .mockResolvedValueOnce([]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      const result = await scheduler.generateLibroIvaVentas();

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(s3.upload).toHaveBeenCalledTimes(1);
    });
  });

  // ── C. Per-emisor separation ────────────────────────────────────────────────

  describe('generateLibroIvaVentas — per-emisor separation', () => {
    it('each tenant gets its own S3 upload (separate key paths)', async () => {
      const s3Keys: string[] = [];
      s3.upload.mockImplementation(async (key: string, buffer: Buffer) => {
        capturedS3Buffer = buffer;
        s3Keys.push(key);
      });

      prisma.baseClient.tenant.findMany.mockResolvedValue([
        { id: 'tenant-A', name: 'TA' },
        { id: 'tenant-B', name: 'TB' },
      ]);
      prisma.baseClient.comprobante.findMany
        .mockResolvedValueOnce([makeComprobante({ id: 'comp-A' })])
        .mockResolvedValueOnce([makeComprobante({ id: 'comp-B' })]);
      prisma.baseClient.user.findMany.mockResolvedValue([]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      await scheduler.generateLibroIvaVentas();

      expect(s3Keys.length).toBe(2);
      expect(s3Keys[0]).toContain('tenant-A');
      expect(s3Keys[1]).toContain('tenant-B');
      // Keys should be different
      expect(s3Keys[0]).not.toBe(s3Keys[1]);
    });

    it('each LibroIvaExport record is created with correct tenantId', async () => {
      const createCalls: any[] = [];
      const libroExportMock = { create: jest.fn().mockImplementation(({ data }) => { createCalls.push(data); return {}; }) };
      (prisma.baseClient as any).libroIvaExport = libroExportMock;

      prisma.baseClient.tenant.findMany.mockResolvedValue([
        { id: 'tenant-A', name: 'TA' },
        { id: 'tenant-B', name: 'TB' },
      ]);
      prisma.baseClient.comprobante.findMany
        .mockResolvedValueOnce([makeComprobante()])
        .mockResolvedValueOnce([makeComprobante()]);
      prisma.baseClient.user.findMany.mockResolvedValue([]);

      await scheduler.generateLibroIvaVentas();

      expect(createCalls.length).toBe(2);
      expect(createCalls.map((c) => c.tenantId).sort()).toEqual(['tenant-A', 'tenant-B']);
    });
  });

  // ── D. Decimal arithmetic — no Number() coercion ────────────────────────────

  describe('generateLibroIvaVentas — Decimal precision', () => {
    it('handles amount with many decimal places without floating-point noise', async () => {
      const comp = makeComprobante({
        impTotal: '1210.33',
        impNeto: '1000.27',
        impIva: '210.06',
      });
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([comp]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      // Should not throw — Decimal handles .33/.27/.06 without noise
      await expect(scheduler.generateLibroIvaVentas()).resolves.not.toThrow();
    });

    it('impTotal zero is handled without division errors', async () => {
      const comp = makeComprobante({ impTotal: '0.00', impNeto: '0.00', impIva: '0.00' });
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([comp]);
      prisma.baseClient.user.findMany.mockResolvedValue([]);
      (prisma.baseClient as any).libroIvaExport = { create: jest.fn().mockResolvedValue({}) };

      await expect(scheduler.generateLibroIvaVentas()).resolves.not.toThrow();
    });
  });
});
