import { PaymentsService } from './payments.service';

function build(total = 37) {
  const client = {
    payment: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(total),
      groupBy: jest.fn().mockResolvedValue([
        { currency: 'ARS', _sum: { amount: '19652215.64' }, _count: { _all: 36 } },
        { currency: 'USD', _sum: { amount: '500' }, _count: { _all: 1 } },
      ]),
    },
  };
  return { service: new PaymentsService({ client } as any), client };
}

describe('PaymentsService.list', () => {
  it('devuelve la cantidad y la suma de todos los cobros, no solo de la página', async () => {
    const { service } = build();

    const result = await service.list(1, 30);

    expect(result.total).toBe(37);
    expect(result.totalPages).toBe(2);
    expect(result.totals).toEqual([
      { currency: 'ARS', count: 36, amount: '19652215.64' },
      { currency: 'USD', count: 1, amount: '500.00' },
    ]);
  });

  it('una página o un tamaño que no son números válidos vuelven al valor por defecto', async () => {
    for (const [page, limit] of [[NaN, NaN], [0, 0], [-3, -1]]) {
      const { service, client } = build();
      const result = await service.list(page, limit);

      expect(client.payment.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 20 });
      expect(result).toMatchObject({ page: 1, limit: 20, totalPages: 2 });
    }
  });

  it('el tamaño de página tiene tope', async () => {
    const { service, client } = build();
    await service.list(2, 5000);

    expect(client.payment.findMany.mock.calls[0][0]).toMatchObject({ skip: 200, take: 200 });
  });
});
