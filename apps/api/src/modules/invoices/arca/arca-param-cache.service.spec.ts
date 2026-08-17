import { Test } from '@nestjs/testing';
import { ArcaParamCacheService } from './arca-param-cache.service';
import { ArcaClientFactory } from './arca-client.factory';

describe('ArcaParamCacheService', () => {
  let service: ArcaParamCacheService;
  let clientFactoryMock: any;
  let mockGetSalesPoints: jest.Mock;
  let mockGetVoucherTypes: jest.Mock;

  let mockGetCondicionIvaReceptor: jest.Mock;

  beforeEach(async () => {
    mockGetSalesPoints = jest.fn().mockResolvedValue([{ Nro: 1, EmisionTipo: 'Web Services' }]);
    mockGetVoucherTypes = jest.fn().mockResolvedValue([{ Id: 1, Desc: 'Factura A' }]);
    mockGetCondicionIvaReceptor = jest.fn().mockResolvedValue([{ Id: 5, Desc: 'Consumidor Final' }]);

    clientFactoryMock = {
      getClient: jest.fn().mockResolvedValue({
        afip: {
          ElectronicBilling: {
            getSalesPoints: mockGetSalesPoints,
            getVoucherTypes: mockGetVoucherTypes,
            getDocumentTypes: jest.fn().mockResolvedValue([]),
            getAliquotTypes: jest.fn().mockResolvedValue([]),
            getConceptTypes: jest.fn().mockResolvedValue([]),
            getCondicionIvaReceptor: mockGetCondicionIvaReceptor,
          },
        },
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        ArcaParamCacheService,
        { provide: ArcaClientFactory, useValue: clientFactoryMock },
      ],
    }).compile();

    service = module.get(ArcaParamCacheService);
  });

  it('fetches salesPoints and caches result', async () => {
    const result1 = await service.get('salesPoints', 'tenant-1', 'issuer-1', '20-12345678-9');
    const result2 = await service.get('salesPoints', 'tenant-1', 'issuer-1', '20-12345678-9');

    expect(result1).toEqual([{ Nro: 1, EmisionTipo: 'Web Services' }]);
    expect(result2).toEqual(result1);
    expect(mockGetSalesPoints).toHaveBeenCalledTimes(1); // cached on second call
  });

  it('scopes cache per (tenantId, issuerCuit)', async () => {
    await service.get('salesPoints', 'tenant-1', 'issuer-1', 'cuit-A');
    await service.get('salesPoints', 'tenant-1', 'issuer-2', 'cuit-B');

    expect(mockGetSalesPoints).toHaveBeenCalledTimes(2);
  });

  it('force=true bypasses cache', async () => {
    await service.get('salesPoints', 'tenant-1', 'issuer-1', '20-12345678-9');
    await service.get('salesPoints', 'tenant-1', 'issuer-1', '20-12345678-9', true);

    expect(mockGetSalesPoints).toHaveBeenCalledTimes(2);
  });

  it('invalidate removes specific entry', async () => {
    await service.get('salesPoints', 'tenant-1', 'issuer-1', 'cuit-1');
    service.invalidate('salesPoints', 'tenant-1', 'cuit-1');
    await service.get('salesPoints', 'tenant-1', 'issuer-1', 'cuit-1');

    expect(mockGetSalesPoints).toHaveBeenCalledTimes(2);
  });

  it('invalidateAll clears all entries for a tenant', async () => {
    await service.get('salesPoints', 'tenant-1', 'issuer-1', 'cuit-A');
    await service.get('voucherTypes', 'tenant-1', 'issuer-1', 'cuit-A');
    await service.get('salesPoints', 'tenant-2', 'issuer-2', 'cuit-B');

    service.invalidateAll('tenant-1');

    // Re-fetch tenant-1 entries
    await service.get('salesPoints', 'tenant-1', 'issuer-1', 'cuit-A');
    await service.get('voucherTypes', 'tenant-1', 'issuer-1', 'cuit-A');

    // tenant-1 salesPoints fetched twice (initial + after invalidation)
    expect(mockGetSalesPoints).toHaveBeenCalledTimes(3); // tenant-2 + 2x tenant-1
    expect(mockGetVoucherTypes).toHaveBeenCalledTimes(2); // initial + after invalidation
  });

  it('fetches condicionIvaReceptor and caches result', async () => {
    const result = await service.get('condicionIvaReceptor', 'tenant-1', 'issuer-1', 'cuit-1');

    expect(result).toEqual([{ Id: 5, Desc: 'Consumidor Final' }]);
    expect(mockGetCondicionIvaReceptor).toHaveBeenCalledTimes(1);

    // Second call should be cached
    await service.get('condicionIvaReceptor', 'tenant-1', 'issuer-1', 'cuit-1');
    expect(mockGetCondicionIvaReceptor).toHaveBeenCalledTimes(1);
  });

  it('throws on unknown param type', async () => {
    await expect(
      service.get('unknown' as any, 'tenant-1', 'issuer-1', 'cuit-1'),
    ).rejects.toThrow('Unknown param type');
  });
});
