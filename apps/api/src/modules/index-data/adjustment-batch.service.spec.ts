import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ScheduleStatus } from '@realfy/shared';
import { AdjustmentBatchService } from './adjustment-batch.service';

const TENANT_ID = 'tenant-1';

const due = (contractId: string, periodNumber = 1) => ({
  id: `sch-${contractId}`,
  contractId,
  periodNumber,
  status: ScheduleStatus.Pending,
  nextAdjustmentDate: new Date('2026-10-01T00:00:00.000Z'),
  contract: { id: contractId, tenantId: TENANT_ID },
});

const applied = (contractId: string) => ({
  contractId,
  status: 'applied',
  previousRent: '100000.00',
  newRent: '110000.00',
  estimatedPeriods: [],
});

const uniqueViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

function build(schedules: ReturnType<typeof due>[], applySchedule: jest.Mock) {
  const prisma = {
    client: {
      adjustmentSchedule: { findMany: jest.fn().mockResolvedValue(schedules) },
      contract: { findFirst: jest.fn().mockResolvedValue(null) },
    },
  };
  const adjustments = {
    applySchedule,
    isProvisionalAllowed: jest.fn().mockResolvedValue(true),
    skipReason: jest.fn((err: any) => err?.getResponse?.()?.error ?? 'ADJUSTMENT_FAILED'),
  };
  const tenantContext = { getTenantId: () => TENANT_ID, getUserId: () => 'user-1' };
  return new AdjustmentBatchService(prisma as any, tenantContext as any, adjustments as any);
}

describe('AdjustmentBatchService.apply', () => {
  it('DEF-136: un error no HTTP en un contrato no corta el lote ni oculta lo ya aplicado', async () => {
    const applySchedule = jest
      .fn()
      .mockResolvedValueOnce(applied('a'))
      .mockRejectedValueOnce(uniqueViolation())
      .mockResolvedValueOnce(applied('c'));
    const service = build([due('a'), due('b'), due('c')], applySchedule);

    const res = await service.apply('2026-10', ['a', 'b', 'c']);

    expect(res.results.map((r) => [r.contractId, r.result])).toEqual([
      ['a', 'applied'],
      ['b', 'error'],
      ['c', 'applied'],
    ]);
    expect(res.results[1].reason).toBe('CONFLICT');
  });

  it('DEF-136: un error desconocido se informa con un código genérico', async () => {
    const applySchedule = jest.fn().mockRejectedValueOnce(new Error('boom'));
    const service = build([due('a')], applySchedule);

    const res = await service.apply('2026-10', ['a']);

    expect(res.results).toHaveLength(1);
    expect(res.results[0]).toMatchObject({ contractId: 'a', result: 'error', reason: 'ADJUSTMENT_FAILED' });
  });

  it('un error HTTP de la modalidad sigue siendo un contrato salteado con su código', async () => {
    const applySchedule = jest
      .fn()
      .mockRejectedValueOnce(new ConflictException({ error: 'MISSING_ADJUSTMENT_PCT', message: 'x' }));
    const service = build([due('a')], applySchedule);

    const res = await service.apply('2026-10', ['a']);

    expect(res.results[0]).toMatchObject({ result: 'skipped', reason: 'MISSING_ADJUSTMENT_PCT' });
  });
});
