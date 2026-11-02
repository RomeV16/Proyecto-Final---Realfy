import {
  CashMovementsController,
  CompensationsController,
  CustodyController,
  FinancialAccountsController,
  ReceiptsController,
} from './cash.controller';

describe('controladores de caja', () => {
  const cash = {
    listAccounts: jest.fn(async () => 'accounts'),
    createAccount: jest.fn(async () => 'created'),
    updateAccount: jest.fn(async () => 'updated'),
    listMovements: jest.fn(async () => 'movements'),
    createMovement: jest.fn(async () => 'movement'),
    createConversion: jest.fn(async () => 'conversion'),
    deliverCustody: jest.fn(async () => 'delivered'),
  };

  it('delegan en el servicio con los parámetros del pedido', async () => {
    const accounts = new FinancialAccountsController(cash as any);
    expect(await accounts.list({ kind: 'Caja' })).toBe('accounts');
    expect(await accounts.create({ a: 1 })).toBe('created');
    expect(await accounts.update('id-1', { name: 'x' })).toBe('updated');
    expect(cash.updateAccount).toHaveBeenCalledWith('id-1', { name: 'x' });

    const movements = new CashMovementsController(cash as any);
    expect(await movements.list({})).toBe('movements');
    expect(await movements.create({})).toBe('movement');
    expect(await movements.conversion({})).toBe('conversion');

    expect(await new CustodyController(cash as any).deliver('acc', { date: '2026-01-01' })).toBe('delivered');
    expect(cash.deliverCustody).toHaveBeenCalledWith('acc', { date: '2026-01-01' });

    const compensations = { list: jest.fn(async () => []), create: jest.fn(async () => 'comp') };
    const comp = new CompensationsController(compensations as any);
    await comp.list('pay', undefined);
    expect(compensations.list).toHaveBeenCalledWith({ paymentId: 'pay', personId: undefined });
    expect(await comp.create({})).toBe('comp');
  });

  it('el recibo se devuelve como PDF en línea con su número', async () => {
    const receipts = {
      list: jest.fn(async () => 'receipts'),
      pdf: jest.fn(async () => ({ buffer: Buffer.from('%PDF'), filename: 'recibo-00000001.pdf' })),
    };
    const controller = new ReceiptsController(receipts as any);
    expect(await controller.list({})).toBe('receipts');
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.pdf('rec-1', res as any);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="recibo-00000001.pdf"',
      }),
    );
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });
});
