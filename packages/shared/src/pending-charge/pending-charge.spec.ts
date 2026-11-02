import { ChargeTarget, LineBeneficiary, LineItemType, PendingChargeKind } from '../enums';
import {
  imputationTarget,
  pendingChargeLine,
  requiresUpfront,
  signedChargeAmount,
  splitInstallments,
} from './index';
import { buildLiquidation } from '../liquidation-builder';
import {
  FirstDueMode,
  FixedDiscountProration,
  MidMonthAdjustmentMode,
  ProrationMode,
} from '../enums';

/** Los importes esperados están calculados a mano: el motor no es su propio oráculo. */
const source = (over: Record<string, unknown> = {}) => ({
  id: 'pc-1',
  kind: PendingChargeKind.Reparacion,
  chargedTo: ChargeTarget.Inquilino,
  amount: '8000.50',
  description: 'canilla de la cocina',
  beneficiary: LineBeneficiary.Locador,
  ...over,
});

describe('imputationTarget', () => {
  it('manda cada cargo a donde se descuenta', () => {
    expect(imputationTarget(ChargeTarget.Inquilino)).toBe('Liquidacion');
    expect(imputationTarget(ChargeTarget.Locador)).toBe('EstadoLocador');
    expect(imputationTarget(ChargeTarget.Inmobiliaria)).toBe('Ninguno');
  });
});

describe('pendingChargeLine', () => {
  it('una reparación al inquilino es un Cargo sin comisión a favor de quien la pagó', () => {
    expect(pendingChargeLine(source())).toEqual({
      type: LineItemType.Cargo,
      description: 'Reparación: canilla de la cocina',
      amount: '8000.50',
      commissionable: false,
      beneficiary: LineBeneficiary.Locador,
      sourceType: 'PendingCharge',
      sourceId: 'pc-1',
    });
  });

  it('una reparación que adelantó la inmobiliaria va a su favor', () => {
    const line = pendingChargeLine(source({ beneficiary: LineBeneficiary.Inmobiliaria }));
    expect(line?.beneficiary).toBe(LineBeneficiary.Inmobiliaria);
    expect(line?.commissionable).toBe(false);
  });

  it('el honorario por gestión es de la inmobiliaria y sin comisión aunque se indique otro destino', () => {
    const line = pendingChargeLine(
      source({ kind: PendingChargeKind.HonorarioGestion, beneficiary: LineBeneficiary.Locador, amount: '1500' }),
    );
    expect(line).toMatchObject({
      type: LineItemType.Honorario,
      description: 'Honorario por gestión: canilla de la cocina',
      amount: '1500.00',
      commissionable: false,
      beneficiary: LineBeneficiary.Inmobiliaria,
    });
  });

  it('una expensa extraordinaria es un Cargo y "Otro" usa solo la descripción', () => {
    expect(pendingChargeLine(source({ kind: PendingChargeKind.ExpensaExtra }))?.description).toBe(
      'Expensa extraordinaria: canilla de la cocina',
    );
    expect(pendingChargeLine(source({ kind: PendingChargeKind.Otro, description: 'Llave nueva' }))?.description).toBe(
      'Llave nueva',
    );
  });

  it('una devolución (negativa) es un Descuento a favor del inquilino, sin comisión', () => {
    const line = pendingChargeLine(source({ kind: PendingChargeKind.Devolucion, amount: '-3000' }));
    expect(line).toEqual({
      type: LineItemType.Descuento,
      description: 'Devolución: canilla de la cocina, a favor del inquilino',
      amount: '3000.00',
      commissionable: false,
      beneficiary: LineBeneficiary.Locador,
      sourceType: 'PendingCharge',
      sourceId: 'pc-1',
    });
  });

  it('un ajuste retroactivo se comisiona como el alquiler, positivo o negativo', () => {
    const up = pendingChargeLine(source({ kind: PendingChargeKind.AjusteRetroactivo, amount: '1200' }));
    expect(up).toMatchObject({ type: LineItemType.AjusteRetroactivo, commissionable: true });
    const down = pendingChargeLine(source({ kind: PendingChargeKind.AjusteRetroactivo, amount: '-1200' }));
    expect(down).toMatchObject({ type: LineItemType.Descuento, commissionable: true, amount: '1200.00' });
  });

  it('marca la cuota en el texto', () => {
    expect(pendingChargeLine(source({ installmentNo: 2, installmentOf: 3 }))?.description).toBe(
      'Reparación: canilla de la cocina, cuota 2/3',
    );
    expect(pendingChargeLine(source({ installmentNo: 1, installmentOf: 1 }))?.description).toBe(
      'Reparación: canilla de la cocina',
    );
  });

  it('un cargo al locador o a la inmobiliaria no es un renglón del inquilino', () => {
    expect(pendingChargeLine(source({ chargedTo: ChargeTarget.Locador }))).toBeNull();
    expect(pendingChargeLine(source({ chargedTo: ChargeTarget.Inmobiliaria }))).toBeNull();
  });

  it('un importe en cero no genera renglón', () => {
    expect(pendingChargeLine(source({ amount: '0.004' }))).toBeNull();
  });
});

describe('signedChargeAmount', () => {
  it('una devolución siempre queda negativa y el resto conserva el signo', () => {
    expect(signedChargeAmount(PendingChargeKind.Devolucion, '2500')).toBe('-2500.00');
    expect(signedChargeAmount(PendingChargeKind.Devolucion, '-2500')).toBe('-2500.00');
    expect(signedChargeAmount(PendingChargeKind.Reparacion, '2500.555')).toBe('2500.56');
    expect(signedChargeAmount(PendingChargeKind.Otro, '-10')).toBe('-10.00');
  });
});

describe('splitInstallments', () => {
  it('reparte por el mayor resto: 100.00 en 3 = 33.34 + 33.33 + 33.33', () => {
    expect(splitInstallments('100', 3)).toEqual(['33.34', '33.33', '33.33']);
  });

  it('el centavo que sobra va a las primeras cuotas: 100.02 en 4 = 25.01 x2 + 25.00 x2', () => {
    // 10002 centavos / 4 = 2500 resto 2 -> las dos primeras reciben 1 centavo.
    expect(splitInstallments('100.02', 4)).toEqual(['25.01', '25.01', '25.00', '25.00']);
  });

  it('una sola cuota es el total', () => {
    expect(splitInstallments('8000.5', 1)).toEqual(['8000.50']);
  });

  it('un crédito se parte igual y conserva el signo', () => {
    expect(splitInstallments('-100', 3)).toEqual(['-33.34', '-33.33', '-33.33']);
  });

  it('las cuotas suman siempre el total', () => {
    const parts = splitInstallments('12345.67', 7).map((p) => Math.round(Number(p) * 100));
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1234567);
  });

  it('rechaza una cantidad de cuotas inválida', () => {
    expect(() => splitInstallments('100', 0)).toThrow();
    expect(() => splitInstallments('100', 1.5)).toThrow();
  });
});

describe('requiresUpfront', () => {
  // Comisión mensual 7 % de 200000 = 14000; umbral 2 comisiones = 28000.
  const check = (amount: string, over: Record<string, unknown> = {}) =>
    requiresUpfront({ amount, monthlyCommission: '14000', thresholdFees: 2, ...over });

  it('supera el umbral solo cuando lo pasa estrictamente', () => {
    expect(check('28000.01')).toBe(true);
    expect(check('28000')).toBe(false);
    expect(check('5000')).toBe(false);
  });

  it('un crédito nunca pide anticipo', () => {
    expect(check('-90000')).toBe(false);
  });

  it('sin comisión mensual no hay con qué comparar', () => {
    expect(check('90000', { monthlyCommission: '0' })).toBe(false);
  });

  it('el umbral se configura: 3 comisiones = 42000', () => {
    expect(check('42000', { thresholdFees: 3 })).toBe(false);
    expect(check('42000.01', { thresholdFees: 3 })).toBe(true);
  });

  it('con umbral 0 todo importe positivo lo supera', () => {
    expect(check('1', { thresholdFees: 0 })).toBe(true);
  });
});

describe('integración con el generador de liquidaciones', () => {
  it('suma un cargo y resta una devolución sin tocar la base de comisión', () => {
    const lines = [
      pendingChargeLine(source({ amount: '8000.50' })),
      pendingChargeLine(source({ id: 'pc-2', kind: PendingChargeKind.Devolucion, amount: '-3000' })),
    ].flatMap((l) => (l ? [l] : []));

    const built = buildLiquidation({
      period: new Date(Date.UTC(2026, 10, 1)),
      currency: 'ARS',
      contract: {
        startDate: new Date(Date.UTC(2026, 0, 1)),
        endDate: new Date(Date.UTC(2028, 11, 31)),
        status: 'Activo',
      },
      rent: { monthlyAmount: '200000' },
      conventions: {
        prorationMode: ProrationMode.DiasReales,
        midMonthAdjustmentMode: MidMonthAdjustmentMode.DesdePeriodoSiguiente,
        firstDueMode: FirstDueMode.DiaDeInicio,
        fixedDiscountProration: FixedDiscountProration.Proporcional,
      },
      terms: { dueDay: 10 },
      pendingCharges: lines,
    });
    if (built.skipped) throw new Error('no debía omitirse');

    // 200000 + 8000.50 - 3000 = 205000.50
    expect(built.total).toBe('205000.50');
    const sources = built.lines.filter((l) => l.sourceType === 'PendingCharge');
    expect(sources.map((l) => l.commissionable)).toEqual([false, false]);
  });
});
