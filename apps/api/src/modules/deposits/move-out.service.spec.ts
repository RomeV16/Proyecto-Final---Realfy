import { MoveOutService } from './move-out.service';
import { MoveOutPdfService } from './move-out-pdf.service';
import { convertItemAmount } from './move-out-items';
import { Money } from '@realfy/shared';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const PERSON = '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11';

const deposit = (over: Record<string, unknown> = {}) => ({
  id: 'd1',
  amount: '100000',
  currency: 'ARS',
  heldBy: 'Inmobiliaria',
  heldByPersonId: PERSON,
  refundRule: 'PesosActualizado',
  refundInstallments: 1,
  refundDueDays: 30,
  status: 'Cobrado',
  installmentRows: [{ id: 'i1', number: 1, amount: '100000', paidAt: utc(2024, 3, 1) }],
  ...over,
});

const contract = {
  id: 'c1',
  propertyId: 'p1',
  startDate: utc(2024, 3, 1),
  rentAmount: '182000',
  rentCurrency: 'ARS',
  adjustments: [
    { periodNumber: 1, adjustmentDate: utc(2024, 9, 1), previousAmount: '100000', newAmount: '130000', appliedAt: utc(2024, 9, 1), isProvisional: false },
    { periodNumber: 2, adjustmentDate: utc(2025, 3, 1), previousAmount: '130000', newAmount: '182000', appliedAt: utc(2025, 3, 1), isProvisional: false },
  ],
  persons: [{ role: 'Inquilino', person: { id: 'tp' } }],
};

const draftItems = [
  { kind: 'Reparacion', description: 'Pintura', amount: '20000.00', included: true, sourceType: 'PendingCharge', sourceId: 'pc1' },
  { kind: 'Servicio', description: 'Luz', amount: '5000.00', included: true, sourceType: 'ServiceBillAllocation', sourceId: 'sa1' },
  { kind: 'Deduccion', description: 'Llaves', amount: '1000.00', included: false },
];

function build(over: { deposit?: any; settlement?: any; followUps?: any[]; defaults?: any; balance?: string } = {}) {
  const dep = over.deposit === undefined ? deposit() : over.deposit;
  const tx: any = {
    contract: { findFirst: jest.fn().mockResolvedValue(contract) },
    contractDeposit: { findFirst: jest.fn().mockResolvedValue(dep), update: jest.fn() },
    moveOutSettlement: {
      findFirst: jest.fn().mockResolvedValue(over.settlement ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'mo1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'mo1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pendingCharge: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn(), create: jest.fn() },
    serviceBillAllocation: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
    liquidacion: { findMany: jest.fn().mockResolvedValue([]) },
    contractFollowUp: { findMany: jest.fn().mockResolvedValue(over.followUps ?? [{ id: 'f1' }]) },
    followUpTask: { updateMany: jest.fn() },
    ownerLedgerEntry: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = { client: { ...tx, $transaction: (fn: any) => fn(tx) } };
  const audit = { record: jest.fn() };
  const cash = {
    recordMovement: jest.fn().mockResolvedValue({ id: 'mv1' }),
    balances: jest.fn().mockResolvedValue(new Map([['cust', new Money(over.balance ?? '500000')]])),
  };
  const deposits = { holdingAccount: jest.fn().mockResolvedValue({ id: 'cust', kind: 'Custodia' }) };
  const penalties = { loadContext: jest.fn().mockResolvedValue({}), payoffOf: jest.fn().mockResolvedValue({ due: new Money('300') }) };
  const defaults = {
    get: jest.fn().mockResolvedValue(
      over.defaults ?? {
        deposits: { defaultHeldBy: 'Locador', refundDueDays: 30, deductionsNeedLessorApproval: false },
        ownerAccounts: { statementCloseDay: null },
      },
    ),
  };
  const service = new MoveOutService(
    prisma as any,
    { getTenantId: () => 't1', getUserId: () => 'u1' } as any,
    audit as any,
    cash as any,
    deposits as any,
    penalties as any,
    defaults as any,
  );
  return { service, tx, audit, cash, deposits, penalties };
}

const settlement = (over: Record<string, unknown> = {}) => ({
  id: 'mo1',
  contractId: 'c1',
  status: 'Borrador',
  date: utc(2025, 6, 1),
  currency: 'ARS',
  items: draftItems,
  notes: null,
  ...over,
});

describe('MoveOutService.preview', () => {
  it('arma renglones del sistema y totales con la regla de pesos actualizado', async () => {
    const { service, tx, penalties } = build();
    tx.liquidacion.findMany.mockResolvedValue([
      { id: 'l1', status: 'Vencida', period: utc(2025, 5, 1), dueDate: utc(2025, 5, 10), total: '182000', currency: 'ARS', payments: [{ amount: '82000' }], lineItems: [] },
      { id: 'l2', status: 'Pendiente', period: utc(2025, 6, 1), dueDate: utc(2025, 6, 10), total: '1000', currency: 'ARS', payments: [], lineItems: [] },
      { id: 'l3', status: 'Pagada', period: utc(2025, 4, 1), dueDate: utc(2025, 4, 10), total: '500', currency: 'ARS', payments: [{ amount: '500' }], lineItems: [] },
    ]);
    tx.serviceBillAllocation.findMany.mockResolvedValue([
      { id: 'sa1', amount: '4500', bill: { currency: 'ARS', period: utc(2025, 5, 1), service: { serviceType: 'Luz', providerName: 'EPEC' } } },
    ]);
    tx.pendingCharge.findMany.mockResolvedValue([
      { id: 'pc1', kind: 'Reparacion', description: 'Cerradura', amount: '8000', currency: 'ARS' },
      { id: 'pc2', kind: 'ExpensaExtra', description: 'Expensa extra', amount: '-500', currency: 'ARS' },
    ]);
    const res: any = await service.preview('c1', { date: '2025-06-01' });
    expect(res.items.map((i: any) => [i.kind, i.amount])).toEqual([
      ['AlquilerPendiente', '100000.00'],
      ['Punitorio', '300.00'],
      ['AlquilerPendiente', '1000.00'],
      ['Servicio', '4500.00'],
      ['Reparacion', '8000.00'],
      ['Cargo', '-500.00'],
    ]);
    expect(penalties.payoffOf).toHaveBeenCalledTimes(1);
    expect(res.deposit).toMatchObject({ refundable: '182000.00', collected: '100000.00', heldBy: 'Inmobiliaria' });
    expect(res.deposit.refundDueDate).toBe('2025-07-01');
    expect(res.totalOwed).toBe('113300.00');
    expect(res.refundToTenant).toBe('68700.00');
    expect(res.owedByTenant).toBe('0.00');
    expect(tx.moveOutSettlement.create).not.toHaveBeenCalled();
  });

  it('sin depósito todo lo adeudado queda a cargo del inquilino', async () => {
    const { service, tx } = build({ deposit: null });
    tx.pendingCharge.findMany.mockResolvedValue([{ id: 'pc1', kind: 'Reparacion', description: 'Cerradura', amount: '8000', currency: 'ARS' }]);
    const res: any = await service.preview('c1', {});
    expect(res.deposit).toBeNull();
    expect(res.owedByTenant).toBe('8000.00');
    expect(res.refundToTenant).toBe('0.00');
  });

  it('un renglón en otra moneda pide el cambio', async () => {
    const { service, tx } = build();
    tx.pendingCharge.findMany.mockResolvedValue([{ id: 'pc1', kind: 'Reparacion', description: 'Cerradura', amount: '10', currency: 'USD' }]);
    await expect(service.preview('c1', { date: '2025-06-01' })).rejects.toMatchObject({ response: { error: 'RATE_REQUIRED' } });
    const res: any = await service.preview('c1', { date: '2025-06-01', rate: '1200.5' });
    expect(res.items[0].amount).toBe('12005.00');
  });

  it('un contrato inexistente es 404', async () => {
    const { service, tx } = build();
    tx.contract.findFirst.mockResolvedValue(null);
    await expect(service.preview('x', {})).rejects.toMatchObject({ response: { error: 'CONTRACT_NOT_FOUND' } });
  });

  it('cuotas sin cobrar: solo se devuelve la parte cobrada', async () => {
    const { service } = build({
      deposit: deposit({
        installmentRows: [
          { id: 'i1', number: 1, amount: '50000', paidAt: utc(2024, 3, 1) },
          { id: 'i2', number: 2, amount: '50000', paidAt: null },
        ],
        refundRule: 'MismaMoneda',
      }),
    });
    const res: any = await service.preview('c1', { date: '2025-06-01' });
    expect(res.depositAvailable).toBe('50000.00');
  });

  it('convertItemAmount no convierte en la misma moneda', () => {
    expect(convertItemAmount(new Money('5'), 'ARS', 'ARS', null).toFixed(2)).toBe('5.00');
  });
});

describe('MoveOutService.create y consulta', () => {
  it('crea el borrador con los totales recalculados', async () => {
    const { service, tx, audit } = build();
    const saved: any = await service.create('c1', { date: '2025-06-01', items: draftItems, notes: 'ok' });
    const data = tx.moveOutSettlement.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: 't1', contractId: 'c1', totalOwed: '25000.00', depositAvailable: '182000.00', netAmount: '157000.00', createdById: 'u1' });
    expect(saved.id).toBe('mo1');
    expect(audit.record.mock.calls[0][1].action).toBe('CREATE');
  });

  it('reemplaza el borrador existente y rechaza el confirmado', async () => {
    const replace = build({ settlement: settlement() });
    await replace.service.create('c1', { date: '2025-06-01', items: [] });
    expect(replace.tx.moveOutSettlement.update).toHaveBeenCalled();
    const confirmed = build({ settlement: settlement({ status: 'Confirmada' }) });
    await expect(confirmed.service.create('c1', { date: '2025-06-01', items: [] })).rejects.toMatchObject({
      response: { error: 'MOVE_OUT_CONFIRMED' },
    });
  });

  it('lee por contrato y por id', async () => {
    const { service, tx } = build({ settlement: settlement() });
    expect((await service.getForContract('c1')).settlement).toMatchObject({ id: 'mo1' });
    expect(await service.get('mo1')).toMatchObject({ id: 'mo1' });
    tx.moveOutSettlement.findFirst.mockResolvedValue(null);
    expect((await service.getForContract('c1')).settlement).toBeNull();
    await expect(service.get('zz')).rejects.toMatchObject({ response: { error: 'MOVE_OUT_NOT_FOUND' } });
  });
});

describe('MoveOutService.confirm', () => {
  it('devuelve el depósito desde la custodia, imputa cargos y boletas y tilda el paso del seguimiento', async () => {
    const { service, tx, cash, audit } = build({ settlement: settlement() });
    await service.confirm('mo1', {});
    expect(tx.moveOutSettlement.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'mo1', status: 'Borrador' } });
    expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({
      accountId: 'cust',
      direction: 'Out',
      category: 'Deposito',
      amount: '157000.00',
      counterpartyId: 'tp',
      sourceType: 'MoveOutSettlement',
      sourceId: 'mo1',
    });
    expect(tx.pendingCharge.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['pc1'] });
    expect(tx.serviceBillAllocation.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['sa1'] });
    expect(tx.contractDeposit.update.mock.calls[0][0].data).toMatchObject({ status: 'Devuelto', refundedAmount: '157000.00' });
    expect(tx.followUpTask.updateMany.mock.calls[0][0]).toMatchObject({ where: { followUpId: { in: ['f1'] }, code: 'DEPOSITO', done: false } });
    expect(tx.ownerLedgerEntry.createMany).not.toHaveBeenCalled();
    expect(tx.pendingCharge.create).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0][1].metadata).toMatchObject({ operation: 'move-out-confirm', refundToTenant: '157000.00', movementId: 'mv1' });
  });

  it('si la deuda supera al depósito deja el saldo como cargo pendiente del inquilino y no mueve caja', async () => {
    const { service, tx, cash } = build({
      settlement: settlement({ items: [{ kind: 'Deduccion', description: 'Daños', amount: '200000.00', included: true }] }),
    });
    await service.confirm('mo1', {});
    expect(cash.recordMovement).not.toHaveBeenCalled();
    expect(tx.pendingCharge.create.mock.calls[0][0].data).toMatchObject({
      chargedTo: 'Inquilino',
      amount: '18000.00',
      sourceType: 'MoveOutSettlement',
      sourceId: 'mo1',
      propertyId: 'p1',
    });
    expect(tx.contractDeposit.update.mock.calls[0][0].data.refundedAmount).toBe('0.00');
  });

  it('si lo guarda el locador registra lo retenido en su cuenta corriente y no mueve caja', async () => {
    const { service, tx, cash } = build({ settlement: settlement(), deposit: deposit({ heldBy: 'Locador' }) });
    await service.confirm('mo1', {});
    expect(cash.recordMovement).not.toHaveBeenCalled();
    const [{ data }] = tx.ownerLedgerEntry.createMany.mock.calls[0];
    expect(data[0]).toMatchObject({ personId: PERSON, type: 'CobroDirecto', amount: '-25000.00', sourceType: 'MoveOutSettlement', sourceId: 'mo1', propertyId: 'p1' });
  });

  it('rechaza una liquidación ya confirmada o tomada por otro', async () => {
    const done = build({ settlement: settlement({ status: 'Confirmada' }) });
    await expect(done.service.confirm('mo1', {})).rejects.toMatchObject({ response: { error: 'MOVE_OUT_ALREADY_CONFIRMED' } });
    const raced = build({ settlement: settlement() });
    raced.tx.moveOutSettlement.updateMany.mockResolvedValue({ count: 0 });
    await expect(raced.service.confirm('mo1', {})).rejects.toMatchObject({ response: { error: 'MOVE_OUT_ALREADY_CONFIRMED' } });
    const missing = build();
    await expect(missing.service.confirm('zz', {})).rejects.toMatchObject({ response: { error: 'MOVE_OUT_NOT_FOUND' } });
  });

  it('exige la conformidad del locador cuando la inmobiliaria la pide', async () => {
    const defaults = {
      deposits: { defaultHeldBy: 'Locador', refundDueDays: 30, deductionsNeedLessorApproval: true },
      ownerAccounts: { statementCloseDay: null },
    };
    const blocked = build({ settlement: settlement(), defaults });
    await expect(blocked.service.confirm('mo1', {})).rejects.toMatchObject({ response: { error: 'LESSOR_APPROVAL_REQUIRED' } });
    expect(blocked.tx.moveOutSettlement.updateMany).not.toHaveBeenCalled();
    const ok = build({ settlement: settlement(), defaults });
    await ok.service.confirm('mo1', { lessorApproved: true });
    expect(ok.tx.moveOutSettlement.updateMany).toHaveBeenCalled();
  });

  it('no devuelve más de lo que hay en la custodia', async () => {
    const { service } = build({ settlement: settlement(), balance: '1000' });
    await expect(service.confirm('mo1', {})).rejects.toMatchObject({ response: { error: 'CUSTODY_INSUFFICIENT' } });
  });

  it('la caja de la inmobiliaria no se controla contra un saldo', async () => {
    const { service, deposits, cash } = build({ settlement: settlement() });
    deposits.holdingAccount.mockResolvedValue({ id: 'caja', kind: 'Caja' });
    await service.confirm('mo1', { method: 'Transferencia' });
    expect(cash.balances).not.toHaveBeenCalled();
    expect(cash.recordMovement.mock.calls[0][1].accountId).toBe('caja');
  });

  it('un contrato sin depósito se cierra sin tocar caja ni depósito', async () => {
    const { service, tx, cash } = build({ settlement: settlement(), deposit: null, followUps: [] });
    await service.confirm('mo1', {});
    expect(cash.recordMovement).not.toHaveBeenCalled();
    expect(tx.contractDeposit.update).not.toHaveBeenCalled();
    expect(tx.followUpTask.updateMany).not.toHaveBeenCalled();
  });
});

describe('MoveOutPdfService', () => {
  const render = jest.fn().mockResolvedValue(Buffer.from('pdf'));
  const make = (over: Record<string, unknown> = {}, dep: any = deposit()) => {
    const moveOut = {
      detailForPdf: jest.fn().mockResolvedValue({
        settlement: settlement({ depositAvailable: '182000.00', status: 'Confirmada', notes: 'Sin novedades', ...over }),
        contract: {
          property: { street: 'Calle', number: '1' },
          persons: [{ role: 'Inquilino', person: { firstName: 'Ana', lastName: 'Lopez' } }],
          lessors: [{ person: { firstName: 'Luis', lastName: 'Paz' } }],
        },
        deposit: dep,
      }),
    };
    const prisma = { client: { tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmo', cuit: '30-1' }) } } };
    return new MoveOutPdfService(prisma as any, { getTenantId: () => 't1' } as any, { render } as any, moveOut as any);
  };

  it('arma el PDF con los renglones incluidos y el resultado', async () => {
    const { buffer, filename } = await make().pdf('mo1');
    expect(buffer.toString()).toBe('pdf');
    expect(filename).toBe('liquidacion-egreso-mo1.pdf');
    const doc = render.mock.calls[0][0];
    expect(JSON.stringify(doc.content)).toContain('Pintura');
    expect(JSON.stringify(doc.content)).not.toContain('Llaves');
    expect(JSON.stringify(doc.content)).toContain('Se devuelve');
  });

  it('con devolución en cuotas y saldo a cargo lo aclara', async () => {
    await make({ items: [{ kind: 'Deduccion', description: 'Daños', amount: '300000.00', included: true }] }).pdf('mo1');
    expect(JSON.stringify(render.mock.calls.at(-1)![0].content)).toContain('saldo a cargo');
    await make({ items: [] }, deposit({ refundInstallments: 2 })).pdf('mo1');
    expect(JSON.stringify(render.mock.calls.at(-1)![0].content)).toContain('en 2 cuotas');
    await make({ items: [], status: 'Borrador', notes: null }, null).pdf('mo1');
    expect(JSON.stringify(render.mock.calls.at(-1)![0].content)).toContain('Sin renglones');
  });
});
