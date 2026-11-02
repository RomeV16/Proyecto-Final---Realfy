import { CommissionType, LineBeneficiary as B, PaymentReceiver } from '../enums';
import {
  CompensationScope,
  LessorDirectOwes,
  PartialAllocation,
  SettlementError,
  accountBalance,
  checkCompensation,
  convertAmount,
  settlePayment,
  settlementBuckets,
} from './index';
import type { SettlementInput, SettlementResult } from './index';

/**
 * Casos "golden": los valores esperados se calcularon a mano antes de correr
 * la prueba (el cálculo está en el comentario de cada caso).
 *
 * Liquidación base (ARS):
 *   Alquiler 100000 (locador, comisionable) + Punitorio 3000 (locador, comisionable)
 *   + Servicio 1500 (locador, no comisionable) + Impuesto 5000 (ente)
 *   + Honorario 2000 (inmobiliaria) = 111500
 *   Comisión 7 % de 103000 = 7210
 *   Inmobiliaria 7210 + 2000 = 9210 · Entes 5000 · Locadores 104500 - 7210 = 97290
 *   Locadores A 50 %, B 30 %, C 20 % -> 48645 / 29187 / 19458
 */
const LINES = [
  { amount: '100000', beneficiary: B.Locador, commissionable: true },
  { amount: '3000', beneficiary: B.Locador, commissionable: true },
  { amount: '1500', beneficiary: B.Locador, commissionable: false },
  { amount: '5000', beneficiary: B.Ente, commissionable: false },
  { amount: '2000', beneficiary: B.Inmobiliaria, commissionable: false },
];
const LESSORS = [
  { personId: 'A', payoutPct: '50' },
  { personId: 'B', payoutPct: '30' },
  { personId: 'C', payoutPct: '20' },
];
const PCT7 = { type: CommissionType.FixedPercent, percentage: '7' };

const base = (over: Partial<SettlementInput> = {}): SettlementInput => ({
  currency: 'ARS',
  lines: LINES,
  commission: PCT7,
  lessors: LESSORS,
  amount: '111500',
  receivedBy: PaymentReceiver.Inmobiliaria,
  ...over,
});

const money = (r: SettlementResult) => ({
  agency: r.payment.agency.toFixed(2),
  ente: r.payment.ente.toFixed(2),
  lessors: r.payment.lessors.toFixed(2),
  agencyCash: r.agencyCash.toFixed(2),
  custody: r.custodyTotal.toFixed(2),
});
const pos = (r: SettlementResult) =>
  r.positions.map((p) => [p.personId, p.share.toFixed(2), p.received.toFixed(2), p.custody.toFixed(2), p.balance.toFixed(2)]);
const comp = (r: SettlementResult) => r.compensations.map((c) => [c.fromLessorId, c.toLessorId, c.amount.toFixed(2)]);

/** Lo que entra a la inmobiliaria = su parte + lo que guarda para entes + lo que debe a locadores. */
function expectBalanced(r: SettlementResult) {
  const owedToLessors = r.positions.reduce((acc, p) => acc.plus(p.balance), r.payment.agency.minus(r.payment.agency));
  const ente = r.enteHeldBy === 'Inmobiliaria' ? r.payment.ente : r.payment.ente.minus(r.payment.ente);
  expect(r.agencyCash.plus(r.custodyTotal).toFixed(2)).toBe(r.payment.agency.plus(ente).plus(owedToLessors).toFixed(2));
  const shares = r.positions.reduce((acc, p) => acc.plus(p.share), r.payment.agency.minus(r.payment.agency));
  expect(shares.toFixed(2)).toBe(r.payment.lessors.toFixed(2));
}

describe('settlement-engine — destinos de la liquidación', () => {
  it('separa comisión, renglones de la inmobiliaria, entes y locadores', () => {
    const b = settlementBuckets(LINES, PCT7, 'ARS');
    expect([b.total, b.commissionBase, b.commission, b.agency, b.ente, b.lessors].map((v) => v.toFixed(2))).toEqual([
      '111500.00',
      '103000.00',
      '7210.00',
      '9210.00',
      '5000.00',
      '97290.00',
    ]);
  });

  it('suma los gastos administrativos a la parte de la inmobiliaria', () => {
    // 5 % de 103000 = 5150 + gastos 500 = 5650; inmobiliaria 5650 + 2000 = 7650; locadores 104500 - 5650 = 98850
    const b = settlementBuckets(LINES, { ...PCT7, percentage: '5', adminFee: '500' }, 'ARS');
    expect([b.commission, b.adminFee, b.agency, b.lessors].map((v) => v.toFixed(2))).toEqual([
      '5150.00',
      '500.00',
      '7650.00',
      '98850.00',
    ]);
  });

  it('sin comisión la inmobiliaria solo se queda sus renglones', () => {
    const b = settlementBuckets(LINES, null, 'ARS');
    expect([b.agency.toFixed(2), b.lessors.toFixed(2)]).toEqual(['2000.00', '104500.00']);
  });

  it('rechaza una parte negativa (descuento mayor que el alquiler)', () => {
    const lines = [
      { amount: '100', beneficiary: B.Locador, commissionable: true },
      { amount: '-200', beneficiary: B.Locador, commissionable: true },
      { amount: '300', beneficiary: B.Inmobiliaria, commissionable: false },
    ];
    expect(() => settlementBuckets(lines, PCT7, 'ARS')).toThrow(SettlementError);
    expect(() => settlementBuckets(lines, null, 'ARS')).toThrow(/locadores queda negativa/);
  });
});

describe('settlement-engine — flujo (a): cobra la inmobiliaria', () => {
  it('pago total: la inmobiliaria guarda la parte de cada locador', () => {
    const r = settlePayment(base());
    expect(r.flow).toBe('Inmobiliaria');
    expect(money(r)).toEqual({
      agency: '9210.00',
      ente: '5000.00',
      lessors: '97290.00',
      agencyCash: '111500.00',
      custody: '0.00',
    });
    expect(pos(r)).toEqual([
      ['A', '48645.00', '0.00', '0.00', '48645.00'],
      ['B', '29187.00', '0.00', '0.00', '29187.00'],
      ['C', '19458.00', '0.00', '0.00', '19458.00'],
    ]);
    expect(r.compensations).toEqual([]);
    expectBalanced(r);
  });

  it('pagos parciales proporcionales: el acumulado suma exactamente la liquidación', () => {
    // 10000 / 111500 sobre [9210, 5000, 97290] en centavos: 82600,896 / 44843,049 / 872556,054
    // -> el centavo que sobra va a la inmobiliaria: 826,01 / 448,43 / 8725,56
    // 8725,56 entre 50/30/20: 4362,78 / 2617,668 / 1745,112 -> B lleva el centavo: 2617,67 / 1745,11
    const first = settlePayment(base({ amount: '10000' }));
    expect(money(first)).toMatchObject({ agency: '826.01', ente: '448.43', lessors: '8725.56' });
    expect(first.positions.map((p) => p.share.toFixed(2))).toEqual(['4362.78', '2617.67', '1745.11']);
    expectBalanced(first);

    const second = settlePayment(base({ amount: '101500', paidBefore: '10000' }));
    expect(money(second)).toMatchObject({ agency: '8383.99', ente: '4551.57', lessors: '88564.44' });
    expect(second.positions.map((p) => p.share.toFixed(2))).toEqual(['44282.22', '26569.33', '17712.89']);
    expectBalanced(second);
  });

  it('pago parcial con la inmobiliaria primero', () => {
    // 10000: inmobiliaria 9210; el resto 790 entre [5000, 97290]: 3861,57 / 75138,43 centavos -> 38,62 / 751,38
    // 751,38 entre 50/30/20: 375,69 / 225,414 / 150,276 -> C lleva el centavo: 225,41 / 150,28
    const r = settlePayment(
      base({ amount: '10000', options: { partialAllocation: PartialAllocation.InmobiliariaPrimero } }),
    );
    expect(money(r)).toMatchObject({ agency: '9210.00', ente: '38.62', lessors: '751.38' });
    expect(r.positions.map((p) => p.share.toFixed(2))).toEqual(['375.69', '225.41', '150.28']);

    // Un pago que no alcanza la parte de la inmobiliaria es todo de ella.
    const small = settlePayment(
      base({ amount: '1000', options: { partialAllocation: PartialAllocation.InmobiliariaPrimero } }),
    );
    expect(money(small)).toMatchObject({ agency: '1000.00', ente: '0.00', lessors: '0.00' });
  });

  it('reparto por mayor resto entre tres tercios', () => {
    // 100 entre 33,3333 / 33,3333 / 33,3334: 33,33 cada uno y el centavo al mayor resto (C)
    const r = settlePayment({
      currency: 'ARS',
      lines: [{ amount: '100', beneficiary: B.Locador, commissionable: true }],
      commission: null,
      lessors: [
        { personId: 'A', payoutPct: '33.3333' },
        { personId: 'B', payoutPct: '33.3333' },
        { personId: 'C', payoutPct: '33.3334' },
      ],
      amount: '100',
      receivedBy: PaymentReceiver.Inmobiliaria,
    });
    expect(r.positions.map((p) => p.share.toFixed(2))).toEqual(['33.33', '33.33', '33.34']);
  });

  it('a igual resto, el centavo va al primer locador', () => {
    const r = settlePayment({
      currency: 'ARS',
      lines: [{ amount: '0.01', beneficiary: B.Locador, commissionable: false }],
      commission: null,
      lessors: [
        { personId: 'A', payoutPct: '50' },
        { personId: 'B', payoutPct: '50' },
      ],
      amount: '0.01',
      receivedBy: PaymentReceiver.Inmobiliaria,
    });
    expect(r.positions.map((p) => p.share.toFixed(2))).toEqual(['0.01', '0.00']);
  });
});

describe('settlement-engine — flujo (c): efectivo en custodia', () => {
  it('la parte de cada locador va a su custodia y a la caja solo lo de la inmobiliaria y entes', () => {
    const r = settlePayment(base({ inCustody: true }));
    expect(r.flow).toBe('Custodia');
    expect(money(r)).toMatchObject({ agencyCash: '14210.00', custody: '97290.00' });
    expect(pos(r)).toEqual([
      ['A', '48645.00', '0.00', '48645.00', '48645.00'],
      ['B', '29187.00', '0.00', '29187.00', '29187.00'],
      ['C', '19458.00', '0.00', '19458.00', '19458.00'],
    ]);
    expectBalanced(r);
  });

  it('solo lo que recibe la inmobiliaria puede quedar en custodia', () => {
    expect(() => settlePayment(base({ inCustody: true, receivedBy: PaymentReceiver.Locador }))).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_CUSTODY_REQUIRES_AGENCY' }),
    );
  });
});

describe('settlement-engine — flujo (b): cobra el locador', () => {
  it('cada locador recibió su parte y debe a la inmobiliaria comisión, renglones propios y entes', () => {
    // Lo ajeno: 9210 + 5000 = 14210 entre 50/30/20 -> 7105 / 4263 / 2842
    const r = settlePayment(base({ receivedBy: PaymentReceiver.Locador }));
    expect(r.flow).toBe('Locador');
    expect(money(r)).toMatchObject({ agencyCash: '0.00', custody: '0.00' });
    expect(r.enteHeldBy).toBe('Inmobiliaria');
    expect(pos(r)).toEqual([
      ['A', '48645.00', '55750.00', '0.00', '-7105.00'],
      ['B', '29187.00', '33450.00', '0.00', '-4263.00'],
      ['C', '19458.00', '22300.00', '0.00', '-2842.00'],
    ]);
    expectBalanced(r);
  });

  it('con la opción SoloInmobiliaria el locador se queda lo de los entes para pagarlos', () => {
    // Debe solo 9210 -> 4605 / 2763 / 1842
    const r = settlePayment(
      base({ receivedBy: PaymentReceiver.Locador, options: { lessorDirectOwes: LessorDirectOwes.SoloInmobiliaria } }),
    );
    expect(r.enteHeldBy).toBe('Locador');
    expect(r.positions.map((p) => p.balance.toFixed(2))).toEqual(['-4605.00', '-2763.00', '-1842.00']);
    expect(r.positions.map((p) => p.received.toFixed(2))).toEqual(['55750.00', '33450.00', '22300.00']);
    expectBalanced(r);
  });

  it('si cobró un solo locador, debe a los demás su parte (compensación)', () => {
    // A recibió 111500: le corresponden 48645 -> debe 62855 (14210 a la inmobiliaria, 29187 a B, 19458 a C)
    const r = settlePayment(base({ receivedBy: PaymentReceiver.Locador, receiverPersonId: 'A' }));
    expect(pos(r)).toEqual([
      ['A', '48645.00', '111500.00', '0.00', '-62855.00'],
      ['B', '29187.00', '0.00', '0.00', '29187.00'],
      ['C', '19458.00', '0.00', '0.00', '19458.00'],
    ]);
    expect(comp(r)).toEqual([
      ['A', 'B', '29187.00'],
      ['A', 'C', '19458.00'],
    ]);
    expectBalanced(r);
  });

  it('si cobró otro locador de la inmobiliaria, cubre a todos los locadores del contrato', () => {
    const r = settlePayment(base({ receivedBy: PaymentReceiver.Locador, receiverPersonId: 'X' }));
    expect(pos(r)[3]).toEqual(['X', '0.00', '111500.00', '0.00', '-111500.00']);
    expect(comp(r)).toEqual([
      ['X', 'A', '48645.00'],
      ['X', 'B', '29187.00'],
      ['X', 'C', '19458.00'],
    ]);
    expectBalanced(r);
  });

  it('sin locadores vigentes no hay a quién atribuir el cobro', () => {
    expect(() =>
      settlePayment(
        base({
          lines: [{ amount: '100', beneficiary: B.Inmobiliaria, commissionable: false }],
          lessors: [],
          amount: '100',
          receivedBy: PaymentReceiver.Locador,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_LESSOR_SHARES' }));
  });
});

describe('settlement-engine — validaciones y monedas', () => {
  it('rechaza un pago que supera la liquidación, un importe nulo y porcentajes que no suman 100', () => {
    expect(() => settlePayment(base({ amount: '100', paidBefore: '111450' }))).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_EXCEEDS_TOTAL' }),
    );
    expect(() => settlePayment(base({ amount: '0' }))).toThrow(
      expect.objectContaining({ code: 'SETTLEMENT_INVALID_AMOUNT' }),
    );
    expect(() =>
      settlePayment(base({ lessors: [{ personId: 'A', payoutPct: '90' }] })),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_LESSOR_SHARES' }));
  });

  it('una liquidación en dólares se reparte en dólares; no mezcla monedas', () => {
    const usd = settlePayment(
      base({ currency: 'USD', lines: [{ amount: '1000', beneficiary: B.Locador, commissionable: true, currency: 'USD' }], amount: '1000' }),
    );
    expect(usd.currency).toBe('USD');
    expect(usd.positions.map((p) => p.share.toFixed(2))).toEqual(['465.00', '279.00', '186.00']);
    expect(() =>
      settlePayment(
        base({ lines: [{ amount: '1000', beneficiary: B.Locador, commissionable: true, currency: 'EUR' }], amount: '1000' }),
      ),
    ).toThrow(expect.objectContaining({ code: 'SETTLEMENT_CURRENCY_MISMATCH' }));
  });

  it('convierte solo con un tipo de cambio explícito y redondea al centavo', () => {
    expect(convertAmount('1000', '1200.5').toFixed(2)).toBe('1200500.00');
    expect(convertAmount('1000', '0.000833').toFixed(2)).toBe('0.83');
    expect(convertAmount('10.005', '1').toFixed(2)).toBe('10.01');
    expect(() => convertAmount('1000', '0')).toThrow(SettlementError);
  });

  it('el saldo de una cuenta es entradas menos salidas', () => {
    expect(
      accountBalance([
        { direction: 'In', amount: '1000' },
        { direction: 'Out', amount: '250.50' },
        { direction: 'In', amount: '0.50' },
      ]).toFixed(2),
    ).toBe('750.00');
  });
});

describe('settlement-engine — compensaciones', () => {
  const ok = {
    paymentAmount: '1000',
    receivedBy: PaymentReceiver.Locador,
    alreadyCompensated: ['300'],
    amount: '700',
    fromLessorId: 'X',
    toLessorId: 'A',
    contractLessorIds: ['A', 'B'],
    scope: CompensationScope.CualquierLocador,
  };

  it('acepta hasta lo que queda del cobro', () => {
    expect(checkCompensation(ok).toFixed(2)).toBe('700.00');
  });

  it.each([
    [{ receivedBy: PaymentReceiver.Inmobiliaria }, 'COMPENSATION_REQUIRES_LESSOR_RECEIPT'],
    [{ fromLessorId: 'A' }, 'COMPENSATION_SAME_LESSOR'],
    [{ toLessorId: 'Z' }, 'COMPENSATION_OUT_OF_SCOPE'],
    [{ scope: CompensationScope.MismoContrato }, 'COMPENSATION_OUT_OF_SCOPE'],
    [{ amount: '700.01' }, 'COMPENSATION_EXCEEDS_PAYMENT'],
    [{ amount: '0' }, 'SETTLEMENT_INVALID_AMOUNT'],
  ])('rechaza %o con %s', (over, code) => {
    expect(() => checkCompensation({ ...ok, ...over })).toThrow(expect.objectContaining({ code }));
  });

  it('entre locadores del mismo contrato con la opción MismoContrato', () => {
    expect(
      checkCompensation({ ...ok, fromLessorId: 'B', scope: CompensationScope.MismoContrato }).toFixed(2),
    ).toBe('700.00');
  });
});
