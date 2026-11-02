import { CommissionType, LineBeneficiary as B, LineItemType as L, OwnerLedgerEntryType as T, PaymentReceiver } from '../enums';
import { LessorDirectOwes, settlePayment } from '../settlement-engine';
import type { SettlementInput, SettlementResult } from '../settlement-engine';
import {
  computeStatement,
  ledgerTypeForLine,
  paymentPostings,
  repairManagementFee,
  splitByShare,
  statementPeriodFor,
  statementPeriodRange,
  statementsByCurrency,
} from './index';
import type { LedgerPosting, StatementEntry } from './index';

/**
 * Casos "golden": los valores esperados se calcularon a mano antes de correr
 * la prueba (el cálculo está en el comentario de cada caso).
 *
 * Liquidación base (la misma de settlement-engine, ARS):
 *   Alquiler 100000 (locador, comisionable) + Multa 3000 (locador, comisionable)
 *   + Servicio 1500 (locador, reintegro) + Impuesto 5000 (ente) + Honorario 2000 (inmobiliaria)
 *   Comisión 7 % de 103000 = 7210 · Locadores 104500 − 7210 = 97290
 *   A 50 %, B 30 %, C 20 % -> 48645 / 29187 / 19458
 */
const LINES = [
  { amount: '100000', beneficiary: B.Locador, commissionable: true, type: L.Alquiler },
  { amount: '3000', beneficiary: B.Locador, commissionable: true, type: L.Multa },
  { amount: '1500', beneficiary: B.Locador, commissionable: false, type: L.Servicio },
  { amount: '5000', beneficiary: B.Ente, commissionable: false, type: L.Impuesto },
  { amount: '2000', beneficiary: B.Inmobiliaria, commissionable: false, type: L.Honorario },
];
const LESSORS = [
  { personId: 'A', payoutPct: '50' },
  { personId: 'B', payoutPct: '30' },
  { personId: 'C', payoutPct: '20' },
];

const settle = (over: Partial<SettlementInput> = {}) =>
  settlePayment({
    currency: 'ARS',
    lines: LINES,
    commission: { type: CommissionType.FixedPercent, percentage: '7' },
    lessors: LESSORS,
    amount: '111500',
    receivedBy: PaymentReceiver.Inmobiliaria,
    ...over,
  });

const post = (r: SettlementResult) =>
  paymentPostings({
    flow: r.flow,
    lines: LINES,
    buckets: r.buckets,
    positions: r.positions.map((p) => ({ personId: p.personId, share: p.share, received: p.received, balance: p.balance })),
  });

const table = (postings: LedgerPosting[], personId: string) =>
  Object.fromEntries(postings.filter((p) => p.personId === personId).map((p) => [p.type, p.amount.toFixed(2)]));

const sumFor = (postings: LedgerPosting[], personId: string) =>
  postings
    .filter((p) => p.personId === personId)
    .reduce((acc, p) => acc + Number(p.amount.toFixed(2)) * 100, 0) / 100;

describe('ledgerTypeForLine', () => {
  it('alquiler, ajustes y descuentos son alquiler; la multa es punitorio; impuestos y servicios, reintegro', () => {
    expect([L.Alquiler, L.Ajuste, L.AjusteRetroactivo, L.Descuento].map(ledgerTypeForLine)).toEqual([
      T.Alquiler,
      T.Alquiler,
      T.Alquiler,
      T.Alquiler,
    ]);
    expect(ledgerTypeForLine(L.Multa)).toBe(T.Punitorio);
    expect([L.Impuesto, L.Servicio].map(ledgerTypeForLine)).toEqual([T.ReintegroImpuesto, T.ReintegroImpuesto]);
    expect([L.Extra, L.Cargo, L.Honorario].map(ledgerTypeForLine)).toEqual([T.Ajuste, T.Ajuste, T.Ajuste]);
  });
});

describe('paymentPostings — flujo (a): cobra la inmobiliaria', () => {
  it('cobro completo: cada locador recibe su parte bruta por concepto menos la comisión', () => {
    // A (50 %): 50000 + 1500 + 750 − 3605 = 48645
    // B (30 %): 30000 + 900 + 450 − 2163 = 29187
    // C (20 %): 20000 + 600 + 300 − 1442 = 19458
    const postings = post(settle());
    expect(table(postings, 'A')).toEqual({
      Alquiler: '50000.00',
      Punitorio: '1500.00',
      ReintegroImpuesto: '750.00',
      Comision: '-3605.00',
    });
    expect(table(postings, 'B')).toEqual({
      Alquiler: '30000.00',
      Punitorio: '900.00',
      ReintegroImpuesto: '450.00',
      Comision: '-2163.00',
    });
    expect(sumFor(postings, 'C')).toBe(19458);
    expect(postings.some((p) => p.type === T.CobroDirecto)).toBe(false);
  });

  it('dos cobros parciales: el centavo de redondeo va al alquiler y la suma da la del cobro completo', () => {
    // Primer cobro 50000: locadores cubren 43627.80 -> A 21813.90 · B 13088.34 · C 8725.56
    //   A: 100000×21813.90/97290 = 22421.52 · 3000×… = 672.65 · 1500×… = 336.32 · −7210×… = −1616.59 (suma 21813.90)
    //   B: 13452.91 + 403.59 + 201.79 − 969.96 = 13088.33 -> el centavo que falta va al alquiler: 13452.92
    const first = post(settle({ amount: '50000' }));
    expect(table(first, 'A')).toEqual({
      Alquiler: '22421.52',
      Punitorio: '672.65',
      ReintegroImpuesto: '336.32',
      Comision: '-1616.59',
    });
    expect(table(first, 'B')).toMatchObject({ Alquiler: '13452.92', Comision: '-969.96' });
    // Segundo cobro 61500 (el resto): A 26831.10 · B 16098.66 · C 10732.44
    //   B: 16547.09 + 496.41 + 248.21 − 1193.04 = 16098.67 -> el alquiler baja un centavo: 16547.08
    const second = post(settle({ amount: '61500', paidBefore: '50000' }));
    expect(table(second, 'A')).toEqual({
      Alquiler: '27578.48',
      Punitorio: '827.35',
      ReintegroImpuesto: '413.68',
      Comision: '-1988.41',
    });
    expect(table(second, 'B')).toMatchObject({ Alquiler: '16547.08' });
    // Los dos cobros juntos son el cobro completo.
    const all = [...first, ...second];
    expect(sumFor(all, 'A')).toBe(48645);
    expect(sumFor(all, 'B')).toBe(29187);
    expect(sumFor(all, 'C')).toBe(19458);
    const alquilerB = all.filter((p) => p.personId === 'B' && p.type === T.Alquiler);
    expect(alquilerB.reduce((acc, p) => acc + Number(p.amount), 0)).toBeCloseTo(30000, 2);
  });

  it('los gastos administrativos van como honorario negativo', () => {
    // Comisión 7 % de 103000 = 7210 + gastos 1000 -> locadores 96290; un solo locador.
    const r = settle({
      commission: { type: CommissionType.FixedPercent, percentage: '7', adminFee: '1000' },
      lessors: [{ personId: 'A', payoutPct: '100' }],
    });
    const postings = post(r);
    expect(table(postings, 'A')).toEqual({
      Alquiler: '100000.00',
      Punitorio: '3000.00',
      ReintegroImpuesto: '1500.00',
      Comision: '-7210.00',
      Honorario: '-1000.00',
    });
    expect(sumFor(postings, 'A')).toBe(96290);
  });
});

describe('paymentPostings — flujo (c): custodia', () => {
  it('los asientos son los mismos que si cobrara la inmobiliaria: la custodia es dinero del locador que ella guarda', () => {
    const custody = post(settle({ inCustody: true }));
    const agency = post(settle());
    expect(custody.map((p) => [p.personId, p.type, p.amount.toFixed(2)])).toEqual(
      agency.map((p) => [p.personId, p.type, p.amount.toFixed(2)]),
    );
  });
});

describe('paymentPostings — flujo (b): cobra el locador', () => {
  it('todo lo ajeno: muestra lo bruto y lo cobrado en mano; el saldo es lo que le debe a la inmobiliaria', () => {
    // Le deben a la inmobiliaria 9210 + 5000 = 14210 -> A 7105 · B 4263 · C 2842
    // A recibió 48645 + 7105 = 55750: créditos 52250, comisión −3605, cobrado −55750 -> saldo −7105
    const postings = post(settle({ receivedBy: PaymentReceiver.Locador }));
    expect(table(postings, 'A')).toEqual({
      Alquiler: '50000.00',
      Punitorio: '1500.00',
      ReintegroImpuesto: '750.00',
      Comision: '-3605.00',
      CobroDirecto: '-55750.00',
    });
    expect(sumFor(postings, 'A')).toBe(-7105);
    expect(sumFor(postings, 'B')).toBe(-4263);
    expect(sumFor(postings, 'C')).toBe(-2842);
    const direct = postings.find((p) => p.personId === 'A' && p.type === T.CobroDirecto)!;
    expect([direct.received!.toFixed(2), direct.keptForEnte!.toFixed(2)]).toEqual(['55750.00', '0.00']);
  });

  it('solo lo de la inmobiliaria: lo retenido para pagar entes no cuenta como cobrado para la inmobiliaria', () => {
    // Debe 9210 -> A 4605; retiene para entes 5000 -> A 2500; recibió 48645 + 4605 + 2500 = 55750
    // Cobrado directo = −(55750 − 2500) = −53250 -> saldo 48645 − 53250 = −4605
    const postings = post(
      settle({ receivedBy: PaymentReceiver.Locador, options: { lessorDirectOwes: LessorDirectOwes.SoloInmobiliaria } }),
    );
    const direct = postings.find((p) => p.personId === 'A' && p.type === T.CobroDirecto)!;
    expect([direct.amount.toFixed(2), direct.received!.toFixed(2), direct.keptForEnte!.toFixed(2)]).toEqual([
      '-53250.00',
      '55750.00',
      '2500.00',
    ]);
    expect(sumFor(postings, 'A')).toBe(-4605);
  });

  it('cobró uno solo por todos: él debe todo lo ajeno y los demás quedan con su parte a favor', () => {
    // A recibió 111500: saldo 48645 − 111500 = −62855; B +29187, C +19458 (la inmobiliaria se los debe)
    const postings = post(settle({ receivedBy: PaymentReceiver.Locador, receiverPersonId: 'A' }));
    expect(table(postings, 'A').CobroDirecto).toBe('-111500.00');
    expect(sumFor(postings, 'A')).toBe(-62855);
    expect(sumFor(postings, 'B')).toBe(29187);
    expect(table(postings, 'B').CobroDirecto).toBeUndefined();
  });

  it('un tercero que cobró sin ser locador del contrato solo tiene el cobro directo', () => {
    const postings = post(settle({ receivedBy: PaymentReceiver.Locador, receiverPersonId: 'Z' }));
    expect(table(postings, 'Z')).toEqual({ CobroDirecto: '-111500.00' });
  });
});

describe('paymentPostings — bordes', () => {
  it('sin parte neta de los locadores, una parte distinta de cero va como ajuste', () => {
    const postings = paymentPostings({
      flow: 'Inmobiliaria',
      lines: [],
      buckets: { commission: 0, adminFee: 0, lessors: 0 },
      positions: [{ personId: 'A', share: '10', balance: '10' }],
    });
    expect(table(postings, 'A')).toEqual({ Ajuste: '10.00' });
  });

  it('una parte de cero no deja asientos', () => {
    const postings = paymentPostings({
      flow: 'Inmobiliaria',
      lines: LINES,
      buckets: { commission: 7210, adminFee: 0, lessors: 97290 },
      positions: [{ personId: 'A', share: 0, balance: 0 }],
    });
    expect(postings).toEqual([]);
  });
});

describe('splitByShare y honorario por gestión', () => {
  it('reparte con signo por mayor resto; sin porcentajes, en partes iguales', () => {
    expect(splitByShare('-100', [{ personId: 'A', pct: 50 }, { personId: 'B', pct: 50 }]).map((x) => x.amount.toFixed(2))).toEqual([
      '-50.00',
      '-50.00',
    ]);
    expect(
      splitByShare('100', [{ personId: 'A' }, { personId: 'B' }, { personId: 'C' }]).map((x) => x.amount.toFixed(2)),
    ).toEqual(['33.34', '33.33', '33.33']);
    expect(splitByShare('10', [])).toEqual([]);
  });

  it('honorario por gestión: porcentaje sobre el valor absoluto, nada sin porcentaje', () => {
    expect(repairManagementFee('-12345.67', '10').toFixed(2)).toBe('1234.57');
    expect(repairManagementFee('1000', null).toFixed(2)).toBe('0.00');
  });
});

describe('períodos del estado', () => {
  it('sin día de cierre, el mes calendario', () => {
    expect(statementPeriodFor('2026-10-31T00:00:00Z', null).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(statementPeriodRange('2026-02-01T00:00:00Z', null)).toEqual({
      from: new Date('2026-02-01T00:00:00Z'),
      to: new Date('2026-02-28T00:00:00Z'),
    });
  });

  it('con cierre el día 10, lo del 11 en adelante va al mes siguiente', () => {
    expect(statementPeriodFor('2026-10-10T00:00:00Z', 10).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(statementPeriodFor('2026-10-11T00:00:00Z', 10).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(statementPeriodFor('2026-12-20T00:00:00Z', 10).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    expect(statementPeriodRange('2026-11-01T00:00:00Z', 10)).toEqual({
      from: new Date('2026-10-11T00:00:00Z'),
      to: new Date('2026-11-10T00:00:00Z'),
    });
  });
});

type E = StatementEntry & { currency: string; id: string };
const entry = (id: string, type: T, amount: string, over: Partial<E> = {}): E => ({
  id,
  type,
  amount,
  currency: 'ARS',
  date: '2026-10-05T00:00:00Z',
  ...over,
});

describe('computeStatement', () => {
  it('saldo inicial: entra en la apertura y no en los movimientos', () => {
    // Apertura 0 + inicial −1500 (el locador debía) = −1500; alquiler 100000, comisión −7000,
    // transferencia −50000 -> cierre −1500 + 100000 − 7000 − 50000 = 41500
    const r = computeStatement({
      entries: [
        entry('1', T.SaldoInicial, '-1500', { date: '2026-10-01T00:00:00Z' }),
        entry('2', T.Alquiler, '100000', { propertyId: 'P1', groupLabel: 'Belgrano 100' }),
        entry('3', T.Comision, '-7000', { propertyId: 'P1', groupLabel: 'Belgrano 100' }),
        entry('4', T.Transferencia, '-50000', { date: '2026-10-20T00:00:00Z' }),
      ],
    });
    expect([r.opening, r.initial, r.credits, r.debits, r.payouts, r.closing].map((v) => v.toFixed(2))).toEqual([
      '-1500.00',
      '-1500.00',
      '100000.00',
      '7000.00',
      '50000.00',
      '41500.00',
    ]);
    expect(r.groups.map((g) => [g.label, g.entries.map((e) => e.id)])).toEqual([
      ['Belgrano 100', ['2', '3']],
      [null, ['4']],
    ]);
  });

  it('varias unidades: un grupo por unidad, ordenadas por nombre, con su neto; lo general al final', () => {
    // Unidad Z: 80000 − 5600 = 74400 · Unidad A: 50000 − 3500 − cargo 12000 = 34500
    // Pagos: entrega de efectivo 30000 y cobrado directo 20000 (en A) -> pagos 50000
    // Cierre: 0 + 130000 − 21100 − 50000 = 58900
    const r = computeStatement({
      previousClosing: 0,
      entries: [
        entry('z1', T.Alquiler, '80000', { propertyId: 'PZ', groupLabel: 'Zapiola 9' }),
        entry('z2', T.Comision, '-5600', { propertyId: 'PZ', groupLabel: 'Zapiola 9' }),
        entry('a1', T.Alquiler, '50000', { propertyId: 'PA', groupLabel: 'Arenales 1' }),
        entry('a2', T.Comision, '-3500', { propertyId: 'PA', groupLabel: 'Arenales 1' }),
        entry('a3', T.Cargo, '-12000', { propertyId: 'PA', groupLabel: 'Arenales 1', date: '2026-10-03T00:00:00Z' }),
        entry('a4', T.CobroDirecto, '-20000', { propertyId: 'PA', groupLabel: 'Arenales 1' }),
        entry('g1', T.EntregaEfectivo, '-30000', { date: '2026-10-25T00:00:00Z' }),
      ],
    });
    expect(r.groups.map((g) => [g.label, g.credits.toFixed(2), g.debits.toFixed(2), g.payouts.toFixed(2), g.net.toFixed(2)])).toEqual([
      ['Arenales 1', '50000.00', '15500.00', '20000.00', '14500.00'],
      ['Zapiola 9', '80000.00', '5600.00', '0.00', '74400.00'],
      [null, '0.00', '0.00', '30000.00', '-30000.00'],
    ]);
    // Dentro de un grupo, por fecha: el cargo del día 3 va primero.
    expect(r.groups[0].entries.map((e) => e.id)).toEqual(['a3', 'a1', 'a2', 'a4']);
    expect([r.credits, r.debits, r.payouts, r.closing].map((v) => v.toFixed(2))).toEqual([
      '130000.00',
      '21100.00',
      '50000.00',
      '58900.00',
    ]);
    expect(r.byType[T.Comision]!.toFixed(2)).toBe('-9100.00');
  });

  it('saldo arrastrado: el cierre de un mes es la apertura del siguiente', () => {
    // Octubre: 0 + 100000 − 7000 = 93000 (no se pagó)
    // Noviembre: 93000 + 100000 − 7000 − transferencia 186000 = 0
    const oct = computeStatement({
      entries: [entry('1', T.Alquiler, '100000'), entry('2', T.Comision, '-7000')],
    });
    const nov = computeStatement({
      previousClosing: oct.closing,
      entries: [
        entry('3', T.Alquiler, '100000', { date: '2026-11-05T00:00:00Z' }),
        entry('4', T.Comision, '-7000', { date: '2026-11-05T00:00:00Z' }),
        entry('5', T.Transferencia, '-186000', { date: '2026-11-15T00:00:00Z' }),
      ],
    });
    expect(oct.closing.toFixed(2)).toBe('93000.00');
    expect([nov.opening, nov.closing].map((v) => v.toFixed(2))).toEqual(['93000.00', '0.00']);
  });

  it('un mes sin movimientos repite el saldo', () => {
    const r = computeStatement({ previousClosing: '-250.50', entries: [] });
    expect([r.opening, r.closing].map((v) => v.toFixed(2))).toEqual(['-250.50', '-250.50']);
    expect(r.groups).toEqual([]);
  });

  it('los cuatro flujos de un mismo alquiler en el estado de A', () => {
    // (a) A: +48645 · (c) A: +48645 (en custodia) · (b) A: −7105 · un pago de 48645 a A
    // Cierre: 48645 + 48645 − 7105 − 48645 = 41540
    const asEntries = (postings: LedgerPosting[], tag: string) =>
      postings
        .filter((p) => p.personId === 'A')
        .map((p, i) => entry(`${tag}${i}`, p.type, p.amount.toFixed(2), { propertyId: 'P1', groupLabel: 'Unidad 1' }));
    const r = computeStatement({
      entries: [
        ...asEntries(post(settle()), 'a'),
        ...asEntries(post(settle({ inCustody: true })), 'c'),
        ...asEntries(post(settle({ receivedBy: PaymentReceiver.Locador })), 'b'),
        entry('pay', T.Transferencia, '-48645'),
      ],
    });
    // Créditos 3 × 52250; débitos 3 × 3605; pagos 55750 + 48645
    expect([r.credits, r.debits, r.payouts, r.closing].map((v) => v.toFixed(2))).toEqual([
      '156750.00',
      '10815.00',
      '104395.00',
      '41540.00',
    ]);
  });
});

describe('statementsByCurrency', () => {
  it('un estado por moneda, cada uno con su cierre anterior; nunca suma monedas', () => {
    // ARS: 1000 + 500 = 1500 · USD: 200 − 50 = 150 · EUR: solo saldo anterior 10
    const out = statementsByCurrency({
      previousClosing: { ARS: '1000', EUR: '10' },
      entries: [
        entry('1', T.Alquiler, '500'),
        entry('2', T.Alquiler, '200', { currency: 'USD' }),
        entry('3', T.Comision, '-50', { currency: 'USD' }),
      ],
    });
    expect([...out.keys()]).toEqual(['ARS', 'EUR', 'USD']);
    expect(out.get('ARS')!.closing.toFixed(2)).toBe('1500.00');
    expect(out.get('USD')!.closing.toFixed(2)).toBe('150.00');
    expect(out.get('EUR')!.closing.toFixed(2)).toBe('10.00');
  });
});
