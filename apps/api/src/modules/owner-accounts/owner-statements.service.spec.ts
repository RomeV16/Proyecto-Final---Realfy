import { OperationalDefaultsSchema } from '@realfy/shared';
import Decimal from 'decimal.js';
import { PdfRendererService } from '../../common/pdf/pdf-renderer.service';
import { OwnerStatementPdfService, closingReading } from './owner-statement-pdf.service';
import { OwnerStatementsService } from './owner-statements.service';
import { day, fakeDb } from './owner-accounts.testing';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b1';
const P1 = 'prop-1';

const entry = (over: Record<string, unknown>) => ({
  tenantId: 't1',
  personId: A,
  currency: 'ARS',
  date: day('2026-10-08'),
  period: day('2026-10-01'),
  statementId: null,
  contractId: 'c1',
  propertyId: P1,
  sourceType: 'Payment',
  sourceId: 'pay-1',
  description: 'x',
  ...over,
});

/**
 * Locador A: en octubre un cobro (alquiler 100000, comisión −7000), saldo
 * inicial −1500 y 500 dólares; un gasto de reparación de 12000 a su cargo con
 * honorario por gestión del 10 %. Locador B: arrastra 200 del estado de
 * septiembre ya emitido.
 */
function setup(ownerAccounts: Record<string, unknown> = {}) {
  const db = fakeDb({
    persons: [
      { id: A, firstName: 'Ana', lastName: 'Locadora', cuit: '27-11111111-1' },
      { id: B, firstName: 'Beto', lastName: 'Dueño', dni: '22222222' },
    ],
    properties: [{ id: P1, title: 'Belgrano 100' }],
    contracts: [{ id: 'c1', propertyId: P1, status: 'Activo', startDate: day('2026-01-01'), commission: { repairMgmtFeePct: '10' } }],
    lessors: [{ id: 'l1', contractId: 'c1', personId: A, payoutPct: '100', validFrom: day('2026-01-01'), validTo: null }],
    entries: [
      entry({ type: 'Alquiler', amount: '100000.00' }),
      entry({ type: 'Comision', amount: '-7000.00' }),
      entry({
        type: 'SaldoInicial',
        amount: '-1500.00',
        date: day('2026-09-30'),
        period: day('2026-09-01'),
        sourceType: 'OpeningBalance',
        sourceId: 'ARS',
        contractId: null,
        propertyId: null,
      }),
      entry({ type: 'Alquiler', amount: '500.00', currency: 'USD', sourceId: 'pay-usd' }),
    ],
    statements: [
      {
        id: 'st-b-sep',
        tenantId: 't1',
        personId: B,
        period: day('2026-09-01'),
        currency: 'ARS',
        status: 'Emitido',
        opening: '0',
        credits: '200',
        debits: '0',
        payouts: '0',
        closing: '200.00',
      },
    ],
    charges: [
      {
        id: 'ch-1',
        tenantId: 't1',
        chargedTo: 'Locador',
        status: 'Pendiente',
        kind: 'Reparacion',
        lessorPersonId: null,
        contractId: 'c1',
        propertyId: P1,
        amount: '12000.00',
        currency: 'ARS',
        description: 'Cambio de canilla',
        incurredAt: day('2026-10-05'),
        targetPeriod: null,
        installmentNo: 1,
        installmentOf: 1,
        imputedStatementId: null,
      },
    ],
  });
  const defaults = OperationalDefaultsSchema.parse({ ownerAccounts });
  const audit = { record: jest.fn() };
  const cash = { balances: jest.fn(async (_db: any, ids: string[]) => new Map(ids.map((id) => [id, new Decimal(0)]))) };
  const service = new OwnerStatementsService(
    { client: db } as any,
    { getTenantId: () => 't1', getUserId: () => 'u1' } as any,
    audit as any,
    { get: jest.fn(async () => defaults) } as any,
    cash as any,
    new OwnerStatementPdfService(new PdfRendererService()),
  );
  const find = (personId: string, currency: string, period = '2026-10-01') =>
    db.ownerStatement.rows.find((s: any) => s.personId === personId && s.currency === currency && s.period.getTime() === day(period).getTime());
  return { db, service, audit, cash, find };
}

const totals = (s: any) => [s.status, s.opening, s.credits, s.debits, s.payouts, s.closing];

describe('OwnerStatementsService — generar (CP-456)', () => {
  it('un borrador por locador y moneda con movimientos o saldo; el cargo se asienta y queda ligado al estado', async () => {
    const { service, db, find, audit } = setup();
    const res = await service.generate({ period: '2026-10' });
    expect(res).toMatchObject({ period: '2026-10', created: 3, updated: 0, skipped: [], chargesPosted: 1 });
    // A ARS: apertura −1500 (saldo inicial); créditos 100000; débitos 7000 + 12000 + 1200; cierre 78300.
    expect(totals(find(A, 'ARS'))).toEqual(['Borrador', '-1500.00', '100000.00', '20200.00', '0.00', '78300.00']);
    expect(totals(find(A, 'USD'))).toEqual(['Borrador', '0.00', '500.00', '0.00', '0.00', '500.00']);
    // B no tuvo movimientos, pero arrastra el saldo de septiembre.
    expect(totals(find(B, 'ARS'))).toEqual(['Borrador', '200.00', '0.00', '0.00', '0.00', '200.00']);
    const charge = db.pendingCharge.rows[0];
    expect(charge).toMatchObject({ status: 'Imputado', imputedStatementId: find(A, 'ARS').id });
    expect(
      db.ownerLedgerEntry.rows.filter((e: any) => e.sourceType === 'PendingCharge').map((e: any) => [e.type, e.amount, e.period]),
    ).toEqual([
      ['Cargo', '-12000.00', day('2026-10-01')],
      ['Honorario', '-1200.00', day('2026-10-01')],
    ]);
    expect(audit.record).toHaveBeenCalledWith(db, expect.objectContaining({ metadata: expect.objectContaining({ operation: 'owner-statements-generate' }) }));

    // Volver a generar recalcula los borradores sin duplicar el cargo.
    db.ownerLedgerEntry.rows.push(entry({ type: 'Punitorio', amount: '300.00', sourceId: 'pay-2' }));
    const again = await service.generate({ period: '2026-10' });
    expect(again).toMatchObject({ created: 0, updated: 3, chargesPosted: 0 });
    expect(find(A, 'ARS').closing).toBe('78600.00');
  });

  it('solo un locador si se indica', async () => {
    const { service, find } = setup();
    const res = await service.generate({ period: '2026-10', personId: B });
    expect(res.created).toBe(1);
    expect(find(A, 'ARS')).toBeUndefined();
  });

  it('con los cargos al emitir, el borrador los muestra como previstos y no los asienta', async () => {
    const { service, db, find } = setup({ lessorChargeTiming: 'AlEmitirEstado' });
    await service.generate({ period: '2026-10' });
    expect(find(A, 'ARS').closing).toBe('78300.00');
    expect(db.pendingCharge.rows[0].status).toBe('Pendiente');
    expect(db.ownerLedgerEntry.rows.some((e: any) => e.sourceType === 'PendingCharge')).toBe(false);
    const detail = await service.findOne(find(A, 'ARS').id);
    const provisional = detail.groups.flatMap((g: any) => g.entries).filter((e: any) => e.provisional);
    expect(provisional.map((e: any) => [e.type, e.amount])).toEqual([
      ['Cargo', '-12000.00'],
      ['Honorario', '-1200.00'],
    ]);
    // Al emitir se asientan y quedan en el estado.
    const issued = await service.issue(find(A, 'ARS').id);
    expect(issued.closing).toBe('78300.00');
    expect(db.pendingCharge.rows[0]).toMatchObject({ status: 'Imputado', imputedStatementId: find(A, 'ARS').id });
    expect(db.ownerLedgerEntry.rows.filter((e: any) => e.sourceType === 'PendingCharge').every((e: any) => e.statementId === find(A, 'ARS').id)).toBe(true);
  });

  it('valida el mes', async () => {
    await expect(setup().service.generate({ period: '2026-13' })).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
  });
});

describe('OwnerStatementsService — emitir, arrastrar y anular (CP-457)', () => {
  it('emitir bloquea los asientos; el mes siguiente arranca del cierre; no se regenera ni se emite dos veces', async () => {
    const { service, db, find } = setup();
    await service.generate({ period: '2026-10' });
    const oct = find(A, 'ARS');
    const issued = await service.issue(oct.id);
    expect(issued).toMatchObject({ status: 'Emitido', closing: '78300.00', person: { name: 'Ana Locadora' } });
    const locked = db.ownerLedgerEntry.rows.filter((e: any) => e.statementId === oct.id);
    expect(locked).toHaveLength(5);
    await expect(service.issue(oct.id)).rejects.toMatchObject({ response: { error: 'STATEMENT_NOT_DRAFT' } });

    const again = await service.generate({ period: '2026-10' });
    expect(again.skipped).toContainEqual({ personId: A, currency: 'ARS', reason: 'STATEMENT_ALREADY_ISSUED' });

    // Noviembre: una transferencia de 78300 deja el saldo en cero.
    db.ownerLedgerEntry.rows.push(
      entry({ type: 'Transferencia', amount: '-78300.00', date: day('2026-11-12'), period: day('2026-11-01'), sourceType: 'CashMovement', sourceId: 'm1' }),
    );
    await service.generate({ period: '2026-11' });
    expect(totals(find(A, 'ARS', '2026-11-01'))).toEqual(['Borrador', '78300.00', '0.00', '0.00', '78300.00', '0.00']);

    // Un mes anterior al último emitido ya no se genera.
    const sep = await service.generate({ period: '2026-09', personId: A });
    expect(sep.skipped).toContainEqual({ personId: A, currency: 'ARS', reason: 'STATEMENT_PERIOD_CLOSED' });
  });

  it('anular libera los asientos; solo el último emitido; uno anulado se puede volver a generar', async () => {
    const { service, db, find } = setup();
    await service.generate({ period: '2026-10' });
    const oct = find(A, 'ARS');
    await service.issue(oct.id);
    await service.generate({ period: '2026-11' });
    const nov = find(A, 'ARS', '2026-11-01');
    await service.issue(nov.id);
    await expect(service.annul(oct.id, { reason: 'error de carga' })).rejects.toMatchObject({ response: { error: 'STATEMENT_NOT_LATEST' } });
    await expect(service.annul(nov.id, { reason: '' })).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });

    const annulledNov = await service.annul(nov.id, { reason: 'se emitió antes de tiempo' });
    expect(annulledNov).toMatchObject({ status: 'Anulado', annulReason: 'se emitió antes de tiempo' });
    const annulled = await service.annul(oct.id, { reason: 'faltaba un gasto' });
    expect(annulled.status).toBe('Anulado');
    expect(db.ownerLedgerEntry.rows.every((e: any) => e.statementId === null)).toBe(true);
    // El cargo asentado sigue en la cuenta corriente.
    expect(db.pendingCharge.rows[0].status).toBe('Imputado');
    await expect(service.annul(oct.id, { reason: 'otra vez' })).rejects.toMatchObject({ response: { error: 'STATEMENT_ALREADY_ANNULLED' } });

    const regen = await service.generate({ period: '2026-10', personId: A });
    expect(regen.updated).toBe(2);
    expect(find(A, 'ARS').status).toBe('Borrador');
  });

  it('no emite un mes anterior al último emitido', async () => {
    const { service, db, find } = setup();
    await service.generate({ period: '2026-10', personId: A });
    const oct = find(A, 'ARS');
    db.ownerStatement.rows.push({ ...oct, id: 'st-nov', period: day('2026-11-01'), status: 'Emitido', closing: '0' });
    await expect(service.issue(oct.id)).rejects.toMatchObject({ response: { error: 'STATEMENT_PERIOD_CLOSED' } });
  });

  it('si los asientos cambiaron mientras se emitía, no emite', async () => {
    const { service, db, find } = setup();
    await service.generate({ period: '2026-10', personId: A });
    db.ownerLedgerEntry.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.issue(find(A, 'ARS').id)).rejects.toMatchObject({ response: { error: 'STATEMENT_CHANGED' } });
  });

  it('un estado que no existe es 404', async () => {
    const { service, db } = setup();
    await expect(service.findOne('nope')).rejects.toMatchObject({ response: { error: 'STATEMENT_NOT_FOUND' } });
    db.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.issue('nope')).rejects.toMatchObject({ response: { error: 'STATEMENT_NOT_FOUND' } });
  });
});

describe('OwnerStatementsService — lectura y PDF (CP-458)', () => {
  it('detalle de un emitido: movimientos por unidad, lo general al final, totales y período', async () => {
    const { service, find, cash } = setup();
    cash.balances.mockResolvedValue(new Map([['cust-a', new Decimal('5000')]]));
    await service.generate({ period: '2026-10', personId: A });
    await service.issue(find(A, 'ARS').id);
    const detail = await service.findOne(find(A, 'ARS').id);
    expect(detail.totals).toEqual({
      opening: '-1500.00',
      initial: '-1500.00',
      credits: '100000.00',
      debits: '20200.00',
      payouts: '0.00',
      closing: '78300.00',
    });
    expect(detail.groups.map((g: any) => [g.label, g.net, g.entries.length])).toEqual([['Belgrano 100', '79800.00', 4]]);
    expect([detail.from, detail.to]).toEqual([day('2026-10-01'), day('2026-10-31')]);
    expect(detail.custody).toBe('0.00');
  });

  it('lista con filtros y paginado', async () => {
    const { service, db } = setup();
    await service.generate({ period: '2026-10' });
    const res = await service.list({ period: '2026-10', currency: 'ARS', status: 'Borrador' });
    expect(res.total).toBe(2);
    expect(res.items[0]).toMatchObject({ period: day('2026-10-01'), currency: 'ARS', status: 'Borrador' });
    expect(db.ownerStatement.findMany.mock.calls.at(-1)[0].where).toEqual({ period: day('2026-10-01'), currency: 'ARS', status: 'Borrador' });
  });

  it('PDF del borrador con nombre de archivo del locador, mes y moneda', async () => {
    const { service, find } = setup();
    await service.generate({ period: '2026-10' });
    const { buffer, filename } = await service.pdf(find(A, 'ARS').id);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(filename).toBe('estado-de-cuenta-ana-locadora-2026-10-ARS.pdf');
    const empty = await service.pdf(find(B, 'ARS').id);
    expect(empty.buffer.length).toBeGreaterThan(0);
  });

  it('el saldo de cierre se lee desde el locador', () => {
    expect(closingReading('1500', 'ARS')).toBe('Saldo a su favor: la inmobiliaria le debe ARS 1.500,00.');
    expect(closingReading('-20.5', 'USD')).toBe('Saldo a favor de la inmobiliaria: usted le debe USD 20,50.');
    expect(closingReading('0', 'ARS')).toBe('Sin saldo pendiente.');
  });
});
