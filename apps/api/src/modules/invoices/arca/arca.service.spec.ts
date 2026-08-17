import { Test } from '@nestjs/testing';
import { ArcaService } from './arca.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ArcaClientFactory } from './arca-client.factory';
import { ArcaTaManager } from './arca-ta.manager';
import { ArcaParamCacheService } from './arca-param-cache.service';
import { ArcaRequestLogService } from './arca-request-log.service';
import { PadronA5Service } from './padron-a5.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FiscalCondition } from '@realfy/shared';

// ─── Common fixtures ──────────────────────────────────────────────────────────

const ISSUER_A = {
  id: 'issuer-A',
  tenantId: 'tenant-1',
  cuit: '20-11111111-1',
  businessName: 'Owner A',
  fiscalCondition: FiscalCondition.ResponsableInscripto,
  delegationStatus: 'Active',
  isActive: true,
};

const ISSUER_B = {
  id: 'issuer-B',
  tenantId: 'tenant-1',
  cuit: '20-22222222-2',
  businessName: 'Owner B',
  fiscalCondition: FiscalCondition.ResponsableInscripto,
  delegationStatus: 'Active',
  isActive: true,
};

const BASE_PAYLOAD = {
  puntoDeVenta: 1,
  cbteTipo: 1,
  letra: 'A' as const,
  amount: '1210.00',
  ivaRate: 21,
  concepto: 2,
  docTipo: 80,
  docNro: '20301234564',
  receptorFiscalCondition: FiscalCondition.ResponsableInscripto,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ArcaService', () => {
  let service: ArcaService;
  let prismaMock: any;
  let clientFactoryMock: any;
  let taManagerMock: any;
  let paramCacheMock: any;
  let requestLogMock: any;
  let padronA5Mock: any;

  let mockGetLastVoucher: jest.Mock;
  let mockCreateVoucher: jest.Mock;
  let mockGetSalesPoints: jest.Mock;
  let mockGetServerStatus: jest.Mock;

  beforeEach(async () => {
    mockGetLastVoucher = jest.fn().mockResolvedValue(100);
    mockCreateVoucher = jest.fn().mockResolvedValue({ CAE: 'CAE123456', CAEFchVto: '2026-12-31' });
    mockGetSalesPoints = jest.fn().mockResolvedValue([{ Nro: 1 }]);
    mockGetServerStatus = jest.fn().mockResolvedValue({ AppServer: 'OK' });

    clientFactoryMock = {
      getClient: jest.fn().mockResolvedValue({
        afip: {
          ElectronicBilling: {
            getLastVoucher: mockGetLastVoucher,
            createVoucher: mockCreateVoucher,
            getSalesPoints: mockGetSalesPoints,
            getServerStatus: mockGetServerStatus,
          },
        },
      }),
    };

    taManagerMock = {
      ensureTA: jest.fn().mockResolvedValue(undefined),
    };

    paramCacheMock = {
      get: jest.fn().mockResolvedValue([{ Nro: 1 }]),
    };

    // Pass-through for requestLog.wrap — execute fn and return result
    requestLogMock = {
      wrap: jest.fn().mockImplementation((_opts: any, fn: () => Promise<any>) => fn()),
      attachComprobanteId: jest.fn().mockResolvedValue(undefined),
    };

    padronA5Mock = {
      lookup: jest.fn().mockResolvedValue({
        businessName: 'TEST SA',
        fiscalCondition: 'ResponsableInscripto',
        address: 'AV CORRIENTES 1234, CABA',
      }),
    };

    prismaMock = {
      client: {
        arcaIssuer: {
          findFirst: jest.fn().mockImplementation(({ where }: any) => {
            if (where.id === 'issuer-A') return Promise.resolve(ISSUER_A);
            if (where.id === 'issuer-B') return Promise.resolve(ISSUER_B);
            return Promise.resolve(null);
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        arcaPuntoDeVenta: {
          upsert: jest.fn().mockResolvedValue({ id: 'pdv-1', number: 1 }),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ArcaService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ArcaClientFactory, useValue: clientFactoryMock },
        { provide: ArcaTaManager, useValue: taManagerMock },
        { provide: ArcaParamCacheService, useValue: paramCacheMock },
        { provide: ArcaRequestLogService, useValue: requestLogMock },
        { provide: PadronA5Service, useValue: padronA5Mock },
      ],
    }).compile();

    service = module.get(ArcaService);
  });

  // ─── emit ──────────────────────────────────────────────────────────────────

  describe('emit', () => {
    it('returns cae, caeFchVto, and numero from AFIP response', async () => {
      const result = await service.emit('tenant-1', 'issuer-A', BASE_PAYLOAD);

      expect(result.cae).toBe('CAE123456');
      expect(result.caeFchVto).toBe('2026-12-31');
      expect(result.numero).toBe(101);
    });

    it('uses issuer-A CUIT in SDK client construction', async () => {
      await service.emit('tenant-1', 'issuer-A', BASE_PAYLOAD);
      expect(clientFactoryMock.getClient).toHaveBeenCalledWith('tenant-1', 'issuer-A', expect.any(String));
    });

    it('uses issuer-B CUIT — different from issuer-A', async () => {
      await service.emit('tenant-1', 'issuer-B', BASE_PAYLOAD);
      expect(clientFactoryMock.getClient).toHaveBeenCalledWith('tenant-1', 'issuer-B', expect.any(String));
    });

    it('throws BadRequestException for inactive issuer', async () => {
      prismaMock.client.arcaIssuer.findFirst.mockResolvedValueOnce({
        ...ISSUER_A,
        isActive: false,
      });

      await expect(service.emit('tenant-1', 'issuer-A', BASE_PAYLOAD)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for revoked delegation', async () => {
      prismaMock.client.arcaIssuer.findFirst.mockResolvedValueOnce({
        ...ISSUER_A,
        delegationStatus: 'Revoked',
      });

      await expect(service.emit('tenant-1', 'issuer-A', BASE_PAYLOAD)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for unknown issuer', async () => {
      prismaMock.client.arcaIssuer.findFirst.mockResolvedValueOnce(null);

      await expect(service.emit('tenant-1', 'nonexistent', BASE_PAYLOAD)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── verifyDelegation ─────────────────────────────────────────────────────

  describe('verifyDelegation', () => {
    it('flips delegationStatus to Active on success', async () => {
      await service.verifyDelegation('tenant-1', 'issuer-A');

      expect(prismaMock.client.arcaIssuer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ delegationStatus: 'Active' }),
        }),
      );
    });

    it('flips delegationStatus to Revoked on auth error', async () => {
      requestLogMock.wrap.mockImplementationOnce(async () => {
        throw Object.assign(new Error('permission denied coe.unauthorized'), { code: 'AUTH_ERR' });
      });

      const result = await service.verifyDelegation('tenant-1', 'issuer-A');

      expect(result.ok).toBe(false);
      expect(prismaMock.client.arcaIssuer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ delegationStatus: 'Revoked' }),
        }),
      );
    });

    it('leaves status unchanged on non-auth AFIP error', async () => {
      requestLogMock.wrap.mockImplementationOnce(async () => {
        throw new Error('timeout');
      });

      // First call: taManager.ensureTA (passes), second call: wrap
      const result = await service.verifyDelegation('tenant-1', 'issuer-A');

      expect(result.ok).toBe(false);
      expect(prismaMock.client.arcaIssuer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ delegationStatus: ISSUER_A.delegationStatus }),
        }),
      );
    });

    it('throws NotFoundException for unknown issuer', async () => {
      prismaMock.client.arcaIssuer.findFirst.mockResolvedValueOnce(null);

      await expect(service.verifyDelegation('tenant-1', 'unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── getLastVoucher ───────────────────────────────────────────────────────

  describe('getLastVoucher', () => {
    it('returns last voucher number from AFIP', async () => {
      mockGetLastVoucher.mockResolvedValueOnce(50);

      const result = await service.getLastVoucher('tenant-1', 'issuer-A', 1, 6);

      expect(result).toBe(50);
    });
  });

  // ─── padronLookup ─────────────────────────────────────────────────────────

  describe('padronLookup', () => {
    it('delegates to PadronA5Service.lookup', async () => {
      const result = await service.padronLookup('tenant-1', 'issuer-A', '20-12345678-9');

      expect(padronA5Mock.lookup).toHaveBeenCalledWith('tenant-1', 'issuer-A', '20-12345678-9');
      expect(result).not.toBeNull();
      expect(result!.businessName).toBe('TEST SA');
    });

    it('returns null when PadronA5Service returns null', async () => {
      padronA5Mock.lookup.mockResolvedValueOnce(null);

      const result = await service.padronLookup('tenant-1', 'issuer-A', '20-99999999-9');
      expect(result).toBeNull();
    });
  });

  // ─── syncPuntosDeVenta ────────────────────────────────────────────────────

  describe('syncPuntosDeVenta', () => {
    it('upserts returned sales points', async () => {
      paramCacheMock.get.mockResolvedValueOnce([
        { Nro: 1, EmisionTipo: 'Web Services', Bloqueado: 'N' },
        { Nro: 5, EmisionTipo: 'Factura en Línea', Bloqueado: 'N' },
      ]);

      const rows = await service.syncPuntosDeVenta('tenant-1', 'issuer-A');

      expect(rows).toHaveLength(2);
      expect(prismaMock.client.arcaPuntoDeVenta.upsert).toHaveBeenCalledTimes(2);
    });
  });
});
