import { Test } from '@nestjs/testing';
import { ArcaTaManager } from './arca-ta.manager';
import { WsaaService } from './wsaa/wsaa.service';

const MOCK_TA = {
  token: 'test-token',
  sign: 'test-sign',
  expirationTime: new Date(Date.now() + 10 * 60 * 60 * 1000),
};

describe('ArcaTaManager', () => {
  let manager: ArcaTaManager;
  let wsaaMock: any;

  beforeEach(async () => {
    wsaaMock = {
      getTa: jest.fn().mockResolvedValue(MOCK_TA),
    };

    const module = await Test.createTestingModule({
      providers: [
        ArcaTaManager,
        { provide: WsaaService, useValue: wsaaMock },
      ],
    }).compile();

    manager = module.get(ArcaTaManager);
  });

  afterEach(() => jest.clearAllMocks());

  it('delegates to WsaaService.getTa with tenantId and wsfe service', async () => {
    await manager.ensureTA('tenant-1', 'issuer-1', 'actor');

    expect(wsaaMock.getTa).toHaveBeenCalledWith('tenant-1', 'wsfe');
  });

  it('calling ensureTA for two different issuerIds both call WsaaService', async () => {
    await manager.ensureTA('tenant-1', 'issuer-1', 'actor');
    await manager.ensureTA('tenant-1', 'issuer-2', 'actor');

    // Both resolve — TA caching is handled by WsaaService, not here
    expect(wsaaMock.getTa).toHaveBeenCalledTimes(2);
  });

  it('resolves without error when WsaaService succeeds', async () => {
    await expect(
      manager.ensureTA('tenant-1', 'issuer-1', 'actor'),
    ).resolves.toBeUndefined();
  });

  it('propagates WsaaService errors', async () => {
    wsaaMock.getTa.mockRejectedValueOnce(new Error('WSAA offline'));

    await expect(
      manager.ensureTA('tenant-1', 'issuer-1', 'actor'),
    ).rejects.toThrow('WSAA offline');
  });
});
