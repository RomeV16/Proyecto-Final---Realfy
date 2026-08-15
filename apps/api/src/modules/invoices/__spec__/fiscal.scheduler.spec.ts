import { Test, TestingModule } from '@nestjs/testing';
import { FiscalScheduler } from '../fiscal.scheduler';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ArcaService } from '../arca/arca.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { S3Service } from '../../../common/media/s3.service';

// ─── Minimal mock factories ───────────────────────────────────────────────────

const makePrismaMock = () => ({
  baseClient: {
    arcaCertificate: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    arcaIssuer: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    arcaRequestLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    user: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenant: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    comprobante: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    libroIvaExport: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
});

const makeArcaMock = () => ({
  verifyDelegation: jest.fn(),
});

const makeNotificationsMock = () => ({
  createNotification: jest.fn().mockResolvedValue({}),
});

const makeS3Mock = () => ({
  upload: jest.fn().mockResolvedValue(undefined),
  getObjectUrl: jest.fn().mockReturnValue('https://s3.example.com/key'),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a certificate fixture with notAfter offset from now in days. */
const makeCert = (daysOffset: number, isActive = true) => ({
  id: `cert-${daysOffset}`,
  tenantId: 'tenant-1',
  notAfter: new Date(Date.now() + daysOffset * 24 * 60 * 60 * 1000),
  isActive,
  isProduction: false,
  tenant: { id: 'tenant-1', name: 'Test Tenant' },
});

const makeIssuer = (delegationStatus = 'Active') => ({
  id: 'issuer-1',
  tenantId: 'tenant-1',
  cuit: '20-11111111-1',
  businessName: 'Owner S.A.',
  delegationStatus,
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('FiscalScheduler', () => {
  let scheduler: FiscalScheduler;
  let prisma: ReturnType<typeof makePrismaMock>;
  let arca: ReturnType<typeof makeArcaMock>;
  let notifications: ReturnType<typeof makeNotificationsMock>;
  let s3: ReturnType<typeof makeS3Mock>;

  beforeEach(async () => {
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

  // ── A. checkCertificateExpiry ─────────────────────────────────────────────

  describe('checkCertificateExpiry', () => {
    it('should send a low-priority notification when cert expires in 10 days', async () => {
      const cert = makeCert(10);
      prisma.baseClient.arcaCertificate.findMany.mockResolvedValue([cert]);
      prisma.baseClient.arcaRequestLog.findFirst.mockResolvedValue(null); // not warned yet
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      const result = await scheduler.checkCertificateExpiry();

      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'admin-1',
          type: 'FiscalCertExpiry',
        }),
      );
      // low-priority: title should NOT contain "urgente" or "vencido"
      const callArg = notifications.createNotification.mock.calls[0][0];
      expect(callArg.title).toMatch(/vence en 10 días/i);
      expect(result.notified).toBe(1);
    });

    it('should send a high-priority notification when cert expires in 5 days', async () => {
      const cert = makeCert(5);
      prisma.baseClient.arcaCertificate.findMany.mockResolvedValue([cert]);
      prisma.baseClient.arcaRequestLog.findFirst.mockResolvedValue(null);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      await scheduler.checkCertificateExpiry();

      const callArg = notifications.createNotification.mock.calls[0][0];
      expect(callArg.title).toMatch(/urgente/i);
    });

    it('should deactivate cert and send critical notification when already expired', async () => {
      const cert = makeCert(-2); // 2 days past expiry
      prisma.baseClient.arcaCertificate.findMany.mockResolvedValue([cert]);
      prisma.baseClient.arcaRequestLog.findFirst.mockResolvedValue(null);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      await scheduler.checkCertificateExpiry();

      expect(prisma.baseClient.arcaCertificate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: cert.id },
          data: { isActive: false },
        }),
      );
      const callArg = notifications.createNotification.mock.calls[0][0];
      expect(callArg.title).toMatch(/vencido/i);
    });

    it('idempotency: does NOT send a second notification when already warned today at the same level', async () => {
      const cert = makeCert(10);
      prisma.baseClient.arcaCertificate.findMany.mockResolvedValue([cert]);
      // Simulate already-warned log
      prisma.baseClient.arcaRequestLog.findFirst.mockResolvedValue({ id: 'existing-log' });

      await scheduler.checkCertificateExpiry();

      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('idempotency: running twice same-day does NOT send two notifications', async () => {
      const cert = makeCert(10);
      prisma.baseClient.arcaCertificate.findMany.mockResolvedValue([cert]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      // First run — no prior log
      prisma.baseClient.arcaRequestLog.findFirst.mockResolvedValueOnce(null);
      await scheduler.checkCertificateExpiry();

      // Second run — findFirst returns the log created by first run
      prisma.baseClient.arcaRequestLog.findFirst.mockResolvedValueOnce({ id: 'log-1' });
      await scheduler.checkCertificateExpiry();

      // Notification sent exactly once
      expect(notifications.createNotification).toHaveBeenCalledTimes(1);
    });

    it('returns 0 checked and 0 notified when no expiring certs exist', async () => {
      prisma.baseClient.arcaCertificate.findMany.mockResolvedValue([]);

      const result = await scheduler.checkCertificateExpiry();

      expect(result.checked).toBe(0);
      expect(result.notified).toBe(0);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });
  });

  // ── B. healthcheckDelegations ─────────────────────────────────────────────

  describe('healthcheckDelegations', () => {
    it('flips status to Revoked and notifies when delegation auth fails', async () => {
      const issuer = makeIssuer('Active');
      prisma.baseClient.arcaIssuer.findMany.mockResolvedValue([issuer]);
      arca.verifyDelegation.mockResolvedValue({ ok: false, error: 'auth error' });
      // Simulate issuer updated to Revoked by verifyDelegation internals
      prisma.baseClient.arcaIssuer.findUnique.mockResolvedValue({ delegationStatus: 'Revoked' });
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);

      const result = await scheduler.healthcheckDelegations();

      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'admin-1',
          type: 'FiscalDelegationRevoked',
        }),
      );
      expect(result.revoked).toBe(1);
      expect(result.refreshed).toBe(0);
    });

    it('increments refreshed when delegation is healthy', async () => {
      const issuer = makeIssuer('Active');
      prisma.baseClient.arcaIssuer.findMany.mockResolvedValue([issuer]);
      arca.verifyDelegation.mockResolvedValue({ ok: true });

      const result = await scheduler.healthcheckDelegations();

      expect(result.refreshed).toBe(1);
      expect(result.revoked).toBe(0);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('skips revoked issuers from query (only active + non-revoked are fetched)', async () => {
      // The scheduler queries { delegationStatus: { not: 'Revoked' } }
      // This test verifies that if the mock returns empty (simulating no
      // qualifying issuers), nothing is processed.
      prisma.baseClient.arcaIssuer.findMany.mockResolvedValue([]);

      const result = await scheduler.healthcheckDelegations();

      expect(result.checked).toBe(0);
      expect(arca.verifyDelegation).not.toHaveBeenCalled();
    });

    it('does not notify when transient failure leaves status unchanged', async () => {
      const issuer = makeIssuer('Active');
      prisma.baseClient.arcaIssuer.findMany.mockResolvedValue([issuer]);
      arca.verifyDelegation.mockResolvedValue({ ok: false, error: 'network timeout' });
      // Status NOT updated to Revoked (transient error path in verifyDelegation)
      prisma.baseClient.arcaIssuer.findUnique.mockResolvedValue({ delegationStatus: 'Active' });

      const result = await scheduler.healthcheckDelegations();

      expect(notifications.createNotification).not.toHaveBeenCalled();
      expect(result.revoked).toBe(0);
    });
  });

  // ── C. generateLibroIvaVentas ─────────────────────────────────────────────

  describe('generateLibroIvaVentas', () => {
    it('skips tenants with 0 emissions in previous month', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([]); // 0 emissions

      const result = await scheduler.generateLibroIvaVentas();

      expect(result.skipped).toBe(1);
      expect(result.processed).toBe(0);
      expect(s3.upload).not.toHaveBeenCalled();
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('generates Excel, uploads to S3, and notifies admins for tenants with emissions', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 'tenant-1', name: 'T1' }]);
      prisma.baseClient.comprobante.findMany.mockResolvedValue([
        {
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
          createdAt: new Date(),
          ivaArray: [{ Id: 5, BaseImp: 1000, Importe: 210 }],
          issuer: { cuit: '20-11111111-1', businessName: 'Owner S.A.' },
          payment: { id: 'payment-1' },
          status: 'Emitido',
        },
      ]);
      prisma.baseClient.user.findMany.mockResolvedValue([{ id: 'admin-1' }]);
      prisma.baseClient.libroIvaExport = {
        create: jest.fn().mockResolvedValue({}),
      } as any;

      const result = await scheduler.generateLibroIvaVentas();

      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(0);
      expect(s3.upload).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'LibroIvaGenerated',
          tenantId: 'tenant-1',
        }),
      );
    });

    it('continues processing remaining tenants if one fails', async () => {
      prisma.baseClient.tenant.findMany.mockResolvedValue([
        { id: 'tenant-1', name: 'T1' },
        { id: 'tenant-2', name: 'T2' },
      ]);
      // tenant-1 fails, tenant-2 has 0 emissions
      prisma.baseClient.comprobante.findMany
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce([]);

      const result = await scheduler.generateLibroIvaVentas();

      // tenant-1 threw — processed stays 0; tenant-2 skipped
      expect(result.skipped).toBe(1);
    });
  });
});
