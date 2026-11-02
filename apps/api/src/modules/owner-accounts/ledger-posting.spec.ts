import { pendingLessorCharges } from './lessor-charges';
import { removeEntries, syncServiceBillEntries, writeEntries } from './ledger-posting';
import { day, fakeDb } from './owner-accounts.testing';

const ctx = { tenantId: 't1', closeDay: null, userId: 'u1' };

const bill = (over: Record<string, unknown> = {}) => ({
  id: 'bill-1',
  status: 'Pagada',
  paidBy: 'Inmobiliaria',
  paidAt: day('2026-10-12'),
  period: day('2026-10-01'),
  currency: 'ARS',
  installmentLabel: '10/2026',
  ...over,
});

function billDb() {
  return fakeDb({
    contracts: [
      { id: 'c1', propertyId: 'p1' },
      { id: 'c2', propertyId: 'p2' },
    ],
    lessors: [
      { contractId: 'c1', personId: 'A', payoutPct: '50', validFrom: day('2026-01-01'), validTo: null },
      { contractId: 'c1', personId: 'B', payoutPct: '50', validFrom: day('2026-01-01'), validTo: null },
      { contractId: 'c2', personId: 'A', payoutPct: '100', validFrom: day('2026-01-01'), validTo: null },
    ],
    allocations: [
      { billId: 'bill-1', contractId: 'c1', payer: 'Propietario', amount: '1000.01' },
      { billId: 'bill-1', contractId: 'c2', payer: 'Propietario', amount: '500.00' },
      { billId: 'bill-1', contractId: 'c2', payer: 'Inmobiliaria', amount: '999.00' },
    ],
  });
}

describe('asientos de una boleta que pagó la inmobiliaria por el locador (CP-462)', () => {
  it('PagoEnte por locador según su parte; suma las de varias unidades', async () => {
    const db = billDb();
    await syncServiceBillEntries(db, ctx, bill());
    // c1: 1000.01 -> A 500.01, B 500.00 · c2 (A 100 %): 500 -> A 1000.01 en total
    expect(db.ownerLedgerEntry.rows.map((e: any) => [e.personId, e.type, e.amount, e.contractId, e.propertyId])).toEqual([
      ['A', 'PagoEnte', '-1000.01', null, null],
      ['B', 'PagoEnte', '-500.00', 'c1', 'p1'],
    ]);
    // Repetir con lo mismo no cambia nada.
    await syncServiceBillEntries(db, ctx, bill());
    expect(db.ownerLedgerEntry.rows).toHaveLength(2);
  });

  it('si deja de estar pagada por la inmobiliaria se borran; con un estado emitido se rechaza', async () => {
    const db = billDb();
    await syncServiceBillEntries(db, ctx, bill());
    await syncServiceBillEntries(db, ctx, bill({ paidBy: 'Propietario' }));
    expect(db.ownerLedgerEntry.rows).toEqual([]);
    await syncServiceBillEntries(db, ctx, bill());
    db.ownerLedgerEntry.rows[0].statementId = 'st-1';
    await expect(syncServiceBillEntries(db, ctx, bill({ status: 'Pendiente' }))).rejects.toMatchObject({
      response: { error: 'OWNER_LEDGER_LOCKED' },
    });
  });

  it('una boleta sin asientos que no pagó la inmobiliaria no escribe nada', async () => {
    const db = billDb();
    await syncServiceBillEntries(db, ctx, bill({ paidBy: 'Inquilino' }));
    expect(db.ownerLedgerEntry.createMany).not.toHaveBeenCalled();
  });
});

describe('writeEntries / removeEntries', () => {
  it('omite los de importe cero y los repetidos; borrar sin nada no consulta', async () => {
    const db = fakeDb();
    const e = { personId: 'A', type: 'Ajuste' as any, currency: 'ARS', date: day('2026-10-05'), description: 'x', sourceType: 'T', sourceId: '1' };
    expect(await writeEntries(db, ctx, [{ ...e, amount: '0' }])).toBe(0);
    expect(await writeEntries(db, ctx, [{ ...e, amount: '10' }])).toBe(1);
    expect(await writeEntries(db, ctx, [{ ...e, amount: '10' }])).toBe(0);
    expect(await removeEntries(db, 'T', [])).toBe(0);
    expect(await removeEntries(db, 'T', ['1'])).toBe(1);
  });
});

describe('cargos al locador del centro de carga (CP-463)', () => {
  const charge = (over: Record<string, unknown>) => ({
    chargedTo: 'Locador',
    status: 'Pendiente',
    kind: 'Reparacion',
    lessorPersonId: null,
    contractId: null,
    propertyId: 'p1',
    amount: '1000.00',
    currency: 'ARS',
    description: 'Pintura',
    incurredAt: day('2026-10-05'),
    targetPeriod: null,
    installmentNo: 1,
    installmentOf: 1,
    ...over,
  });

  it('quién lo soporta: el indicado, los del contrato, los del último contrato de la unidad o sus titulares', async () => {
    const db = fakeDb({
      charges: [
        charge({ id: 'x1', lessorPersonId: 'Z' }),
        charge({ id: 'x2', contractId: 'c1', amount: '-300.00', kind: 'Devolucion' }),
        charge({ id: 'x3', propertyId: 'p2', installmentNo: 2, installmentOf: 3 }),
        charge({ id: 'x4', propertyId: 'p3' }),
        charge({ id: 'x5', propertyId: 'p9' }),
        charge({ id: 'x6', targetPeriod: day('2026-11-01') }),
      ],
      contracts: [
        { id: 'c1', propertyId: 'p1', status: 'Activo', startDate: day('2026-01-01'), commission: null },
        { id: 'c2', propertyId: 'p2', status: 'Finalizado', startDate: day('2025-01-01'), commission: { repairMgmtFeePct: '10' } },
      ],
      lessors: [
        { contractId: 'c1', personId: 'A', payoutPct: '60', validFrom: day('2026-01-01'), validTo: null },
        { contractId: 'c1', personId: 'B', payoutPct: '40', validFrom: day('2026-01-01'), validTo: null },
        { contractId: 'c2', personId: 'C', payoutPct: '100', validFrom: day('2025-01-01'), validTo: null },
      ],
      ownerships: [
        { propertyId: 'p3', personId: 'D', sharePct: null, since: null, until: null },
        { propertyId: 'p3', personId: 'E', sharePct: null, since: day('2027-01-01'), until: null },
      ],
    });
    const postings = await pendingLessorCharges(db, { period: day('2026-10-01'), closeDay: null });
    const table = postings.map((p) => [p.chargeId, p.entries.map((e) => [e.personId, e.type, e.amount, e.description])]);
    expect(table).toEqual([
      ['x1', [['Z', 'Cargo', '-1000.00', 'Pintura']]],
      // Un crédito al locador suma; sin honorario por gestión.
      ['x2', [['A', 'Cargo', '180.00', 'Pintura'], ['B', 'Cargo', '120.00', 'Pintura']]],
      // Unidad sin contrato vigente: el último contrato; pacta 10 % de honorario por gestión.
      [
        'x3',
        [
          ['C', 'Cargo', '-1000.00', 'Pintura (cuota 2/3)'],
          ['C', 'Honorario', '-100.00', 'Honorario por gestión (10 %): Pintura (cuota 2/3)'],
        ],
      ],
      // Sin contratos: los titulares a la fecha.
      ['x4', [['D', 'Cargo', '-1000.00', 'Pintura']]],
    ]);
    // x5 (nadie lo soporta) y x6 (se imputa en noviembre) quedan pendientes.
  });
});
