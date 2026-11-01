import { buildLiquidation, onBehalfOfText } from './index';
import type { BuiltLiquidation, LiquidationBuilderInput } from './index';
import {
  ContractStatus,
  FirstDueMode,
  FixedDiscountProration,
  LineBeneficiary,
  LineItemType,
  LiquidacionKind,
  MidMonthAdjustmentMode,
  ProrationMode,
} from '../enums';
import type { LiquidationConventionsInput } from './index';

/** Lo que rige sin pactar otra cosa: el comportamiento original. */
const DEFAULTS: LiquidationConventionsInput = {
  prorationMode: ProrationMode.DiasReales,
  midMonthAdjustmentMode: MidMonthAdjustmentMode.DesdePeriodoSiguiente,
  firstDueMode: FirstDueMode.DiaDeInicio,
  fixedDiscountProration: FixedDiscountProration.Proporcional,
};

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function base(overrides: Partial<LiquidationBuilderInput> = {}): LiquidationBuilderInput {
  return {
    period: d('2026-11-01'),
    currency: 'ARS',
    contract: { startDate: d('2026-01-01'), endDate: d('2028-12-31'), status: ContractStatus.Activo },
    rent: { monthlyAmount: '300000.00' },
    terms: { dueDay: 10 },
    conventions: DEFAULTS,
    ...overrides,
  };
}

function built(input: LiquidationBuilderInput): BuiltLiquidation {
  const r = buildLiquidation(input);
  if (r.skipped !== null) throw new Error(`omitida: ${r.skipped}`);
  return r;
}

describe('buildLiquidation', () => {
  describe('mes completo', () => {
    it('un renglón de alquiler comisionable al locador, vence el día de las reglas', () => {
      const r = built(base({ terms: { dueDay: 5 } }));
      expect(r.lines).toEqual([
        {
          type: LineItemType.Alquiler,
          description: 'Alquiler 11/2026',
          amount: '300000.00',
          commissionable: true,
          beneficiary: LineBeneficiary.Locador,
          sourceType: null,
          sourceId: null,
          sortOrder: 0,
        },
      ]);
      expect(r.dueDate).toEqual(d('2026-11-05'));
      expect(r.total).toBe('300000.00');
      expect(r.subtotal).toBe('300000.00');
      expect(r.kind).toBe(LiquidacionKind.Mensual);
      expect(r.isProvisional).toBe(false);
      expect(r.proration).toBeNull();
    });

    it('usa el alquiler que se le da (el del período), no otro', () => {
      expect(built(base({ rent: { monthlyAmount: '250000' } })).total).toBe('250000.00');
    });

    it('un contrato que empieza el día 1 no se prorratea', () => {
      const r = built(base({ contract: { startDate: d('2026-11-01'), endDate: d('2028-10-31'), status: 'Activo' } }));
      expect(r.proration).toBeNull();
      expect(r.total).toBe('300000.00');
    });

    it('el vencimiento se recorta al último día del mes', () => {
      const r = built(base({ period: d('2027-02-01'), terms: { dueDay: 31 } }));
      expect(r.dueDate).toEqual(d('2027-02-28'));
    });
  });

  describe('fechas del contrato', () => {
    it('no hay liquidación antes del inicio', () => {
      const r = buildLiquidation(base({ contract: { startDate: d('2026-12-01'), endDate: d('2028-11-30'), status: 'Activo' } }));
      expect(r).toEqual({ skipped: 'BeforeStart' });
    });

    it('no hay liquidación después del fin real', () => {
      const r = buildLiquidation(
        base({ contract: { startDate: d('2026-01-01'), endDate: d('2028-12-31'), actualEndDate: d('2026-10-31'), status: 'Activo' } }),
      );
      expect(r).toEqual({ skipped: 'AfterEnd' });
    });

    it('D-3: pasado el fin pactado sin fin real, un contrato Activo sigue liquidando completo', () => {
      const r = built(
        base({ period: d('2027-03-01'), contract: { startDate: d('2025-01-01'), endDate: d('2026-12-31'), status: 'Activo' } }),
      );
      expect(r.total).toBe('300000.00');
      expect(r.proration).toBeNull();
    });

    it('un contrato que no está Activo y no tiene fin real no liquida', () => {
      for (const status of ['Vencido', 'Rescindido', 'Renovado', 'Archivado', 'Borrador']) {
        expect(buildLiquidation(base({ contract: { startDate: d('2026-01-01'), endDate: d('2028-12-31'), status } }))).toEqual({
          skipped: 'NotActive',
        });
      }
    });

    it('un contrato rescindido liquida hasta su fin real, prorrateado', () => {
      const r = built(
        base({ contract: { startDate: d('2026-01-01'), endDate: d('2028-12-31'), actualEndDate: d('2026-11-15'), status: 'Rescindido' } }),
      );
      expect(r.proration).toEqual({ coveredDays: 15, monthDays: 30 });
      expect(r.total).toBe('150000.00');
    });
  });

  describe('prorrateo por días', () => {
    it('primer mes parcial: días desde el inicio (inclusive) sobre días del mes', () => {
      // 11/2026 tiene 30 días; del 16 al 30 son 15 días.
      const r = built(base({ contract: { startDate: d('2026-11-16'), endDate: d('2028-10-31'), status: 'Activo' } }));
      expect(r.proration).toEqual({ coveredDays: 15, monthDays: 30 });
      expect(r.lines[0].amount).toBe('150000.00');
      expect(r.lines[0].description).toBe('Alquiler 11/2026 (proporcional: 15 de 30 días)');
    });

    it('redondea al centavo, mitad hacia arriba', () => {
      // 100000 x 10 / 31 = 32258.0645... -> 32258.06
      const r = built(
        base({
          period: d('2026-12-01'),
          rent: { monthlyAmount: '100000' },
          contract: { startDate: d('2026-12-22'), endDate: d('2028-11-30'), status: 'Activo' },
        }),
      );
      expect(r.proration).toEqual({ coveredDays: 10, monthDays: 31 });
      expect(r.lines[0].amount).toBe('32258.06');
      // 1000.05 x 1 / 30 = 33.335 -> 33.34 (mitad hacia arriba)
      const half = built(
        base({
          rent: { monthlyAmount: '1000.05' },
          contract: { startDate: d('2026-11-30'), endDate: d('2028-10-31'), status: 'Activo' },
        }),
      );
      expect(half.lines[0].amount).toBe('33.34');
    });

    it('febrero de año no bisiesto usa 28 días', () => {
      const r = built(
        base({
          period: d('2027-02-01'),
          rent: { monthlyAmount: '280000' },
          contract: { startDate: d('2027-02-15'), endDate: d('2029-01-31'), status: 'Activo' },
        }),
      );
      expect(r.proration).toEqual({ coveredDays: 14, monthDays: 28 });
      expect(r.lines[0].amount).toBe('140000.00');
    });

    it('inicio y fin real en el mismo mes', () => {
      const r = built(
        base({ contract: { startDate: d('2026-11-10'), endDate: d('2026-12-31'), actualEndDate: d('2026-11-19'), status: 'Activo' } }),
      );
      expect(r.proration).toEqual({ coveredDays: 10, monthDays: 30 });
      expect(r.total).toBe('100000.00');
    });

    it('el fin pactado a mitad de mes, sin fin real, no prorratea', () => {
      const r = built(base({ contract: { startDate: d('2025-11-15'), endDate: d('2026-11-14'), status: 'Activo' } }));
      expect(r.proration).toBeNull();
      expect(r.total).toBe('300000.00');
    });

    it('si empieza después del día de vencimiento, vence el día de inicio', () => {
      const r = built(base({ contract: { startDate: d('2026-11-16'), endDate: d('2028-10-31'), status: 'Activo' } }));
      expect(r.dueDate).toEqual(d('2026-11-16'));
      const early = built(base({ contract: { startDate: d('2026-11-04'), endDate: d('2028-10-31'), status: 'Activo' } }));
      expect(early.dueDate).toEqual(d('2026-11-10'));
    });
  });

  describe('descuentos de las reglas', () => {
    it('porcentaje sobre el alquiler del mes, comisionable', () => {
      const r = built(base({ terms: { dueDay: 10, discountPct: '10' } }));
      expect(r.lines.map((l) => [l.type, l.amount])).toEqual([
        [LineItemType.Alquiler, '300000.00'],
        [LineItemType.Descuento, '30000.00'],
      ]);
      expect(r.lines[1].commissionable).toBe(true);
      expect(r.subtotal).toBe('300000.00');
      expect(r.total).toBe('270000.00');
    });

    it('monto fijo prorrateado igual que el alquiler', () => {
      const r = built(
        base({
          terms: { dueDay: 10, discountAmount: '20000' },
          contract: { startDate: d('2026-11-16'), endDate: d('2028-10-31'), status: 'Activo' },
        }),
      );
      expect(r.lines[1].amount).toBe('10000.00');
      expect(r.total).toBe('140000.00');
    });

    it('porcentaje y monto juntos, sin superar el alquiler', () => {
      const r = built(base({ terms: { dueDay: 10, discountPct: '90', discountAmount: '100000' } }));
      expect(r.lines.map((l) => l.amount)).toEqual(['300000.00', '270000.00', '30000.00']);
      expect(r.total).toBe('0.00');
    });
  });

  describe('renglones de otros módulos', () => {
    it('toman el destino y la comisión por defecto del tipo, o los que indican', () => {
      const r = built(
        base({
          penalties: [
            { type: LineItemType.Multa, description: 'Punitorio 3 días', amount: '1500', sourceType: 'Penalty', sourceId: 'pen-1' },
          ],
          pendingCharges: [
            { type: LineItemType.Cargo, description: 'Reparación canilla', amount: '8000.5', sourceType: 'PendingCharge', sourceId: 'pc-1' },
            { type: LineItemType.Honorario, description: 'Gestión de reparación', amount: '800' },
          ],
          serviceAllocations: [
            { type: LineItemType.Servicio, description: 'Gas 10/2026', amount: '4200', sourceType: 'ServiceBillAllocation', sourceId: 'sba-1' },
            { type: LineItemType.Impuesto, description: 'ABL 5/2026', amount: '3000', beneficiary: LineBeneficiary.Locador },
          ],
          trueUps: [
            { type: LineItemType.AjusteRetroactivo, description: 'Corrección IPC 9/2026', amount: '12000', sourceType: 'ContractAdjustment', sourceId: 'adj-1' },
          ],
        }),
      );
      const byDesc = Object.fromEntries(r.lines.map((l) => [l.description, l]));
      expect(byDesc['Punitorio 3 días']).toMatchObject({ commissionable: true, beneficiary: 'Locador', sourceId: 'pen-1' });
      expect(byDesc['Reparación canilla']).toMatchObject({ commissionable: false, beneficiary: 'Locador', amount: '8000.50' });
      expect(byDesc['Gestión de reparación']).toMatchObject({ commissionable: false, beneficiary: 'Inmobiliaria' });
      expect(byDesc['Gas 10/2026']).toMatchObject({ commissionable: false, beneficiary: 'Ente' });
      expect(byDesc['ABL 5/2026']).toMatchObject({ commissionable: false, beneficiary: 'Locador' });
      expect(byDesc['Corrección IPC 9/2026']).toMatchObject({ commissionable: true, beneficiary: 'Locador' });
      expect(r.total).toBe('329500.50');
      expect(r.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('la comisión solo corre sobre lo comisionable: alquiler + punitorio', () => {
      const r = built(
        base({
          penalties: [{ type: LineItemType.Multa, description: 'Punitorio', amount: '1000' }],
          pendingCharges: [{ type: LineItemType.Cargo, description: 'Reparación', amount: '5000' }],
        }),
      );
      const commissionBase = r.lines
        .filter((l) => l.commissionable)
        .reduce((acc, l) => acc + Number(l.amount) * (l.type === LineItemType.Descuento ? -1 : 1), 0);
      expect(commissionBase).toBe(301000);
    });
  });

  describe('provisional / pago a cuenta', () => {
    it('un alquiler con ajuste provisional da una liquidación provisional a cuenta', () => {
      const r = built(base({ rent: { monthlyAmount: '300000', isProvisional: true } }));
      expect(r.isProvisional).toBe(true);
      expect(r.kind).toBe(LiquidacionKind.PagoACuenta);
    });
  });

  describe('por cuenta y orden', () => {
    it('lista a los locadores', () => {
      expect(onBehalfOfText([])).toBe('');
      expect(onBehalfOfText(['Ana Pérez'])).toBe('Cobrado por cuenta y orden de Ana Pérez.');
      expect(onBehalfOfText(['Ana Pérez', 'Luis Gómez'])).toBe('Cobrado por cuenta y orden de Ana Pérez y Luis Gómez.');
      expect(onBehalfOfText(['A', 'B', ' C '])).toBe('Cobrado por cuenta y orden de A, B y C.');
      expect(built(base({ lessors: [{ name: 'Ana Pérez' }] })).onBehalfOf).toBe('Cobrado por cuenta y orden de Ana Pérez.');
    });
  });

  it('rechaza importes negativos en los renglones aportados', () => {
    expect(() =>
      buildLiquidation(base({ pendingCharges: [{ type: LineItemType.Cargo, description: 'x', amount: '-5' }] })),
    ).toThrow('Monto inválido');
  });
});

const conv = (c: Partial<LiquidationConventionsInput>): LiquidationConventionsInput => ({ ...DEFAULTS, ...c });
const activeFrom = (startDate: string, extra: Record<string, unknown> = {}) => ({
  startDate: d(startDate),
  endDate: d('2028-12-31'),
  status: 'Activo',
  ...extra,
});

describe('convenciones pactables', () => {
  describe('prorrateo (prorationMode)', () => {
    const amountFor = (mode: ProrationMode, period: string, start: string) => {
      const r = built(
        base({
          period: d(period),
          contract: activeFrom(start),
          conventions: conv({ prorationMode: mode }),
        }),
      );
      return { amount: r.lines[0].amount, proration: r.proration };
    };

    it('empezar el 16 de un mes de 31 días', () => {
      // DiasReales: 300000 x 16 / 31 = 154838,709... -> 154838,71. Mes30: 15 de 30 = 150000.
      expect(amountFor(ProrationMode.DiasReales, '2026-12-01', '2026-12-16')).toEqual({
        amount: '154838.71',
        proration: { coveredDays: 16, monthDays: 31 },
      });
      expect(amountFor(ProrationMode.Mes30, '2026-12-01', '2026-12-16')).toEqual({
        amount: '150000.00',
        proration: { coveredDays: 15, monthDays: 30 },
      });
      expect(amountFor(ProrationMode.SinProrrateo, '2026-12-01', '2026-12-16')).toEqual({
        amount: '300000.00',
        proration: null,
      });
    });

    it('empezar el 31: Mes30 cuenta un día de treinta', () => {
      // DiasReales: 300000 / 31 = 9677,419 -> 9677,42. Mes30: 300000 / 30 = 10000.
      expect(amountFor(ProrationMode.DiasReales, '2026-12-01', '2026-12-31').amount).toBe('9677.42');
      expect(amountFor(ProrationMode.Mes30, '2026-12-01', '2026-12-31').amount).toBe('10000.00');
    });

    it('febrero: Mes30 lo trata como un mes de 30 días', () => {
      // Desde el 15 de febrero: DiasReales 14 de 28 = 150000; Mes30 16 de 30 = 160000.
      expect(amountFor(ProrationMode.DiasReales, '2027-02-01', '2027-02-15').amount).toBe('150000.00');
      expect(amountFor(ProrationMode.Mes30, '2027-02-01', '2027-02-15').amount).toBe('160000.00');
    });

    it('el último mes con fin real también respeta el modo', () => {
      const end = (mode: ProrationMode) =>
        built(
          base({
            period: d('2026-12-01'),
            contract: activeFrom('2026-01-01', { actualEndDate: d('2026-12-20') }),
            conventions: conv({ prorationMode: mode }),
          }),
        ).total;
      expect(end(ProrationMode.DiasReales)).toBe('193548.39'); // 300000 x 20 / 31
      expect(end(ProrationMode.Mes30)).toBe('200000.00'); // 20 de 30
      expect(end(ProrationMode.SinProrrateo)).toBe('300000.00');
    });
  });

  describe('ajuste a mitad de mes (midMonthAdjustmentMode)', () => {
    const adjusted = (mode: MidMonthAdjustmentMode) =>
      built(
        base({
          period: d('2026-11-01'),
          rent: {
            monthlyAmount: '300000',
            midMonthChange: { effectiveDate: d('2026-11-15'), newAmount: '330000' },
          },
          conventions: conv({ midMonthAdjustmentMode: mode }),
        }),
      );

    it('DesdePeriodoSiguiente: el mes sigue al alquiler viejo', () => {
      const r = adjusted(MidMonthAdjustmentMode.DesdePeriodoSiguiente);
      expect(r.lines.map((l) => l.amount)).toEqual(['300000.00']);
      expect(r.midMonthSplit).toBeNull();
    });

    it('DesdeEsePeriodo: el mes entero al alquiler nuevo', () => {
      const r = adjusted(MidMonthAdjustmentMode.DesdeEsePeriodo);
      expect(r.lines.map((l) => l.amount)).toEqual(['330000.00']);
      expect(r.total).toBe('330000.00');
    });

    it('Prorrateado: 14 días al viejo y 16 al nuevo en dos renglones', () => {
      // 300000 x 14 / 30 = 140000; 330000 x 16 / 30 = 176000.
      const r = adjusted(MidMonthAdjustmentMode.Prorrateado);
      expect(r.lines.map((l) => [l.type, l.amount, l.commissionable])).toEqual([
        ['Alquiler', '140000.00', true],
        ['Alquiler', '176000.00', true],
      ]);
      expect(r.lines[0].description).toBe('Alquiler 11/2026 (días 1 a 14)');
      expect(r.lines[1].description).toBe('Alquiler 11/2026 (días 15 a 30, alquiler ajustado)');
      expect(r.total).toBe('316000.00');
      expect(r.midMonthSplit).toEqual({ effectiveDay: 15, oldDays: 14, newDays: 16 });
    });

    it('Prorrateado usa el conteo de días del prorrateo', () => {
      const dec = (mode: ProrationMode) =>
        built(
          base({
            period: d('2026-12-01'),
            rent: { monthlyAmount: '300000', midMonthChange: { effectiveDate: d('2026-12-15'), newAmount: '330000' } },
            conventions: conv({ midMonthAdjustmentMode: MidMonthAdjustmentMode.Prorrateado, prorationMode: mode }),
          }),
        );
      // DiasReales: 300000 x 14 / 31 = 135483,87 y 330000 x 17 / 31 = 180967,74.
      expect(dec(ProrationMode.DiasReales).lines.map((l) => l.amount)).toEqual(['135483.87', '180967.74']);
      // Mes30: 14 y 16 días de treinta.
      expect(dec(ProrationMode.Mes30).lines.map((l) => l.amount)).toEqual(['140000.00', '176000.00']);
      // Sin prorrateo del mes, el corte se hace por días reales.
      expect(dec(ProrationMode.SinProrrateo).lines.map((l) => l.amount)).toEqual(['135483.87', '180967.74']);
    });

    it('un cambio el día 1 no parte el mes (ya viene en el alquiler)', () => {
      const r = built(
        base({
          rent: { monthlyAmount: '330000', midMonthChange: { effectiveDate: d('2026-11-01'), newAmount: '330000' } },
          conventions: conv({ midMonthAdjustmentMode: MidMonthAdjustmentMode.Prorrateado }),
        }),
      );
      expect(r.lines).toHaveLength(1);
      expect(r.total).toBe('330000.00');
    });

    it('Prorrateado con el contrato empezando después del cambio: todo a alquiler nuevo', () => {
      const r = built(
        base({
          rent: { monthlyAmount: '300000', midMonthChange: { effectiveDate: d('2026-11-15'), newAmount: '330000' } },
          contract: activeFrom('2026-11-20'),
          conventions: conv({ midMonthAdjustmentMode: MidMonthAdjustmentMode.Prorrateado }),
        }),
      );
      expect(r.lines).toHaveLength(1);
      expect(r.total).toBe('121000.00'); // 330000 x 11 / 30
    });

    it('un ajuste provisional en el tramo nuevo vuelve provisional la liquidación', () => {
      const withProvisional = (mode: MidMonthAdjustmentMode) =>
        built(
          base({
            rent: {
              monthlyAmount: '300000',
              midMonthChange: { effectiveDate: d('2026-11-15'), newAmount: '330000', isProvisional: true },
            },
            conventions: conv({ midMonthAdjustmentMode: mode }),
          }),
        );
      expect(withProvisional(MidMonthAdjustmentMode.DesdePeriodoSiguiente).isProvisional).toBe(false);
      expect(withProvisional(MidMonthAdjustmentMode.Prorrateado).isProvisional).toBe(true);
      expect(withProvisional(MidMonthAdjustmentMode.DesdeEsePeriodo).kind).toBe(LiquidacionKind.PagoACuenta);
    });

    it('el descuento en porcentaje corre sobre la suma de los dos tramos', () => {
      const r = built(
        base({
          rent: { monthlyAmount: '300000', midMonthChange: { effectiveDate: d('2026-11-15'), newAmount: '330000' } },
          terms: { dueDay: 10, discountPct: '10' },
          conventions: conv({ midMonthAdjustmentMode: MidMonthAdjustmentMode.Prorrateado }),
        }),
      );
      expect(r.lines[r.lines.length - 1]).toMatchObject({ type: 'Descuento', amount: '31600.00' });
      expect(r.total).toBe('284400.00');
    });
  });

  describe('primer mes con inicio tardío (firstDueMode)', () => {
    const november = (mode: FirstDueMode, start = '2026-11-16', extra: Record<string, unknown> = {}) =>
      buildLiquidation(
        base({ contract: activeFrom(start, extra), conventions: conv({ firstDueMode: mode }) }),
      );
    const december = (mode: FirstDueMode, firstMonth: LiquidationBuilderInput['firstMonth'], start = '2026-11-16') =>
      built(
        base({
          period: d('2026-12-01'),
          contract: activeFrom(start),
          firstMonth,
          conventions: conv({ firstDueMode: mode }),
        }),
      );

    it('DiaDeInicio: se liquida prorrateado y vence el día de inicio', () => {
      const r = november(FirstDueMode.DiaDeInicio) as BuiltLiquidation;
      expect(r.total).toBe('150000.00');
      expect(r.dueDate).toEqual(d('2026-11-16'));
    });

    it('VencimientoMesSiguiente: noviembre no se liquida y diciembre lo suma como renglón', () => {
      expect(november(FirstDueMode.VencimientoMesSiguiente)).toEqual({ skipped: 'DeferredToNextPeriod' });
      const dec = december(FirstDueMode.VencimientoMesSiguiente, { monthlyAmount: '300000' });
      expect(dec.lines.map((l) => [l.description, l.amount, l.sourceType])).toEqual([
        ['Alquiler 12/2026', '300000.00', null],
        ['Alquiler 11/2026 (proporcional: 15 de 30 días; cobrado con este período)', '150000.00', 'DeferredFirstMonth'],
      ]);
      expect(dec.total).toBe('450000.00');
      expect(dec.dueDate).toEqual(d('2026-12-10'));
      expect(dec.includesDeferredFirstMonth).toBe(true);
      expect(dec.lines[1]).toMatchObject({ commissionable: true, beneficiary: 'Locador' });
    });

    it('VencimientoMesSiguiente: el mes diferido respeta el modo de prorrateo', () => {
      const r = built(
        base({
          period: d('2027-01-01'),
          contract: activeFrom('2026-12-16'),
          firstMonth: { monthlyAmount: '300000' },
          conventions: conv({ firstDueMode: FirstDueMode.VencimientoMesSiguiente, prorationMode: ProrationMode.Mes30 }),
        }),
      );
      expect(r.lines[1].amount).toBe('150000.00'); // 15 de 30 y no 16 de 31
    });

    it('VencimientoMesSiguiente: si ese mes ya se liquidó no se cobra dos veces', () => {
      const dec = december(FirstDueMode.VencimientoMesSiguiente, { monthlyAmount: '300000', alreadyBilled: true });
      expect(dec.lines).toHaveLength(1);
      expect(dec.includesDeferredFirstMonth).toBe(false);
    });

    it('VencimientoMesSiguiente: un inicio antes del vencimiento se liquida en su mes', () => {
      const r = november(FirstDueMode.VencimientoMesSiguiente, '2026-11-04') as BuiltLiquidation;
      expect(r.total).toBe('270000.00'); // 27 de 30 días
      expect(r.dueDate).toEqual(d('2026-11-10'));
      expect(december(FirstDueMode.VencimientoMesSiguiente, { monthlyAmount: '300000' }, '2026-11-04').lines).toHaveLength(1);
    });

    it('VencimientoMesSiguiente: si el contrato termina en su primer mes no se difiere', () => {
      const r = november(FirstDueMode.VencimientoMesSiguiente, '2026-11-16', { actualEndDate: d('2026-11-25') });
      expect((r as BuiltLiquidation).total).toBe('100000.00'); // 10 de 30 días
    });

    it('AlFirmar: el primer mes no se liquida, ni siquiera empezando el día 1; el siguiente sí', () => {
      expect(november(FirstDueMode.AlFirmar)).toEqual({ skipped: 'ChargedAtSigning' });
      expect(november(FirstDueMode.AlFirmar, '2026-11-01')).toEqual({ skipped: 'ChargedAtSigning' });
      const dec = december(FirstDueMode.AlFirmar, null);
      expect(dec.lines).toHaveLength(1);
      expect(dec.total).toBe('300000.00');
    });

    it('un contrato que empieza antes no se ve afectado por la convención', () => {
      for (const mode of Object.values(FirstDueMode)) {
        const r = built(base({ conventions: conv({ firstDueMode: mode }) }));
        expect(r.total).toBe('300000.00');
      }
    });
  });

  describe('descuento de monto fijo (fixedDiscountProration)', () => {
    const withFixed = (mode: FixedDiscountProration, fixed: string) =>
      built(
        base({
          contract: activeFrom('2026-11-16'),
          terms: { dueDay: 10, discountAmount: fixed },
          conventions: conv({ fixedDiscountProration: mode }),
        }),
      );

    it('Proporcional se prorratea como el alquiler; Completo no', () => {
      expect(withFixed(FixedDiscountProration.Proporcional, '20000').lines[1].amount).toBe('10000.00');
      expect(withFixed(FixedDiscountProration.Completo, '20000').lines[1].amount).toBe('20000.00');
      expect(withFixed(FixedDiscountProration.Proporcional, '20000').total).toBe('140000.00');
      expect(withFixed(FixedDiscountProration.Completo, '20000').total).toBe('130000.00');
    });

    it('Completo nunca supera el alquiler del mes parcial', () => {
      const r = withFixed(FixedDiscountProration.Completo, '200000');
      expect(r.lines[1].amount).toBe('150000.00');
      expect(r.total).toBe('0.00');
    });

    it('en un mes completo ambos dan lo mismo', () => {
      const full = (mode: FixedDiscountProration) =>
        built(base({ terms: { dueDay: 10, discountAmount: '20000' }, conventions: conv({ fixedDiscountProration: mode }) })).total;
      expect(full(FixedDiscountProration.Proporcional)).toBe(full(FixedDiscountProration.Completo));
    });
  });

  it('combinación: inicio el 16 con Mes30, ajuste el 20 prorrateado y bonificación fija completa', () => {
    // Nov (30 días), empieza el 16: cubre 16 a 30. Cambio el 20: viejo 16..19 = 4 días, nuevo 20..30 = 11 días.
    // 300000 x 4 / 30 = 40000; 330000 x 11 / 30 = 121000; fijo completo 5000 -> total 156000.
    const r = built(
      base({
        contract: activeFrom('2026-11-16'),
        rent: { monthlyAmount: '300000', midMonthChange: { effectiveDate: d('2026-11-20'), newAmount: '330000' } },
        terms: { dueDay: 10, discountAmount: '5000' },
        conventions: {
          prorationMode: ProrationMode.Mes30,
          midMonthAdjustmentMode: MidMonthAdjustmentMode.Prorrateado,
          firstDueMode: FirstDueMode.DiaDeInicio,
          fixedDiscountProration: FixedDiscountProration.Completo,
        },
      }),
    );
    expect(r.lines.map((l) => l.amount)).toEqual(['40000.00', '121000.00', '5000.00']);
    expect(r.total).toBe('156000.00');
    expect(r.dueDate).toEqual(d('2026-11-16'));
  });
});
