import { OwnersController, OwnerStatementsController } from './owner-accounts.controller';

describe('controladores de la cuenta corriente del locador', () => {
  it('cuenta corriente: delegan en el servicio con los parámetros del pedido', async () => {
    const ledger = {
      balances: jest.fn(async () => 'balances'),
      ledger: jest.fn(async () => 'ledger'),
      setOpeningBalance: jest.fn(async () => 'opening'),
      payout: jest.fn(async () => 'payout'),
    };
    const owners = new OwnersController(ledger as any);
    expect(await owners.balances('USD')).toBe('balances');
    expect(ledger.balances).toHaveBeenCalledWith({ currency: 'USD' });
    expect(await owners.ledgerOf('p1', { currency: 'ARS' })).toBe('ledger');
    expect(ledger.ledger).toHaveBeenCalledWith('p1', { currency: 'ARS' });
    expect(await owners.openingBalance('p1', { amount: '1' })).toBe('opening');
    expect(await owners.payout('p1', { amount: '1' })).toBe('payout');
    expect(ledger.payout).toHaveBeenCalledWith('p1', { amount: '1' });
  });

  it('estados: generar toma el mes de la URL o del cuerpo; el PDF va en línea', async () => {
    const statements = {
      generate: jest.fn(async () => 'generated'),
      list: jest.fn(async () => 'list'),
      findOne: jest.fn(async () => 'one'),
      issue: jest.fn(async () => 'issued'),
      annul: jest.fn(async () => 'annulled'),
      pdf: jest.fn(async () => ({ buffer: Buffer.from('%PDF'), filename: 'estado-de-cuenta-ana-2026-10-ARS.pdf' })),
    };
    const controller = new OwnerStatementsController(statements as any);
    expect(await controller.generate({ period: '2026-10' }, undefined)).toBe('generated');
    expect(statements.generate).toHaveBeenLastCalledWith({ period: '2026-10' });
    await controller.generate({}, { period: '2026-11', personId: 'p1' });
    expect(statements.generate).toHaveBeenLastCalledWith({ period: '2026-11', personId: 'p1' });
    expect(await controller.list({})).toBe('list');
    expect(await controller.findOne('s1')).toBe('one');
    expect(await controller.issue('s1')).toBe('issued');
    expect(await controller.annul('s1', { reason: 'x' })).toBe('annulled');
    expect(statements.annul).toHaveBeenCalledWith('s1', { reason: 'x' });
    const res = { set: jest.fn(), end: jest.fn() };
    await controller.pdf('s1', res as any);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({ 'Content-Disposition': 'inline; filename="estado-de-cuenta-ana-2026-10-ARS.pdf"' }),
    );
    expect(res.end).toHaveBeenCalledWith(Buffer.from('%PDF'));
  });
});
