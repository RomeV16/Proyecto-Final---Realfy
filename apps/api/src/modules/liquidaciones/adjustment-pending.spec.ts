import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  ADJUSTMENT_PENDING,
  adjustmentHorizon,
  isEditableStatus,
  lastInstantOfMonth,
  pendingAdjustmentWarning,
} from './adjustment-pending';
import { LiquidacionesService } from './liquidaciones.service';

jest.mock('./pdf.service', () => ({ PdfService: jest.fn() }));

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('adjustment-pending (DEF-132)', () => {
  it('solo Borrador y Revisión son editables', () => {
    expect(['Borrador', 'Revision'].map(isEditableStatus)).toEqual([true, true]);
    expect(['Aprobada', 'Enviada', 'Pagada', 'Vencida', 'Anulada'].some(isEditableStatus)).toBe(false);
  });

  it('el horizonte es el día 1 con DesdePeriodoSiguiente y el fin del mes con las otras convenciones', () => {
    expect(lastInstantOfMonth(d('2026-02-01')).toISOString()).toBe('2026-02-28T23:59:59.999Z');
    expect(adjustmentHorizon(d('2026-12-01'), 'DesdePeriodoSiguiente')).toEqual(d('2026-12-01'));
    expect(adjustmentHorizon(d('2026-12-01'), 'Prorrateado').toISOString()).toBe('2026-12-31T23:59:59.999Z');
    expect(adjustmentHorizon(d('2026-12-01'), 'DesdeEsePeriodo').toISOString()).toBe('2026-12-31T23:59:59.999Z');
  });

  it('toma el ajuste pendiente más antiguo del contrato hasta el horizonte', () => {
    const schedules = [
      { id: 's-0', contractId: 'otro', nextAdjustmentDate: d('2026-09-01') },
      { id: 's-1', contractId: 'c-1', nextAdjustmentDate: d('2026-11-01') },
      { id: 's-2', contractId: 'c-1', nextAdjustmentDate: d('2026-12-15') },
    ];
    expect(pendingAdjustmentWarning(schedules, 'c-1', d('2026-12-01'))).toEqual({
      code: ADJUSTMENT_PENDING,
      adjustmentDate: '2026-11-01',
      scheduleId: 's-1',
    });
    expect(pendingAdjustmentWarning(schedules, 'c-1', d('2026-10-31'))).toBeNull();
    expect(pendingAdjustmentWarning(schedules, 'c-2', d('2027-01-01'))).toBeNull();
  });
});

describe('LiquidacionesService: advertencia ADJUSTMENT_PENDING (DEF-132)', () => {
  function build(opts: { schedules?: any[]; versions?: any[]; liq?: any; mode?: string } = {}) {
    const client: any = {
      adjustmentSchedule: { findMany: jest.fn().mockResolvedValue(opts.schedules ?? []) },
      contractTermsVersion: { findMany: jest.fn().mockResolvedValue(opts.versions ?? []) },
      liquidacion: {
        findFirst: jest.fn().mockResolvedValue(opts.liq ?? null),
        update: jest.fn(),
      },
    };
    client.$transaction = jest.fn((fn: any) => fn(client));
    const defaults = {
      get: jest.fn().mockResolvedValue({ midMonthAdjustmentMode: opts.mode ?? 'DesdePeriodoSiguiente' }),
    };
    const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() };
    const service = new LiquidacionesService(
      { client } as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      {} as any,
      {} as any,
      defaults as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, client, defaults };
  }

  const row = (contractId: string, period: string, status = 'Borrador') => ({
    contractId,
    period: d(period),
    status,
  });

  it('sin liquidaciones editables no consulta nada', async () => {
    const { service, client } = build();
    expect(await service.warningsFor([row('c-1', '2026-12-01', 'Aprobada')])).toEqual([[]]);
    expect(client.adjustmentSchedule.findMany).not.toHaveBeenCalled();
  });

  it('busca los pendientes y calculados de contratos activos hasta el fin del último mes', async () => {
    const { service, client, defaults } = build();
    const result = await service.warningsFor([row('c-1', '2026-12-01'), row('c-2', '2027-01-01', 'Revision')]);
    expect(result).toEqual([[], []]);
    expect(client.adjustmentSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contractId: { in: ['c-1', 'c-2'] },
          status: { in: ['Pending', 'Calculated'] },
          nextAdjustmentDate: { lte: new Date('2027-01-31T23:59:59.999Z') },
          contract: { status: 'Activo', isActive: true },
        },
      }),
    );
    // Sin pendientes no hace falta leer las convenciones.
    expect(defaults.get).not.toHaveBeenCalled();
  });

  it('la convención del contrato vigente en el período decide si un ajuste a mitad de mes bloquea', async () => {
    const schedules = [{ id: 's-1', contractId: 'c-1', nextAdjustmentDate: d('2026-12-15') }];
    const versions = [
      { contractId: 'c-1', validFrom: d('2026-09-15'), midMonthAdjustmentMode: 'DesdePeriodoSiguiente' },
      { contractId: 'c-1', validFrom: d('2027-02-01'), midMonthAdjustmentMode: 'Prorrateado' },
    ];
    const { service } = build({ schedules, versions });
    const result = await service.warningsFor([
      row('c-1', '2026-12-01'),
      row('c-1', '2027-01-01'),
      row('c-1', '2027-01-01', 'Enviada'),
    ]);
    expect(result).toEqual([
      [],
      [{ code: ADJUSTMENT_PENDING, adjustmentDate: '2026-12-15', scheduleId: 's-1' }],
      [],
    ]);
  });

  it('sin versión de reglas rige la convención de la inmobiliaria', async () => {
    const schedules = [{ id: 's-1', contractId: 'c-1', nextAdjustmentDate: d('2026-12-15') }];
    const { service } = build({ schedules, mode: 'Prorrateado' });
    expect(await service.warningsFor([row('c-1', '2026-12-01')])).toEqual([
      [{ code: ADJUSTMENT_PENDING, adjustmentDate: '2026-12-15', scheduleId: 's-1' }],
    ]);
  });

  it('no aprueba una liquidación con un ajuste pendiente y no toca la fila', async () => {
    const schedules = [{ id: 's-1', contractId: 'c-1', nextAdjustmentDate: d('2026-12-01') }];
    const liq = { id: 'liq-1', ...row('c-1', '2026-12-01', 'Revision'), lineItems: [], payments: [], receiptSeq: null };
    const { service, client } = build({ schedules, liq });
    await expect(service.transition('liq-1', { status: 'Aprobada' })).rejects.toMatchObject({
      response: { error: ADJUSTMENT_PENDING, adjustmentDate: '2026-12-01', scheduleId: 's-1' },
    });
    expect(client.liquidacion.update).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
