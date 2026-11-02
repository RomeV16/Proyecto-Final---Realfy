import { collectedOf, DepositsService } from './deposits.service';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const PERSON = '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11';

const body = (over: Record<string, unknown> = {}) => ({
  amount: '100000',
  currency: 'ARS',
  heldBy: 'Locador',
  heldByPersonId: PERSON,
  installments: 2,
  refundRule: 'PesosActualizado',
  ...over,
});

function build(over: { existing?: any; contract?: any; person?: any } = {}) {
  const tx: any = {
    contract: {
      findFirst: jest.fn().mockResolvedValue(
        over.contract === undefined
          ? { id: 'c1', startDate: utc(2025, 1, 10), persons: [{ role: 'Inquilino', person: { id: 'tp' } }] }
          : over.contract,
      ),
      update: jest.fn(),
    },
    person: { findFirst: jest.fn().mockResolvedValue(over.person === undefined ? { id: PERSON } : over.person) },
    contractDeposit: {
      findFirst: jest.fn().mockResolvedValue(over.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: 'd1' }),
      update: jest.fn().mockResolvedValue({ id: over.existing?.id ?? 'd1' }),
    },
    contractDepositInstallment: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const prisma = { client: { ...tx, $transaction: (fn: any) => fn(tx) } };
  const audit = { record: jest.fn() };
  const cash = {
    ensureCustodyAccount: jest.fn().mockResolvedValue({ id: 'cust', kind: 'Custodia' }),
    resolveAgencyAccount: jest.fn().mockResolvedValue({ id: 'caja', kind: 'Caja' }),
    recordMovement: jest.fn().mockResolvedValue({ id: 'm1' }),
    lockAccount: jest.fn(),
  };
  const defaults = {
    get: jest.fn().mockResolvedValue({ deposits: { defaultHeldBy: 'Locador', refundDueDays: 30, deductionsNeedLessorApproval: false } }),
  };
  const service = new DepositsService(prisma as any, { getTenantId: () => 't1' } as any, audit as any, cash as any, defaults as any);
  return { service, tx, audit, cash };
}

const existingDeposit = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  amount: '100000',
  currency: 'ARS',
  heldBy: 'Locador',
  heldByPersonId: PERSON,
  installments: 2,
  refundDueDays: 45,
  status: 'Pendiente',
  installmentRows: [
    { id: 'i1', number: 1, amount: '50000', paidAt: null },
    { id: 'i2', number: 2, amount: '50000', paidAt: null },
  ],
  ...over,
});

describe('DepositsService.get', () => {
  it('sin depósito devuelve null y los valores por defecto', async () => {
    const { service, tx } = build();
    tx.contractDeposit.findFirst.mockResolvedValue(null);
    const res = await service.get('c1');
    expect(res.deposit).toBeNull();
    expect(res.defaults.refundDueDays).toBe(30);
  });

  it('con depósito suma lo cobrado y lo pendiente', async () => {
    const { service, tx } = build();
    tx.contractDeposit.findFirst.mockResolvedValue(
      existingDeposit({
        installmentRows: [
          { id: 'i1', number: 1, amount: '50000', paidAt: utc(2025, 1, 10) },
          { id: 'i2', number: 2, amount: '50000', paidAt: null },
        ],
      }),
    );
    const res = await service.get('c1');
    expect(res.deposit).toMatchObject({ collectedAmount: '50000.00', pendingAmount: '50000.00' });
  });

  it('un contrato inexistente es 404', async () => {
    const { service } = build({ contract: null });
    await expect(service.get('x')).rejects.toMatchObject({ response: { error: 'CONTRACT_NOT_FOUND' } });
  });

  it('collectedOf ignora las cuotas sin cobrar', () => {
    expect(collectedOf([{ amount: '10.50', paidAt: utc(2025, 1, 1) }, { amount: '5', paidAt: null }]).toFixed(2)).toBe('10.50');
  });
});

describe('DepositsService.upsert', () => {
  it('crea el depósito con sus cuotas desde el inicio del contrato y copia el importe al contrato', async () => {
    const { service, tx, audit } = build();
    tx.contractDeposit.findFirst.mockResolvedValueOnce(null).mockResolvedValue(existingDeposit());
    await service.upsert('c1', body());
    expect(tx.contractDeposit.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1',
      contractId: 'c1',
      amount: '100000',
      heldBy: 'Locador',
      refundDueDays: 30,
    });
    const rows = tx.contractDepositInstallment.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => [r.number, r.amount, r.dueDate.toISOString().slice(0, 10)])).toEqual([
      [1, '50000.00', '2025-01-10'],
      [2, '50000.00', '2025-02-10'],
    ]);
    expect(tx.contract.update.mock.calls[0][0].data).toEqual({ depositAmount: '100000', depositCurrency: 'ARS' });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'CREATE', entity: 'ContractDeposit' });
  });

  it('el plazo de devolución propio gana sobre el de la inmobiliaria', async () => {
    const { service, tx } = build();
    tx.contractDeposit.findFirst.mockResolvedValueOnce(null).mockResolvedValue(existingDeposit());
    await service.upsert('c1', body({ refundDueDays: 10 }));
    expect(tx.contractDeposit.create.mock.calls[0][0].data.refundDueDays).toBe(10);
  });

  it('pesos actualizado en dólares es inválido', async () => {
    const { service } = build();
    await expect(service.upsert('c1', body({ currency: 'USD' }))).rejects.toMatchObject({ status: 400 });
  });

  it('el locador que lo guarda es obligatorio', async () => {
    const { service } = build();
    await expect(service.upsert('c1', body({ heldByPersonId: null }))).rejects.toMatchObject({ status: 400 });
  });

  it('un titular inexistente es 400', async () => {
    const { service } = build({ person: null });
    await expect(service.upsert('c1', body())).rejects.toMatchObject({ response: { error: 'HOLDER_NOT_FOUND' } });
  });

  it('un depósito devuelto no se cambia', async () => {
    const { service } = build({ existing: existingDeposit({ status: 'Devuelto' }) });
    await expect(service.upsert('c1', body())).rejects.toMatchObject({ response: { error: 'DEPOSIT_REFUNDED' } });
  });

  it('sin cobros vuelve a armar las cuotas', async () => {
    const { service, tx } = build({ existing: existingDeposit() });
    tx.contractDeposit.findFirst.mockResolvedValueOnce(existingDeposit()).mockResolvedValue(existingDeposit());
    await service.upsert('c1', body({ amount: '120000', installments: 3 }));
    expect(tx.contractDepositInstallment.deleteMany).toHaveBeenCalled();
    expect(tx.contractDepositInstallment.createMany.mock.calls[0][0].data).toHaveLength(3);
    expect(tx.contractDeposit.update.mock.calls[0][0].data.refundDueDays).toBe(45);
  });

  it('con una cuota cobrada no cambia el importe pero sí la regla', async () => {
    const paid = existingDeposit({
      installmentRows: [
        { id: 'i1', number: 1, amount: '50000', paidAt: utc(2025, 1, 10) },
        { id: 'i2', number: 2, amount: '50000', paidAt: null },
      ],
    });
    const rejected = build({ existing: paid });
    await expect(rejected.service.upsert('c1', body({ amount: '90000' }))).rejects.toMatchObject({
      response: { error: 'DEPOSIT_HAS_PAYMENTS' },
    });
    const holder = build({ existing: paid });
    await expect(holder.service.upsert('c1', body({ heldBy: 'Inmobiliaria' }))).rejects.toMatchObject({
      response: { error: 'DEPOSIT_HAS_PAYMENTS' },
    });
    const ok = build({ existing: paid });
    ok.tx.contractDeposit.findFirst.mockResolvedValueOnce(paid).mockResolvedValue(paid);
    await ok.service.upsert('c1', body({ refundRule: 'MismaMoneda' }));
    expect(ok.tx.contractDepositInstallment.deleteMany).not.toHaveBeenCalled();
    expect(ok.tx.contractDeposit.update.mock.calls[0][0].data.refundRule).toBe('MismaMoneda');
  });
});

describe('DepositsService.collectInstallment', () => {
  const held = (over: Record<string, unknown>) => existingDeposit(over);

  it('si lo guarda el locador solo anota el cobro, sin movimiento de caja', async () => {
    const { service, tx, cash } = build();
    tx.contractDeposit.findFirst.mockResolvedValue(held({}));
    tx.contractDepositInstallment.findMany.mockResolvedValue([{ amount: '50000', paidAt: utc(2025, 1, 10) }, { amount: '50000', paidAt: null }]);
    const res: any = await service.collectInstallment('c1', 1, { paidAt: '2025-01-10' });
    expect(cash.recordMovement).not.toHaveBeenCalled();
    expect(tx.contractDeposit.update.mock.calls[0][0].data.status).toBe('Parcial');
    expect(res).toBeDefined();
  });

  it('si lo guarda la inmobiliaria con un locador dueño entra a su custodia', async () => {
    const { service, tx, cash } = build();
    tx.contractDeposit.findFirst.mockResolvedValue(held({ heldBy: 'Inmobiliaria' }));
    tx.contractDepositInstallment.findMany.mockResolvedValue([{ amount: '50000', paidAt: utc(2025, 1, 10) }, { amount: '50000', paidAt: utc(2025, 1, 10) }]);
    await service.collectInstallment('c1', 2, { paidAt: '2025-01-10' });
    expect(cash.ensureCustodyAccount).toHaveBeenCalledWith(tx, 't1', PERSON, 'ARS');
    expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({
      accountId: 'cust',
      direction: 'In',
      category: 'Deposito',
      amount: '50000',
      counterpartyId: 'tp',
      sourceType: 'DepositInstallment',
      sourceId: 'i2',
    });
    expect(tx.contractDeposit.update.mock.calls[0][0].data.status).toBe('Cobrado');
  });

  it('si la inmobiliaria no tiene locador dueño usa su caja', async () => {
    const { service, tx, cash } = build();
    tx.contractDeposit.findFirst.mockResolvedValue(held({ heldBy: 'Inmobiliaria', heldByPersonId: null }));
    await service.collectInstallment('c1', 1, { method: 'Transferencia' });
    expect(cash.resolveAgencyAccount).toHaveBeenCalledWith(tx, 't1', { accountId: undefined, currency: 'ARS', method: 'Transferencia' });
    expect(tx.contractDepositInstallment.update.mock.calls[0][0].data).toEqual({ cashMovementId: 'm1' });
  });

  it('una cuota ya cobrada es 409', async () => {
    const { service, tx } = build();
    tx.contractDeposit.findFirst.mockResolvedValue(held({}));
    tx.contractDepositInstallment.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.collectInstallment('c1', 1, {})).rejects.toMatchObject({
      response: { error: 'INSTALLMENT_ALREADY_COLLECTED' },
    });
  });

  it('sin depósito, cuota inexistente o depósito devuelto', async () => {
    const none = build();
    await expect(none.service.collectInstallment('c1', 1, {})).rejects.toMatchObject({ response: { error: 'DEPOSIT_NOT_FOUND' } });
    const missing = build();
    missing.tx.contractDeposit.findFirst.mockResolvedValue(held({}));
    await expect(missing.service.collectInstallment('c1', 9, {})).rejects.toMatchObject({ response: { error: 'INSTALLMENT_NOT_FOUND' } });
    const refunded = build();
    refunded.tx.contractDeposit.findFirst.mockResolvedValue(held({ status: 'Devuelto' }));
    await expect(refunded.service.collectInstallment('c1', 1, {})).rejects.toMatchObject({ response: { error: 'DEPOSIT_REFUNDED' } });
  });
});

describe('DepositsService.holdingAccount', () => {
  it('bloquea la custodia del locador antes de devolver', async () => {
    const { service, tx, cash } = build();
    const account = await service.holdingAccount(tx, 't1', { heldByPersonId: PERSON, currency: 'ARS' }, { method: 'Efectivo' });
    expect(account.id).toBe('cust');
    expect(cash.lockAccount).toHaveBeenCalledWith(tx, 't1', 'cust');
  });

  it('sin locador dueño usa la caja de la moneda', async () => {
    const { service, tx, cash } = build();
    const account = await service.holdingAccount(tx, 't1', { heldByPersonId: null, currency: 'USD' }, { method: 'Efectivo', accountId: 'a1' });
    expect(account.id).toBe('caja');
    expect(cash.resolveAgencyAccount).toHaveBeenCalledWith(tx, 't1', { method: 'Efectivo', accountId: 'a1', currency: 'USD' });
    expect(cash.lockAccount).not.toHaveBeenCalled();
  });
});
