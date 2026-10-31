import { buildLiquidation, onBehalfOfText } from './index';
import type { BuiltLiquidation, LiquidationBuilderInput } from './index';
import { ContractStatus, LineBeneficiary, LineItemType, LiquidacionKind } from '../enums';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function base(overrides: Partial<LiquidationBuilderInput> = {}): LiquidationBuilderInput {
  return {
    period: d('2026-11-01'),
    currency: 'ARS',
    contract: { startDate: d('2026-01-01'), endDate: d('2028-12-31'), status: ContractStatus.Activo },
    rent: { monthlyAmount: '300000.00' },
    terms: { dueDay: 10 },
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
