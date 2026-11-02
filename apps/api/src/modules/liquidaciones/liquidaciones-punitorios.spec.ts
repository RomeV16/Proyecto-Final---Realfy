import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from './liquidaciones.service';
import { makeFakePenaltyDb } from '../penalties/penalties.testing';

jest.mock('./pdf.service', () => ({ PdfService: jest.fn() }));

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const fixed = { mode: 'daily_fixed', value: '10', graceDays: 0, maxMultiplier: '5.0' };

/**
 * Cobro con punitorios: `registerPayment` con `settlePenalties` agrega el
 * renglón Multa a la misma liquidación y el pago tiene que cubrir el total.
 */
function buildPayment(opts: { total?: string; payments?: any[]; penalties?: any[]; status?: string } = {}) {
  const db = makeFakePenaltyDb({
    liquidaciones: [{ id: 'liq-1', total: opts.total ?? '1000', dueDate: d('2026-03-10'), payments: opts.payments ?? [] }],
    penalties: opts.penalties,
    tenantConfig: fixed,
  });
  const lines: any[] = [{ id: 'li-1', type: 'Alquiler', amount: '1000.00', sortOrder: 0 }];
  const liquidacion: any = {
    id: 'liq-1',
    tenantId: 'tenant-1',
    contractId: 'contract-1',
    status: opts.status ?? 'Vencida',
    total: opts.total ?? '1000',
    currency: 'ARS',
    dueDate: d('2026-03-10'),
    payments: opts.payments ?? [],
  };
  const created: any[] = [];
  Object.assign(db.client, {
    liquidacion: {
      findFirst: jest.fn(async () => liquidacion),
      update: jest.fn(async ({ data }: any) => {
        Object.assign(liquidacion, data);
        return liquidacion;
      }),
    },
    liquidacionLineItem: {
      findFirst: jest.fn(async () => ({ sortOrder: lines.length - 1 })),
      create: jest.fn(async ({ data }: any) => {
        lines.push(data);
        return data;
      }),
      findMany: jest.fn(async () => lines),
    },
    payment: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'pay-1', ...data };
        created.push(row);
        return row;
      }),
    },
  });
  const service = new LiquidacionesService(
    { client: db.client } as unknown as PrismaService,
    { getTenantId: () => 'tenant-1', getUserId: () => 'user-1' } as unknown as TenantContextService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    db.service,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'liq-1', lineItems: lines } as any);
  return { ...db, service, lines, created, liquidacion };
}

const pay = (amount: string, extra: Record<string, unknown> = {}) => ({
  amount,
  method: 'Transferencia',
  paidAt: '2026-03-20',
  ...extra,
});

describe('registerPayment: cobro con punitorios', () => {
  it('agrega el renglón Multa, marca las filas y salda la liquidación', async () => {
    const { service, lines, penalties, created, liquidacion } = buildPayment();

    const result: any = await service.registerPayment('liq-1', pay('1100', { settlePenalties: true }));

    // 10 días de mora a 10 por día
    expect(lines[1]).toMatchObject({
      type: 'Multa',
      amount: '100.00',
      commissionable: true,
      beneficiary: 'Locador',
      sourceType: 'Penalty',
      sourceId: 'liq-1',
      sortOrder: 1,
    });
    expect(lines[1].description).toContain('20/03/2026');
    expect(penalties).toHaveLength(1);
    expect(penalties[0]).toMatchObject({ amount: '100.00', settledLiquidacionId: 'liq-1', status: 'active' });
    expect(liquidacion).toMatchObject({ total: '1100.00', status: 'Pagada' });
    expect(created[0].amount).toBe('1100');
    expect(result.penaltySettled).toEqual({ amount: '100.00', days: 10 });
  });

  it('un pago que no cubre el total con punitorios se rechaza y no deja nada a medias', async () => {
    const { service } = buildPayment();
    await expect(service.registerPayment('liq-1', pay('1000', { settlePenalties: true }))).rejects.toMatchObject({
      response: { error: 'PAYOFF_REQUIRES_FULL_AMOUNT', expectedAmount: '1100.00' },
    });
  });

  it('usa las filas ya registradas y descuenta lo condonado', async () => {
    const { service, lines, penalties } = buildPayment({
      penalties: [
        { amount: '30.00', status: 'waived' },
        { amount: '40.00', appliedOn: d('2026-03-15') },
      ],
    });
    // devengado a la fecha: 100; registrado: 70 (30 condonados + 40); falta 30 -> activas: 40 + 30 = 70
    const result: any = await service.registerPayment('liq-1', pay('1070', { settlePenalties: true }));
    expect(lines[1].amount).toBe('70.00');
    expect(penalties.filter((p) => p.status === 'active').every((p) => p.settledLiquidacionId === 'liq-1')).toBe(true);
    expect(result.penaltySettled.amount).toBe('70.00');
  });

  it('si no hay punitorio que cobrar, es un pago común', async () => {
    const { service, lines } = buildPayment();
    const result: any = await service.registerPayment('liq-1', pay('1000', { paidAt: '2026-03-09', settlePenalties: true }));
    expect(lines).toHaveLength(1);
    expect(result.penaltySettled).toBeUndefined();
  });

  it('sin la marca, un pago tardío que salda la liquidación fija el devengo hasta su fecha', async () => {
    const { service, penalties, lines } = buildPayment();
    await service.registerPayment('liq-1', pay('1000'));
    expect(lines).toHaveLength(1);
    expect(penalties).toHaveLength(1);
    expect(penalties[0]).toMatchObject({ amount: '100.00', settledLiquidacionId: null, appliedOn: d('2026-03-20') });
  });

  it('un pago en término o parcial no devenga nada', async () => {
    const onTime = buildPayment();
    await onTime.service.registerPayment('liq-1', pay('1000', { paidAt: '2026-03-10' }));
    expect(onTime.penalties).toHaveLength(0);

    const partial = buildPayment();
    await partial.service.registerPayment('liq-1', pay('400'));
    expect(partial.penalties).toHaveLength(0);
  });
});

describe('liberación de los punitorios cobrados', () => {
  function buildRelease(lineItem?: any, liq: any = { id: 'liq-1', status: 'Borrador' }) {
    const penalties = { release: jest.fn().mockResolvedValue(1) };
    const serviceBills = { release: jest.fn() };
    const tx: any = {
      liquidacion: { delete: jest.fn(), update: jest.fn() },
      liquidacionLineItem: { delete: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    };
    const client: any = {
      liquidacion: { findFirst: jest.fn().mockResolvedValue(liq), update: jest.fn() },
      liquidacionLineItem: {
        findFirst: jest.fn().mockResolvedValue(lineItem),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    tx.liquidacion.update = jest.fn().mockResolvedValue({});
    const service = new LiquidacionesService(
      { client } as unknown as PrismaService,
      { getTenantId: () => 'tenant-1', getUserId: () => 'user-1' } as unknown as TenantContextService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      serviceBills as any,
      penalties as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
    return { service, penalties, tx, client };
  }

  it('borrar un borrador libera sus punitorios', async () => {
    const { service, penalties, tx } = buildRelease();
    await service.remove('liq-1');
    expect(penalties.release).toHaveBeenCalledWith(tx, 'liq-1');
    expect(tx.liquidacion.delete).toHaveBeenCalled();
  });

  it('anular una liquidación emitida libera sus punitorios', async () => {
    const { service, penalties, tx } = buildRelease(undefined, { id: 'liq-1', status: 'Enviada' });
    await service.remove('liq-1');
    expect(penalties.release).toHaveBeenCalledWith(tx, 'liq-1');
  });

  it('quitar un renglón Multa libera los punitorios de su liquidación de origen', async () => {
    const { service, penalties, tx } = buildRelease({
      id: 'li-9',
      liquidacionId: 'liq-1',
      type: 'Multa',
      sourceType: 'Penalty',
      sourceId: 'liq-0',
    });
    await service.removeLineItem('li-9');
    expect(penalties.release).toHaveBeenCalledWith(tx, 'liq-1', 'liq-0');
  });

  it('quitar otro renglón no toca los punitorios', async () => {
    const { service, penalties } = buildRelease({ id: 'li-9', liquidacionId: 'liq-1', type: 'Extra', sourceType: null, sourceId: null });
    await service.removeLineItem('li-9');
    expect(penalties.release).not.toHaveBeenCalled();
  });
});
