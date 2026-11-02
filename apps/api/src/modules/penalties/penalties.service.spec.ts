import { ConflictException, NotFoundException } from '@nestjs/common';
import { makeFakePenaltyDb } from './penalties.testing';
import { parseDay } from './penalties.service';

const d = parseDay;
const fixed = { mode: 'daily_fixed', value: '10', graceDays: 0, maxMultiplier: '5.0' };

function liq(over: Record<string, unknown> = {}) {
  return { id: 'liq-1', total: '1000', dueDate: d('2026-03-10'), payments: [], ...over } as any;
}

describe('PenaltiesService.payoff (monto a pagar en una fecha)', () => {
  it('saldo más punitorio devengado a la fecha, sin guardar nada', async () => {
    const { service, penalties } = makeFakePenaltyDb({ liquidaciones: [liq()] });
    const r = await service.payoff('liq-1', '2026-03-20');
    expect(r).toMatchObject({ liquidacionId: 'liq-1', date: '2026-03-20', balance: '1000.00', total: '1100.00' });
    expect(r.penalty).toMatchObject({ accrued: '100.00', due: '100.00', daysOverdue: 10, capHit: false });
    expect(r.penalty?.rule).toMatchObject({ source: 'tenant', mode: 'daily_fixed' });
    expect(penalties).toHaveLength(0);
  });

  it('descuenta lo condonado y lo ya cobrado en otra liquidación', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [liq()],
      penalties: [
        { amount: '30.00', status: 'waived' },
        { amount: '20.00', settledLiquidacionId: 'liq-2' },
      ],
    });
    const r = await service.payoff('liq-1', '2026-03-20');
    expect(r.penalty).toMatchObject({ accrued: '100.00', waived: '30.00', alreadyBilled: '20.00', due: '50.00' });
    expect(r.total).toBe('1050.00');
  });

  it('con pagos parciales la base es el saldo y devuelve el saldo actual', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [liq({ payments: [{ amount: '400', paidAt: d('2026-03-15') }] })],
      tenantConfig: { mode: 'daily_percent', value: '0.01', graceDays: 0, maxMultiplier: '5.0' },
    });
    const r = await service.payoff('liq-1', '2026-03-20');
    // 5 días sobre 1000 y 5 sobre 600
    expect(r.penalty?.accrued).toBe('80.00');
    expect(r.balance).toBe('600.00');
    expect(r.total).toBe('680.00');
  });

  it('sin fecha usa hoy (Buenos Aires)', async () => {
    jest.useFakeTimers({ now: new Date('2026-03-20T01:00:00.000Z') }); // 22:00 del 19 en Buenos Aires
    try {
      const { service } = makeFakePenaltyDb({ liquidaciones: [liq()] });
      expect((await service.payoff('liq-1')).date).toBe('2026-03-19');
    } finally {
      jest.useRealTimers();
    }
  });

  it('una liquidación que no espera cobro no tiene monto a pagar', async () => {
    const { service } = makeFakePenaltyDb({ liquidaciones: [liq({ status: 'Pagada' })] });
    expect(await service.payoff('liq-1', '2026-03-20')).toMatchObject({ balance: '0.00', total: '0.00', penalty: null });
  });

  it('informa la tasa aplicada con max_bna_or_daily', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [liq()],
      tenantConfig: { mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '3.0' },
      bnaRows: [{ period: d('2026-03-01'), value: '100.000000' }],
    });
    const r = await service.payoff('liq-1', '2026-03-20');
    expect(r.penalty?.rule).toMatchObject({ mode: 'max_bna_or_daily', bnaMultiplier: '2', yearDays: 365, bnaDays: 10 });
    expect(r.penalty?.accrued).toBe('54.79');
  });

  it('404 si la liquidación no existe', async () => {
    const { service } = makeFakePenaltyDb();
    await expect(service.payoff('nope', '2026-03-20')).rejects.toThrow(NotFoundException);
  });
});

describe('PenaltiesService.accrue', () => {
  it('una versión de reglas con regla propia manda y se informa como del contrato', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [liq()],
      termsPenaltyConfig: { mode: 'daily_fixed', value: '3', graceDays: 2, maxMultiplier: '5.0' },
    });
    const r = await service.payoff('liq-1', '2026-03-20');
    expect(r.penalty).toMatchObject({ accrued: '24.00', graceDays: 2, rule: { source: 'contract' } });
  });

  it('registra solo la diferencia con lo ya registrado y audita con el origen', async () => {
    const { service, audit, client } = makeFakePenaltyDb({
      liquidaciones: [liq()],
      penalties: [{ amount: '60.00' }],
    });
    const ctx = await service.loadContext('tenant-1', 'contract-1', d('2026-03-20'));
    const { created } = await service.accrue(client, liq(), ctx, d('2026-03-20'), 'payment');
    expect(created?.amount.toFixed(2)).toBe('40.00');
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: { source: 'payment', mode: 'daily_fixed' } }));
  });
});

describe('PenaltiesService.pendingLines (Multa en la liquidación siguiente)', () => {
  const period = d('2026-04-01');
  const today = d('2026-03-20');

  it('arma un renglón Multa por liquidación de origen con sus filas', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [liq({ status: 'Pagada' })],
      penalties: [
        { amount: '40.00', daysOverdue: 4 },
        { amount: '60.00', daysOverdue: 10 },
      ],
    });
    const { lines, rowIds } = await service.pendingLines('tenant-1', 'contract-1', period, today);
    expect(lines).toEqual([
      {
        type: 'Multa',
        description: 'Punitorios por mora, alquiler 01/2026 (10 días)',
        amount: '100.00',
        commissionable: true,
        beneficiary: 'Locador',
        sourceType: 'Penalty',
        sourceId: 'liq-1',
      },
    ]);
    expect(rowIds).toEqual(['pen-1', 'pen-2']);
  });

  it('pone al día el devengo de las vencidas hasta la fecha de generación', async () => {
    const { service, penalties } = makeFakePenaltyDb({
      liquidaciones: [liq({ status: 'Enviada' })],
      penalties: [{ amount: '60.00', daysOverdue: 6 }],
    });
    const { lines } = await service.pendingLines('tenant-1', 'contract-1', period, today);
    // 10 días a 10 = 100; ya había 60
    expect(penalties.map((p) => p.amount)).toEqual(['60.00', '40.00']);
    expect(lines[0].amount).toBe('100.00');
  });

  it('no incluye lo condonado, lo ya cobrado ni las liquidaciones anuladas o del mismo período', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [
        liq({ status: 'Pagada' }),
        liq({ id: 'liq-anulada', status: 'Anulada', period: d('2026-02-01') }),
        liq({ id: 'liq-igual', status: 'Pagada', period }),
      ],
      penalties: [
        { amount: '10.00', status: 'waived' },
        { amount: '20.00', settledLiquidacionId: 'liq-9' },
        { amount: '30.00', liquidacionId: 'liq-anulada' },
        { amount: '40.00', liquidacionId: 'liq-igual' },
      ],
    });
    expect(await service.pendingLines('tenant-1', 'contract-1', period, today)).toEqual({ lines: [], rowIds: [] });
  });

  it('sin liquidaciones anteriores no hace nada', async () => {
    const { service, tenants } = makeFakePenaltyDb();
    expect(await service.pendingLines('tenant-1', 'contract-1', period, today)).toEqual({ lines: [], rowIds: [] });
    expect(tenants.getPenaltyConfig).not.toHaveBeenCalled();
  });

  it('una liquidación al día de pago con saldo cero no devenga y no genera renglón', async () => {
    const { service } = makeFakePenaltyDb({
      liquidaciones: [liq({ status: 'Enviada', payments: [{ amount: '1000', paidAt: d('2026-03-09') }] })],
      tenantConfig: fixed,
    });
    expect(await service.pendingLines('tenant-1', 'contract-1', period, today)).toEqual({ lines: [], rowIds: [] });
  });
});

describe('PenaltiesService.markSettled / release (una sola vez)', () => {
  it('marca las filas en la liquidación que las cobra', async () => {
    const { service, penalties, client } = makeFakePenaltyDb({
      penalties: [{ amount: '10.00' }, { amount: '20.00' }],
    });
    expect(await service.markSettled(client, ['pen-1', 'pen-2'], 'liq-2')).toBe(2);
    expect(penalties.every((p) => p.settledLiquidacionId === 'liq-2')).toBe(true);
  });

  it('una fila ya cobrada o condonada es conflicto y no se marca ninguna a medias', async () => {
    const { service, client } = makeFakePenaltyDb({
      penalties: [{ amount: '10.00' }, { amount: '20.00', settledLiquidacionId: 'liq-9' }],
    });
    await expect(service.markSettled(client, ['pen-1', 'pen-2'], 'liq-2')).rejects.toMatchObject({
      response: { error: 'PENALTY_ALREADY_SETTLED' },
    });
  });

  it('sin filas no toca nada', async () => {
    const { service, client } = makeFakePenaltyDb();
    expect(await service.markSettled(client, [], 'liq-2')).toBe(0);
    expect(client.penalty.updateMany).not.toHaveBeenCalled();
  });

  it('release libera las filas de una liquidación borrada, o las de un renglón', async () => {
    const { service, penalties, client } = makeFakePenaltyDb({
      penalties: [
        { amount: '10.00', settledLiquidacionId: 'liq-2' },
        { amount: '20.00', liquidacionId: 'liq-5', settledLiquidacionId: 'liq-2' },
      ],
    });
    expect(await service.release(client, 'liq-2', 'liq-5')).toBe(1);
    expect(penalties.map((p) => p.settledLiquidacionId)).toEqual(['liq-2', null]);
    expect(await service.release(client, 'liq-2')).toBe(1);
    expect(penalties.every((p) => p.settledLiquidacionId === null)).toBe(true);
  });
});

describe('PenaltiesService.waive (condonación auditada)', () => {
  it('condona, deja el motivo y audita antes y después', async () => {
    const { service, penalties, client } = makeFakePenaltyDb({ penalties: [{ amount: '50.00' }] });
    const result = await service.waive('pen-1', 'acuerdo con el locador');
    expect(result).toMatchObject({ status: 'waived', waiveReason: 'acuerdo con el locador', waivedBy: 'user-1' });
    expect(penalties[0].waivedAt).toBeInstanceOf(Date);
    expect(client.auditLog.create.mock.calls[0][0].data).toMatchObject({
      action: 'UPDATE',
      entity: 'Penalty',
      entityId: 'pen-1',
      before: { status: 'active', amount: '50.00' },
      after: { status: 'waived' },
      metadata: { source: 'waive', reason: 'acuerdo con el locador', liquidacionId: 'liq-1' },
    });
  });

  it('404 si no existe, 409 si ya está condonado o ya se cobró', async () => {
    const { service } = makeFakePenaltyDb({
      penalties: [{ amount: '1.00', status: 'waived' }, { amount: '2.00', settledLiquidacionId: 'liq-2' }],
    });
    await expect(service.waive('nope', 'x')).rejects.toThrow(NotFoundException);
    await expect(service.waive('pen-1', 'x')).rejects.toMatchObject({ response: { error: 'PENALTY_ALREADY_WAIVED' } });
    await expect(service.waive('pen-2', 'x')).rejects.toMatchObject({ response: { error: 'PENALTY_ALREADY_SETTLED' } });
  });

  it('si otro la cobró entre la lectura y la escritura, 409', async () => {
    const { service, client } = makeFakePenaltyDb({ penalties: [{ amount: '1.00' }] });
    client.penalty.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.waive('pen-1', 'x')).rejects.toThrow(ConflictException);
  });

  it('waiveAll condona las filas activas y sin cobrar hasta la fecha y audita una vez', async () => {
    const { service, penalties, client } = makeFakePenaltyDb({
      liquidaciones: [liq()],
      penalties: [
        { amount: '10.00', appliedOn: d('2026-03-12') },
        { amount: '20.00', appliedOn: d('2026-03-15') },
        { amount: '30.00', appliedOn: d('2026-03-18') },
        { amount: '40.00', appliedOn: d('2026-03-12'), settledLiquidacionId: 'liq-9' },
      ],
    });
    const result = await service.waiveAll('contract-1', d('2026-03-15'), 'bonificación');
    expect(result).toEqual({ waived: 2, total: '30.00', upTo: '2026-03-15' });
    expect(penalties.map((p) => p.status)).toEqual(['waived', 'waived', 'active', 'active']);
    expect(client.auditLog.create).toHaveBeenCalledTimes(1);
    expect(client.auditLog.create.mock.calls[0][0].data).toMatchObject({
      entity: 'Contract',
      entityId: 'contract-1',
      metadata: { source: 'waive-all', reason: 'bonificación', upTo: '2026-03-15', penaltyIds: ['pen-1', 'pen-2'] },
    });
  });

  it('waiveAll sin filas igual deja constancia, y 404 si el contrato no existe', async () => {
    const { service, client } = makeFakePenaltyDb({ liquidaciones: [liq()] });
    expect(await service.waiveAll('contract-1', d('2026-03-15'), 'x')).toMatchObject({ waived: 0, total: '0.00' });
    expect(client.penalty.updateMany).not.toHaveBeenCalled();
    const missing = makeFakePenaltyDb({ contractExists: false });
    await expect(missing.service.waiveAll('nope', d('2026-03-15'), 'x')).rejects.toThrow(NotFoundException);
  });
});

describe('PenaltiesService.accrueLocked', () => {
  it('sin saldo no registra nada', async () => {
    const { service, penalties } = makeFakePenaltyDb({
      liquidaciones: [liq({ payments: [{ amount: '1000', paidAt: d('2026-03-11') }] })],
    });
    const ctx = await service.loadContext('tenant-1', 'contract-1', d('2026-03-20'));
    expect(await service.accrueLocked('tenant-1', 'liq-1', ctx, d('2026-03-20'), 'cron')).toEqual({
      created: null,
      skipped: 'NO_BALANCE',
    });
    expect(penalties).toHaveLength(0);
  });

  it('404 si la liquidación desapareció', async () => {
    const { service } = makeFakePenaltyDb();
    const ctx = await service.loadContext('tenant-1', 'contract-1', d('2026-03-20'));
    await expect(service.accrueLocked('tenant-1', 'nope', ctx, d('2026-03-20'), 'cron')).rejects.toThrow(NotFoundException);
  });
});
