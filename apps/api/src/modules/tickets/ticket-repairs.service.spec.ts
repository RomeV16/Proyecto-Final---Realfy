import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TicketRepairsService } from './ticket-repairs.service';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const CONTRACT_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const LESSOR_ID = '66666666-6666-4666-8666-666666666666';
const money = (v: string) => ({ toString: () => v });
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const ticket = (over: Record<string, unknown> = {}) => ({
  id: TICKET_ID,
  title: 'Pérdida en la cocina',
  status: 'Resuelto',
  propertyId: PROPERTY_ID,
  contractId: CONTRACT_ID,
  providerId: PROVIDER_ID,
  costAmount: money('80000'),
  costCurrency: 'ARS',
  costPayer: null,
  imputedAt: null,
  ...over,
});

const payment = (amount: string, date = '2026-10-20') => ({ amount: money(amount), currency: 'ARS', date: day(date) });

interface Opts {
  ticket?: any;
  payments?: any[];
  account?: any;
  claimed?: number;
  contracts?: any[];
  lessors?: any[];
  fee?: number;
  commission?: any;
}

function build(opts: Opts = {}) {
  const client: any = {
    ticket: {
      findUnique: jest.fn(async () => (opts.ticket === undefined ? ticket() : opts.ticket)),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    cashMovement: {
      findMany: jest.fn().mockResolvedValue(opts.payments ?? []),
    },
    contractCommission: { findFirst: jest.fn().mockResolvedValue(opts.commission ?? null) },
    contract: { findMany: jest.fn().mockResolvedValue(opts.contracts ?? [{ id: CONTRACT_ID }]) },
    contractLessor: { findMany: jest.fn().mockResolvedValue(opts.lessors ?? [{ personId: LESSOR_ID }]) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const defaults = { get: jest.fn().mockResolvedValue({ repairs: { preauthLimit: 0, managementFeePct: opts.fee ?? 0 } }) };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn().mockReturnValue('user-1') };
  const cash = {
    findAccount: jest.fn(async () => opts.account ?? { id: ACCOUNT_ID, kind: 'Caja', currency: 'ARS', isActive: true }),
    assertOperational: jest.fn(),
    recordMovement: jest.fn(async (_tx: any, input: any) => ({ id: 'mov-1', category: input.category, amount: money(String(input.amount)), ...input })),
  };
  const charges = {
    createIn: jest.fn(async (_tx: any, input: any, o: any = {}) => [{ id: `pc-${input.kind}`, ...input, settled: !!o.settled }]),
  };
  // Después de reclamar el ticket, la imputación lo vuelve a leer.
  client.ticket.findUnique.mockImplementation(async () => {
    const base = opts.ticket === undefined ? ticket() : opts.ticket;
    return base && client.ticket.updateMany.mock.calls.length > 0 && client.ticket.updateMany.mock.calls[0][0].data.imputedAt
      ? { ...base, imputedAt: new Date(), costPayer: client.ticket.updateMany.mock.calls[0][0].data.costPayer }
      : base;
  });
  const service = new TicketRepairsService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    audit as any,
    defaults as any,
    cash as any,
    charges as any,
  );
  return { service, client, audit, cash, charges };
}

describe('TicketRepairsService', () => {
  describe('pagos al proveedor', () => {
    const body = { accountId: ACCOUNT_ID, amount: '30000', date: '2026-10-21' };

    it('lista los pagos con su total, ordenados', async () => {
      const { service, client } = build({
        payments: [
          { amount: money('30000'), currency: 'ARS' },
          { amount: money('20000.50'), currency: 'ARS' },
        ],
      });
      expect(await service.listPayments(TICKET_ID)).toMatchObject({ total: '50000.50', currency: 'ARS' });
      expect(client.cashMovement.findMany.mock.calls[0][0].orderBy).toEqual([{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]);
      expect(client.cashMovement.findMany.mock.calls[0][0].where).toMatchObject({ sourceType: 'Ticket', sourceId: TICKET_ID, category: 'PagoProveedor' });
      expect((await build().service.listPayments(TICKET_ID)).currency).toBeNull();
    });

    it('registra un movimiento PagoProveedor con origen en el ticket', async () => {
      const { service, cash, audit } = build();
      const res = await service.registerPayment(TICKET_ID, body);
      expect(cash.recordMovement).toHaveBeenCalledTimes(1);
      expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({
        tenantId: 'tenant-1',
        accountId: ACCOUNT_ID,
        direction: 'Out',
        amount: '30000',
        currency: 'ARS',
        category: 'PagoProveedor',
        counterpartyId: PROVIDER_ID,
        contractId: CONTRACT_ID,
        sourceType: 'Ticket',
        sourceId: TICKET_ID,
      });
      expect(cash.recordMovement.mock.calls[0][1].date).toEqual(day('2026-10-21'));
      expect(res.paid).toBe('30000.00');
      expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entity: 'CashMovement', action: 'CREATE' }));
    });

    it('toma la moneda del trabajo del ticket si todavía no la tenía', async () => {
      const { service, client } = build({ ticket: ticket({ costCurrency: null, costAmount: null }) });
      await service.registerPayment(TICKET_ID, body);
      expect(client.ticket.update).toHaveBeenCalledWith({ where: { id: TICKET_ID }, data: { costCurrency: 'ARS' } });
    });

    it('no deja pasarse de lo aprobado sumando los pagos anteriores', async () => {
      const { service, cash } = build({ payments: [{ amount: money('60000') }] });
      await expect(service.registerPayment(TICKET_ID, body)).rejects.toMatchObject({ response: { error: 'PAYMENT_EXCEEDS_APPROVED' } });
      expect(cash.recordMovement).not.toHaveBeenCalled();
    });

    it('rechaza la cuenta de otra moneda', async () => {
      await expect(
        build({ account: { id: ACCOUNT_ID, kind: 'Banco', currency: 'USD', isActive: true } }).service.registerPayment(TICKET_ID, body),
      ).rejects.toMatchObject({ response: { error: 'CURRENCY_MISMATCH' } });
    });

    it('rechaza un ticket que no se puede pagar: sin proveedor, antes de trabajar, ya imputado o inexistente', async () => {
      await expect(build({ ticket: ticket({ status: 'Presupuestado' }) }).service.registerPayment(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_NOT_PAYABLE' },
      });
      await expect(build({ ticket: ticket({ providerId: null }) }).service.registerPayment(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_WITHOUT_PROVIDER' },
      });
      await expect(build({ ticket: ticket({ imputedAt: new Date() }) }).service.registerPayment(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_ALREADY_IMPUTED' },
      });
      await expect(build({ ticket: null }).service.registerPayment(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_NOT_FOUND' },
      });
      await expect(build({ claimed: 0 }).service.registerPayment(TICKET_ID, body)).rejects.toMatchObject({
        response: { error: 'TICKET_ALREADY_IMPUTED' },
      });
    });
  });

  describe('imputación', () => {
    const payments = [payment('30000', '2026-10-20'), payment('50000.50', '2026-10-25')];

    it('al inquilino: un cargo Reparación por lo pagado, a su próxima liquidación, con el dinero de la inmobiliaria', async () => {
      const { service, charges, client, audit } = build({ payments });
      const res = await service.impute(TICKET_ID, { chargedTo: 'Inquilino' });
      expect(res).toMatchObject({ total: '80000.50', currency: 'ARS', feeCharge: null });
      expect(charges.createIn).toHaveBeenCalledTimes(1);
      const [, input, opts] = charges.createIn.mock.calls[0];
      expect(input).toMatchObject({
        propertyId: PROPERTY_ID,
        contractId: CONTRACT_ID,
        chargedTo: 'Inquilino',
        lessorPersonId: null,
        kind: 'Reparacion',
        description: 'Pérdida en la cocina',
        amount: '80000.50',
        beneficiary: 'Inmobiliaria',
        incurredAt: '2026-10-25',
        sourceType: 'Ticket',
        sourceId: TICKET_ID,
      });
      expect(opts).toEqual({ settled: false });
      expect(client.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: TICKET_ID, imputedAt: null },
        data: { imputedAt: expect.any(Date), costPayer: 'Inquilino' },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ metadata: expect.objectContaining({ operation: 'ticket-impute', chargedTo: 'Inquilino', total: '80000.50' }) }),
      );
    });

    it('al locador: queda a nombre del único locador vigente; con varios queda sin nombre', async () => {
      const one = build({ payments });
      await one.service.impute(TICKET_ID, { chargedTo: 'Locador' });
      expect(one.charges.createIn.mock.calls[0][1]).toMatchObject({ chargedTo: 'Locador', lessorPersonId: LESSOR_ID });
      const many = build({ payments, lessors: [{ personId: LESSOR_ID }, { personId: PROVIDER_ID }] });
      await many.service.impute(TICKET_ID, { chargedTo: 'Locador' });
      expect(many.charges.createIn.mock.calls[0][1].lessorPersonId).toBeNull();
    });

    it('a la inmobiliaria: el cargo nace resuelto y no se admite honorario', async () => {
      const { service, charges } = build({ payments });
      await service.impute(TICKET_ID, { chargedTo: 'Inmobiliaria' });
      expect(charges.createIn.mock.calls[0][2]).toEqual({ settled: true });
      await expect(
        build({ payments }).service.impute(TICKET_ID, { chargedTo: 'Inmobiliaria', managementFee: { mode: 'Percent', pct: 10 } }),
      ).rejects.toMatchObject({ response: { error: 'FEE_NOT_APPLICABLE' } });
    });

    it('usa el pagador que ya tenía el ticket cuando no se indica otro', async () => {
      const { service, charges } = build({ payments, ticket: ticket({ costPayer: 'Locador' }) });
      await service.impute(TICKET_ID, {});
      expect(charges.createIn.mock.calls[0][1].chargedTo).toBe('Locador');
    });

    it('con honorario en porcentaje carga un segundo cargo HonorarioGestion', async () => {
      const { service, charges } = build({ payments });
      const res = await service.impute(TICKET_ID, { chargedTo: 'Inquilino', managementFee: { mode: 'Percent', pct: 10 } });
      expect(charges.createIn).toHaveBeenCalledTimes(2);
      expect(charges.createIn.mock.calls[1][1]).toMatchObject({
        kind: 'HonorarioGestion',
        amount: '8000.05',
        chargedTo: 'Inquilino',
        beneficiary: 'Inmobiliaria',
        sourceType: 'Ticket',
        sourceId: TICKET_ID,
      });
      expect(charges.createIn.mock.calls[1][2]).toBeUndefined();
      expect(res.feeCharge).toMatchObject({ id: 'pc-HonorarioGestion' });
    });

    it('con honorario en porcentaje sin valor usa el de la inmobiliaria; con importe fijo, ese importe', async () => {
      const byDefault = build({ payments, fee: 5 });
      await byDefault.service.impute(TICKET_ID, { chargedTo: 'Locador', managementFee: { mode: 'Percent' } });
      expect(byDefault.charges.createIn.mock.calls[1][1].amount).toBe('4000.03');
      const fixed = build({ payments });
      await fixed.service.impute(TICKET_ID, { chargedTo: 'Locador', managementFee: { mode: 'Fixed', amount: '1500' } });
      expect(fixed.charges.createIn.mock.calls[1][1].amount).toBe('1500.00');
    });

    it('en porcentaje sin valor prefiere el del contrato al de la inmobiliaria (al inquilino)', async () => {
      const { service, charges } = build({ payments, fee: 5, commission: { repairMgmtFeePct: money('12.5') } });
      await service.impute(TICKET_ID, { chargedTo: 'Inquilino', managementFee: { mode: 'Percent' } });
      expect(charges.createIn.mock.calls[1][1].amount).toBe('10000.06');
    });

    it('al locador con honorario pactado en el contrato lo asienta el estado: no se carga otro', async () => {
      const { service, charges } = build({ payments, commission: { repairMgmtFeePct: money('10') } });
      const res = await service.impute(TICKET_ID, { chargedTo: 'Locador', managementFee: { mode: 'Percent' } });
      expect(charges.createIn).toHaveBeenCalledTimes(1);
      expect(res).toMatchObject({ feeCharge: null, feeAppliedByStatement: 10 });
      await expect(
        build({ payments, commission: { repairMgmtFeePct: money('10') } }).service.impute(TICKET_ID, { chargedTo: 'Locador', managementFee: { mode: 'Fixed', amount: '1500' } }),
      ).rejects.toMatchObject({ response: { error: 'FEE_SET_BY_CONTRACT' } });
      await expect(
        build({ payments, commission: { repairMgmtFeePct: money('10') } }).service.impute(TICKET_ID, { chargedTo: 'Locador', managementFee: { mode: 'Percent', pct: 5 } }),
      ).rejects.toMatchObject({ response: { error: 'FEE_SET_BY_CONTRACT' } });
    });

    it('un honorario en cero no genera cargo', async () => {
      const { service, charges } = build({ payments });
      await service.impute(TICKET_ID, { chargedTo: 'Locador', managementFee: { mode: 'Percent' } });
      expect(charges.createIn).toHaveBeenCalledTimes(1);
    });

    it('si la imputación ya se hizo, falla sin crear nada (una sola vez)', async () => {
      const raced = build({ payments, claimed: 0 });
      await expect(raced.service.impute(TICKET_ID, { chargedTo: 'Locador' })).rejects.toMatchObject({ response: { error: 'TICKET_ALREADY_IMPUTED' } });
      expect(raced.charges.createIn).not.toHaveBeenCalled();
      const done = build({ payments, ticket: ticket({ imputedAt: new Date() }) });
      await expect(done.service.impute(TICKET_ID, { chargedTo: 'Locador' })).rejects.toMatchObject({ response: { error: 'TICKET_ALREADY_IMPUTED' } });
    });

    it('exige pagos al proveedor, un trabajo terminado, un pagador y un contrato si paga el inquilino', async () => {
      await expect(build().service.impute(TICKET_ID, { chargedTo: 'Locador' })).rejects.toMatchObject({ response: { error: 'NO_PROVIDER_PAYMENTS' } });
      await expect(build({ payments, ticket: ticket({ status: 'EnProgreso' }) }).service.impute(TICKET_ID, { chargedTo: 'Locador' })).rejects.toMatchObject({
        response: { error: 'TICKET_NOT_IMPUTABLE' },
      });
      await expect(build({ payments }).service.impute(TICKET_ID, {})).rejects.toMatchObject({ response: { error: 'PAYER_REQUIRED' } });
      await expect(
        build({ payments, ticket: ticket({ contractId: null }), contracts: [] }).service.impute(TICKET_ID, { chargedTo: 'Inquilino' }),
      ).rejects.toMatchObject({ response: { error: 'CONTRACT_REQUIRED' } });
      await expect(build({ ticket: null }).service.impute(TICKET_ID, { chargedTo: 'Locador' })).rejects.toMatchObject({ response: { error: 'TICKET_NOT_FOUND' } });
    });

    it('sin contrato propio toma el único vigente de la propiedad; con dos no elige', async () => {
      const single = build({ payments, ticket: ticket({ contractId: null }), contracts: [{ id: CONTRACT_ID }] });
      await single.service.impute(TICKET_ID, { chargedTo: 'Inquilino' });
      expect(single.charges.createIn.mock.calls[0][1].contractId).toBe(CONTRACT_ID);
      const two = build({ payments, ticket: ticket({ contractId: null }), contracts: [{ id: 'a' }, { id: 'b' }] });
      await expect(two.service.impute(TICKET_ID, { chargedTo: 'Inquilino' })).rejects.toMatchObject({ response: { error: 'CONTRACT_REQUIRED' } });
    });
  });
});
