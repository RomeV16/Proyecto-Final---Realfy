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

  it('un período fuera del contrato se saltea', async () => {
    const draft = { id: 'liq', period: d('2028-10-01'), currency: 'ARS', total: '1', lineItems: [] };
    const ended = { ...contract([decAdjustment]), status: 'Finalizado', actualEndDate: d('2028-08-31') };
    const { service, client } = build([draft], ended);
    expect(await service.refreshDraftsAfterAdjustment(event)).toBe(0);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
