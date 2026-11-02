import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from './liquidaciones.service';

/**
 * DEF-29 (CP-450): los cobros de una liquidación devuelven el recibo con su
 * número entero y la serie, y cada pantalla rearmaba el número impreso; la lista
 * de recibos (`/receipts`) ya lo devuelve armado. Un cobro tiene que traer la
 * misma etiqueta que el recibo impreso.
 */
const payment = (id: string, receipt: Record<string, unknown> | null, account: Record<string, unknown> | null) => ({
  id,
  amount: '1000.00',
  receipt,
  account,
  compensations: [],
});

const PAYMENTS = [
  payment('p1', { id: 'r1', series: 'RECIBO_COBRO', number: 41 }, { id: 'a1', name: 'Caja ARS' }),
  payment('p2', { id: 'r2', series: 'RECIBO_COBRO_USD', number: 7 }, { id: 'a2', name: 'Banco USD' }),
  payment('p3', { id: 'r3', series: 'RECIBO_COBRO_acc-9', number: 3 }, { id: 'acc-9', name: 'Caja chica' }),
  payment('p4', null, null),
];

function build() {
  const client: any = {
    liquidacion: {
      findFirst: jest.fn().mockResolvedValue({ id: 'liq-1', receiptSeq: null, payments: PAYMENTS, lineItems: [] }),
    },
    payment: { findMany: jest.fn().mockResolvedValue(PAYMENTS) },
  };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() };
  const none = {} as any;
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
  );
  return service;
}

describe('DEF-29 — etiqueta del recibo en los cobros (CP-450)', () => {
  const expected = [['p1', '00000041'], ['p2', 'USD-00000007'], ['p3', 'Caja chica-00000003'], ['p4', null]];

  it('los cobros de una liquidación traen el número del recibo como se imprime', async () => {
    const rows: any[] = await build().findPayments('liq-1');
    expect(rows.map((p) => [p.id, p.receipt?.label ?? null])).toEqual(expected);
  });

  it('el detalle de la liquidación también', async () => {
    const detail: any = await build().findOne('liq-1');
    expect(detail.payments.map((p: any) => [p.id, p.receipt?.label ?? null])).toEqual(expected);
  });
});
