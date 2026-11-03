import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from './liquidaciones.service';

jest.mock('./pdf.service', () => ({ PdfService: jest.fn() }));

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const line = (id: string, type: string, amount: string, sourceType: string | null = null, sortOrder = 0) => ({
  id,
  type,
  amount,
  description: `${type} ${id}`,
  sourceType,
  sortOrder,
});

function contract(adjustments: any[] = []) {
  return {
    id: 'c-1',
    rentAmount: '105060',
    rentCurrency: 'ARS',
    status: 'Activo',
    startDate: d('2026-09-01'),
    endDate: d('2028-08-31'),
    actualEndDate: null,
    termsVersions: [{ validFrom: d('2026-09-01'), discountPct: '10.00', discountAmount: null }],
    lessors: [],
    adjustments,
  };
}

const decAdjustment = {
  adjustmentDate: d('2026-12-01'),
  previousAmount: '100000',
  newAmount: '105060',
  isProvisional: false,
};

function build(drafts: any[], found: any = contract([decAdjustment])) {
  const tx: any = {
    liquidacionLineItem: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([
        { type: 'Alquiler', amount: '105060' },
        { type: 'Descuento', amount: '10506' },
        { type: 'Cargo', amount: '5000' },
      ]),
    },
    liquidacion: { update: jest.fn().mockResolvedValue({ total: '99554.00' }) },
  };
  const client: any = {
    liquidacion: { findMany: jest.fn().mockResolvedValue(drafts) },
    contract: { findFirst: jest.fn().mockResolvedValue(found) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const audit = { record: jest.fn() };
  const adjustments = { onApplied: jest.fn() };
  const defaults = {
    get: jest.fn().mockResolvedValue({
      dueDay: 10,
      prorationMode: 'DiasReales',
      midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
      firstDueMode: 'DiaDeInicio',
      fixedDiscountProration: 'Proporcional',
    }),
  };
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    { getTenantId: () => 'tenant-1', getUserId: jest.fn() } as unknown as TenantContextService,
    {} as any,
    {} as any,
    defaults as any,
    audit as any,
    adjustments as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { service, client, tx, audit, adjustments };
}

const event = {
  tenantId: 'tenant-1',
  contractId: 'c-1',
  adjustmentId: 'adj-1',
  adjustmentDate: d('2026-12-01'),
};

describe('LiquidacionesService: recálculo de borradores tras un ajuste (DEF-133)', () => {
  it('se registra para escuchar los ajustes aplicados', () => {
    const { service, adjustments } = build([]);
    service.onModuleInit();
    expect(adjustments.onApplied).toHaveBeenCalledWith(expect.any(Function));
  });

  it('CP-1266 — rehace alquiler y bonificación, conserva lo demás después y audita', async () => {
    const draft = {
      id: 'liq-dec',
      period: d('2026-12-01'),
      currency: 'ARS',
      total: '95000.00',
      isProvisional: false,
      lineItems: [
        line('rent', 'Alquiler', '100000', null, 0),
        line('disc', 'Descuento', '10000', 'ContractTermsVersion', 1),
        line('manual', 'Cargo', '5000', null, 2),
      ],
    };
    const { service, client, tx, audit } = build([draft]);

    expect(await service.refreshDraftsAfterAdjustment(event)).toBe(1);

    expect(client.liquidacion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contractId: 'c-1', period: { gte: d('2026-12-01') }, status: { in: ['Borrador', 'Revision'] } },
      }),
    );
    expect(tx.liquidacionLineItem.deleteMany).toHaveBeenCalledWith({
      where: { liquidacionId: 'liq-dec', id: { in: ['rent', 'disc'] } },
    });
    const created = tx.liquidacionLineItem.createMany.mock.calls[0][0].data;
    expect(created.map((l: any) => [l.type, l.amount, l.sortOrder])).toEqual([
      ['Alquiler', '105060.00', 0],
      ['Descuento', '10506.00', 1],
    ]);
    expect(tx.liquidacionLineItem.update).toHaveBeenCalledWith({ where: { id: 'manual' }, data: { sortOrder: 2 } });
    expect(tx.liquidacion.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'liq-dec' }, data: expect.objectContaining({ isProvisional: false }) }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entity: 'Liquidacion',
        entityId: 'liq-dec',
        before: { total: '95000.00' },
        metadata: expect.objectContaining({ operation: 'refresh-after-adjustment', adjustmentDate: '2026-12-01' }),
      }),
    );
  });

  it('un borrador que ya tiene el alquiler que rige no se toca', async () => {
    const draft = {
      id: 'liq-dec',
      period: d('2026-12-01'),
      currency: 'ARS',
      total: '94554.00',
      isProvisional: false,
      lineItems: [
        line('rent', 'Alquiler', '105060', null, 0),
        line('disc', 'Descuento', '10506', 'ContractTermsVersion', 1),
      ],
    };
    const { service, client } = build([draft]);
    expect(await service.refreshDraftsAfterAdjustment(event)).toBe(0);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('sin borradores desde el mes del ajuste, o sin contrato, no hace nada', async () => {
    const none = build([]);
    expect(await none.service.refreshDraftsAfterAdjustment(event)).toBe(0);
    expect(none.client.contract.findFirst).not.toHaveBeenCalled();

    const draft = { id: 'liq', period: d('2026-12-01'), lineItems: [] };
    const gone = build([draft], null);
    expect(await gone.service.refreshDraftsAfterAdjustment(event)).toBe(0);
    expect(gone.client.$transaction).not.toHaveBeenCalled();
  });

  it('el aviso de un ajuste recalcula los borradores y después cobra la diferencia de los meses emitidos', async () => {
    const { service, adjustments } = build([]);
    const refresh = jest.spyOn(service, 'refreshDraftsAfterAdjustment').mockResolvedValue(0);
    const late = jest.spyOn(service, 'chargeLateAdjustment').mockResolvedValue(0);
    service.onModuleInit();
    await adjustments.onApplied.mock.calls[0][0](event);
    expect(refresh).toHaveBeenCalledWith(event);
    expect(late).toHaveBeenCalledWith(event);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(late.mock.invocationCallOrder[0]);
  });

  it('un período fuera del contrato se saltea', async () => {
    const draft = { id: 'liq', period: d('2028-10-01'), currency: 'ARS', total: '1', lineItems: [] };
    const ended = { ...contract([decAdjustment]), status: 'Finalizado', actualEndDate: d('2028-08-31') };
    const { service, client } = build([draft], ended);
    expect(await service.refreshDraftsAfterAdjustment(event)).toBe(0);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe('LiquidacionesService: diferencia de un ajuste aplicado después de emitir el mes (DEF-134)', () => {
  const applied = { id: 'adj-1', ...decAdjustment };

  function buildLate(opts: { emitted?: any[]; found?: any; mode?: string } = {}) {
    const client: any = {
      liquidacion: { findMany: jest.fn().mockResolvedValue(opts.emitted ?? [{ id: 'liq-dec', period: d('2026-12-01') }]) },
      contract: {
        findFirst: jest.fn().mockResolvedValue(
          'found' in opts ? opts.found : { ...contract([applied]), propertyId: 'p-1' },
        ),
      },
    };
    const charges = { recordAdjustmentDifference: jest.fn().mockResolvedValue('charge-1') };
    const defaults = {
      get: jest.fn().mockResolvedValue({
        dueDay: 10,
        prorationMode: 'DiasReales',
        midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
        firstDueMode: 'DiaDeInicio',
        fixedDiscountProration: 'Proporcional',
        lateAdjustmentBilling: opts.mode ?? 'Retroactivo',
      }),
    };
    const service = new LiquidacionesService(
      { client } as unknown as PrismaService,
      { getTenantId: () => 'tenant-1', getUserId: jest.fn() } as unknown as TenantContextService,
      {} as any,
      {} as any,
      defaults as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      charges as any,
      {} as any,
    );
    return { service, client, charges };
  }

  it('CP-1269 — cobra en un cargo la diferencia neta de bonificaciones de cada mes emitido desde el ajuste', async () => {
    const { service, client, charges } = buildLate();
    expect(await service.chargeLateAdjustment(event)).toBe(1);
    expect(client.liquidacion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contractId: 'c-1',
          period: { gte: d('2026-12-01') },
          status: { notIn: ['Borrador', 'Revision', 'Anulada'] },
        },
      }),
    );
    // 105.060 − 10 % = 94.554 contra 100.000 − 10 % = 90.000.
    expect(charges.recordAdjustmentDifference).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      contract: expect.objectContaining({ id: 'c-1', propertyId: 'p-1' }),
      adjustmentId: 'adj-1',
      description: 'diferencia del ajuste del 01/12/2026 no incluida en la liquidación de 2026-12',
      amount: '4554.00',
    });
  });

  it('CP-1270 — con SinRetroactivo no deja cargos', async () => {
    const { service, charges } = buildLate({ mode: 'SinRetroactivo' });
    expect(await service.chargeLateAdjustment(event)).toBe(0);
    expect(charges.recordAdjustmentDifference).not.toHaveBeenCalled();
  });

  it('sin meses emitidos, sin contrato o sin el ajuste no hace nada; un mes sin diferencia o ya cargado no suma', async () => {
    const none = buildLate({ emitted: [] });
    expect(await none.service.chargeLateAdjustment(event)).toBe(0);
    expect(none.client.contract.findFirst).not.toHaveBeenCalled();

    const gone = buildLate({ found: null });
    expect(await gone.service.chargeLateAdjustment(event)).toBe(0);

    const other = buildLate({ found: { ...contract([{ id: 'otro', ...decAdjustment }]), propertyId: 'p-1' } });
    expect(await other.service.chargeLateAdjustment(event)).toBe(0);
    expect(other.charges.recordAdjustmentDifference).not.toHaveBeenCalled();

    // Noviembre (antes del ajuste) no cambia; diciembre ya tenía su cargo.
    const repeated = buildLate({
      emitted: [
        { id: 'liq-nov', period: d('2026-11-01') },
        { id: 'liq-dec', period: d('2026-12-01') },
      ],
    });
    repeated.charges.recordAdjustmentDifference.mockResolvedValue(null);
    expect(await repeated.service.chargeLateAdjustment(event)).toBe(0);
    expect(repeated.charges.recordAdjustmentDifference).toHaveBeenCalledTimes(1);
  });
});
