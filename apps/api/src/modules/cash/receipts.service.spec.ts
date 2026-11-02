import { ReceiptsService, receiptLabel } from './receipts.service';

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

const receipt = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  series: 'RECIBO_COBRO',
  number: 12,
  issuedAt: D('2026-01-08'),
  amount: { toString: () => '100000' },
  currency: 'ARS',
  payment: {
    id: 'pay-1',
    method: 'Efectivo',
    receivedBy: 'Inmobiliaria',
    inCustody: true,
    reference: 'REF-1',
    account: { id: 'acc', name: 'Caja ARS', kind: 'Caja' },
    receivedByUser: { firstName: 'Ana', lastName: 'Cajera' },
    liquidacion: {
      id: 'liq-1',
      period: D('2026-01-01'),
      contractId: 'c1',
      contract: {
        id: 'c1',
        property: { title: 'Unidad sintética' },
        persons: [{ role: 'Inquilino', person: { firstName: 'Ines', lastName: 'Inquilina' } }],
        lessors: [{ validFrom: D('2025-01-01'), validTo: null, person: { firstName: 'Beto', lastName: 'Locador' } }],
      },
    },
  },
  ...over,
});

function build(rows: any[] = [receipt()]) {
  const client: any = {
    receipt: {
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
      findFirst: jest.fn(async () => rows[0] ?? null),
    },
    tenant: { findFirst: jest.fn(async () => ({ name: 'Inmobiliaria Ficticia', cuit: '30-00000000-1' })) },
  };
  const renderer = { render: jest.fn(async () => Buffer.from('%PDF')) };
  const service = new ReceiptsService({ client } as any, { getTenantId: () => 't1' } as any, renderer as any);
  return { service, client, renderer };
}

describe('receiptLabel', () => {
  it('la serie única muestra el número; por moneda antepone la moneda y por cuenta el nombre', () => {
    expect(receiptLabel('RECIBO_COBRO', 7)).toBe('00000007');
    expect(receiptLabel('RECIBO_COBRO_USD', 7)).toBe('USD-00000007');
    expect(receiptLabel('RECIBO_COBRO_6b0f', 7, 'Caja oficina')).toBe('Caja oficina-00000007');
    expect(receiptLabel('RECIBO_COBRO_6b0f', 7)).toBe('6b0f-00000007');
  });
});

describe('ReceiptsService', () => {
  it('lista con número, inquilino, propiedad y quién recibió; filtra por fechas y contrato', async () => {
    const { service, client } = build();
    const res = await service.list({ from: '2026-01-01', to: '2026-01-31', contractId: '00000000-0000-4000-8000-000000000001' });
    expect(res.items[0]).toMatchObject({
      number: '00000012',
      tenantName: 'Ines Inquilina',
      property: 'Unidad sintética',
      receivedByName: 'Ana Cajera',
      inCustody: true,
      liquidacionId: 'liq-1',
    });
    expect(client.receipt.findMany.mock.calls[0][0].where).toEqual({
      issuedAt: { gte: D('2026-01-01'), lt: D('2026-02-01') },
      payment: { liquidacion: { contractId: '00000000-0000-4000-8000-000000000001' } },
    });
  });

  it('el PDF lleva el número del recibo, el monto en letras y la custodia', async () => {
    const { service, renderer } = build();
    const { buffer, filename } = await service.pdf('rec-1');
    expect(buffer.toString()).toBe('%PDF');
    expect(filename).toBe('recibo-00000012.pdf');
    const doc = JSON.stringify((renderer.render.mock.calls as any[])[0][0].content);
    expect(doc).toContain('RECIBO DE COBRO Nº 00000012');
    expect(doc).toContain('Cien mil pesos');
    expect(doc).toContain('Caja ARS — Ana Cajera');
    expect(doc).toContain('Beto Locador');
    expect(doc).toContain('custodia');
  });

  it('un cobro del locador lo dice en el recibo', async () => {
    const base = receipt();
    const row = { ...base, payment: { ...base.payment, receivedBy: 'Locador', inCustody: false, reference: null } };
    const { service, renderer } = build([row]);
    await service.pdf('rec-1');
    expect(JSON.stringify((renderer.render.mock.calls as any[])[0][0].content)).toContain('El locador, directamente');
  });

  it('un recibo inexistente es 404', async () => {
    await expect(build([]).service.pdf('x')).rejects.toMatchObject({ response: { error: 'RECEIPT_NOT_FOUND' } });
  });
});
