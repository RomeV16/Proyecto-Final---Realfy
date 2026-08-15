import { Test } from '@nestjs/testing';
import { ArcaRequestLogService } from './arca-request-log.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

describe('ArcaRequestLogService', () => {
  let service: ArcaRequestLogService;
  let prismaMock: any;
  let createLogMock: jest.Mock;

  beforeEach(async () => {
    createLogMock = jest.fn().mockResolvedValue({ id: 'log-1' });

    prismaMock = {
      client: {
        arcaRequestLog: {
          create: createLogMock,
          update: jest.fn().mockResolvedValue({}),
        },
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ArcaRequestLogService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(ArcaRequestLogService);
  });

  it('records success log and returns result', async () => {
    const result = await service.wrap(
      { tenantId: 'tenant-1', operation: 'emit', issuerCuit: '20-123' },
      async () => ({ CAE: 'abc123', CAEFchVto: '2026-12-31' }),
    );

    expect(result).toEqual({ CAE: 'abc123', CAEFchVto: '2026-12-31' });
    expect(createLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          operation: 'emit',
          success: true,
        }),
      }),
    );
  });

  it('records failure log and rethrows', async () => {
    const err = Object.assign(new Error('AFIP down'), { code: 'NET_ERR' });

    await expect(
      service.wrap({ tenantId: 'tenant-1', operation: 'emit' }, async () => {
        throw err;
      }),
    ).rejects.toThrow('AFIP down');

    expect(createLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          errorCode: 'NET_ERR',
          errorMessage: 'AFIP down',
        }),
      }),
    );
  });

  it('scrubs Token and Sign from requestPayload', async () => {
    await service.wrap(
      {
        tenantId: 'tenant-1',
        operation: 'emit',
        requestPayload: {
          Auth: { Token: 'my-secret-token', Sign: 'my-secret-sign', Cuit: '20-123' },
          Data: { Amount: 100 },
        },
      },
      async () => 'ok',
    );

    const logData = createLogMock.mock.calls[0][0].data;
    expect(logData.requestPayload.Auth.Token).toBe('[REDACTED]');
    expect(logData.requestPayload.Auth.Sign).toBe('[REDACTED]');
    expect(logData.requestPayload.Auth.Cuit).toBe('20-123');
  });

  it('scrubs Token and Sign from responsePayload', async () => {
    await service.wrap(
      { tenantId: 'tenant-1', operation: 'emit' },
      async () => ({
        Token: 'secret',
        Sign: 'sig',
        CAE: '123456789012',
      }),
    );

    const logData = createLogMock.mock.calls[0][0].data;
    expect(logData.responsePayload.Token).toBe('[REDACTED]');
    expect(logData.responsePayload.Sign).toBe('[REDACTED]');
    expect(logData.responsePayload.CAE).toBe('123456789012');
  });

  it('records latency in milliseconds', async () => {
    await service.wrap(
      { tenantId: 'tenant-1', operation: 'emit' },
      async () => 'done',
    );

    const latency = createLogMock.mock.calls[0][0].data.latencyMs;
    expect(typeof latency).toBe('number');
    expect(latency).toBeGreaterThanOrEqual(0);
  });

  it('log DB failure is non-fatal', async () => {
    createLogMock.mockRejectedValueOnce(new Error('DB error'));

    const result = await service.wrap(
      { tenantId: 'tenant-1', operation: 'test' },
      async () => 'success',
    );

    expect(result).toBe('success');
  });

  it('includes comprobanteId in log when provided', async () => {
    await service.wrap(
      { tenantId: 'tenant-1', operation: 'emit', comprobanteId: 'comp-42' },
      async () => 'ok',
    );

    expect(createLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comprobanteId: 'comp-42' }),
      }),
    );
  });
});
