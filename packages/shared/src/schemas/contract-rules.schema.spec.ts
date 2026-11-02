import {
  CreateContractAgreementSchema,
  LiquidationConventionsSchema,
  TermsPatchSchema,
  UpdateContractAgreementSchema,
} from './contract-rules.schema';
import {
  DEFAULT_OPERATIONAL_DEFAULTS,
  OperationalDefaultsSchema,
  resolveOperationalDefaults,
} from './operational-defaults.schema';
import {
  operationalDefaultsFormSchema,
  operationalDefaultsFromForm,
  operationalDefaultsToForm,
} from './operational-defaults.form';
import { CreateContractSchema, CreateIndexDataSchema, UpdateContractSchema } from './contract.schema';

describe('OperationalDefaultsSchema', () => {
  it('un objeto vacío toma los valores por defecto (M1)', () => {
    expect(OperationalDefaultsSchema.parse({})).toEqual({
      dueDay: 10,
      leadDays: 10,
      prorationMode: 'DiasReales',
      midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
      firstDueMode: 'DiaDeInicio',
      fixedDiscountProration: 'Proporcional',
      ipcLagMonths: 2,
      allowProvisional: true,
      commissionPct: 7,
      fees: { alta: 5, renovacion: 5, ventaConstruido: 3, ventaLote: 5 },
      valuationUsd: 100,
      upfrontThresholdFees: 2,
      upfrontBasis: 'ComisionPactada',
      collectionCadence: { firstReminderDays: 5, everyDays: 5 },
      expiryLight: { redDays: 30, yellowDays: 60 },
      repairs: { preauthLimit: 0, managementFeePct: 0 },
      cash: {
        lessorDirectOwes: 'TodoLoAjeno',
        partialAllocation: 'Proporcional',
        custodyInAgencyBalance: false,
        receiptSeries: 'Unica',
        receiptWhenLessorReceives: false,
        compensationScope: 'CualquierLocador',
      },
      ownerAccounts: { statementCloseDay: null, lessorChargeTiming: 'AlGenerarEstado' },
    });
  });

  it('un valor parcial se completa campo a campo', () => {
    const parsed = OperationalDefaultsSchema.parse({ fees: { ventaLote: 4 }, dueDay: 7 });
    expect(parsed.fees).toEqual({ alta: 5, renovacion: 5, ventaConstruido: 3, ventaLote: 4 });
    expect(parsed.dueDay).toBe(7);
  });

  it.each([
    [{ dueDay: 0 }],
    [{ dueDay: 29 }],
    [{ dueDay: 1.5 }],
    [{ ipcLagMonths: 13 }],
    [{ commissionPct: -1 }],
    [{ fees: { alta: 101 } }],
    [{ collectionCadence: { everyDays: 0 } }],
    [{ expiryLight: { redDays: 30, yellowDays: 10 } }],
    [{ unknown: true }],
    [{ fees: { otro: 1 } }],
  ])('rechaza %j', (input) => {
    expect(OperationalDefaultsSchema.safeParse(input).success).toBe(false);
  });

  it('resolveOperationalDefaults: null o indefinido dan los del código; lo inválido lanza', () => {
    expect(resolveOperationalDefaults(null)).toBe(DEFAULT_OPERATIONAL_DEFAULTS);
    expect(resolveOperationalDefaults(undefined)).toBe(DEFAULT_OPERATIONAL_DEFAULTS);
    expect(resolveOperationalDefaults({ dueDay: 3 }).dueDay).toBe(3);
    expect(() => resolveOperationalDefaults({ dueDay: 99 })).toThrow();
  });
});

describe('CreateContractAgreementSchema', () => {
  const base = { effectiveFrom: '2026-11-01T00:00:00.000Z' };

  it('una rebaja con termsPatch es válida', () => {
    const parsed = CreateContractAgreementSchema.parse({
      ...base,
      kind: 'Rebaja',
      termsPatch: { discountPct: '10', rentOverride: null },
    });
    expect(parsed.termsPatch).toEqual({ discountPct: '10', rentOverride: null });
  });

  it.each(['CambioRegla', 'Renegociacion', 'Rebaja', 'Bonificacion'])(
    '%s exige un termsPatch no vacío',
    (kind) => {
      expect(CreateContractAgreementSchema.safeParse({ ...base, kind }).success).toBe(false);
      expect(CreateContractAgreementSchema.safeParse({ ...base, kind, termsPatch: {} }).success).toBe(false);
    },
  );

  it.each(['CambioReparto', 'CambioCargo'])('%s no admite termsPatch', (kind) => {
    expect(CreateContractAgreementSchema.safeParse({ ...base, kind }).success).toBe(true);
    expect(
      CreateContractAgreementSchema.safeParse({ ...base, kind, termsPatch: { dueDay: 5 } }).success,
    ).toBe(false);
  });

  it('effectiveTo debe ser posterior a effectiveFrom', () => {
    const result = CreateContractAgreementSchema.safeParse({
      ...base,
      kind: 'CambioReparto',
      effectiveTo: '2026-10-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rechaza campos desconocidos y urls inválidas', () => {
    expect(CreateContractAgreementSchema.safeParse({ ...base, kind: 'CambioReparto', x: 1 }).success).toBe(false);
    expect(
      CreateContractAgreementSchema.safeParse({ ...base, kind: 'CambioReparto', documentUrl: 'no' }).success,
    ).toBe(false);
  });
});

describe('TermsPatchSchema', () => {
  it('acepta un escalonado con escalones crecientes', () => {
    const result = TermsPatchSchema.safeParse({
      adjustmentType: 'Escalonado',
      customSteps: [
        { fromMonth: 1, pct: '10' },
        { fromMonth: 7, pct: '12.5' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    [{ customSteps: [{ fromMonth: 7, pct: '10' }, { fromMonth: 7, pct: '12' }] }],
    [{ customSteps: [] }],
    [{ dueDay: 30 }],
    [{ indexLagMonths: -1 }],
    [{ adjustmentBase: 'Otra' }],
    [{ paymentFlow: 'Nadie' }],
    [{ discountPct: '1.234' }],
    [{ nope: 1 }],
  ])('rechaza %j', (patch) => {
    expect(TermsPatchSchema.safeParse(patch).success).toBe(false);
  });

  it('acepta null para quitar un valor', () => {
    expect(TermsPatchSchema.safeParse({ customPct: null, penaltyConfig: null }).success).toBe(true);
  });
});

describe('UpdateContractAgreementSchema', () => {
  it('solo admite datos del convenio', () => {
    expect(UpdateContractAgreementSchema.safeParse({ notes: 'x' }).success).toBe(true);
    expect(UpdateContractAgreementSchema.safeParse({ kind: 'Rebaja' }).success).toBe(false);
  });
});

describe('UpdateContractSchema.actualEndDate', () => {
  it('acepta una fecha o null para quitarla', () => {
    expect(UpdateContractSchema.safeParse({ actualEndDate: '2027-03-01T00:00:00.000Z' }).success).toBe(true);
    expect(UpdateContractSchema.safeParse({ actualEndDate: null }).success).toBe(true);
    expect(UpdateContractSchema.safeParse({ actualEndDate: 'ayer' }).success).toBe(false);
  });
});

describe('CreateIndexDataSchema estimados', () => {
  const base = { indexType: 'IPC', period: '2026-09-01T00:00:00.000Z', value: '2.5' };

  it('por defecto el valor es oficial', () => {
    expect(CreateIndexDataSchema.parse(base).isEstimate).toBe(false);
  });

  it('un estimado admite su fuente; un oficial no', () => {
    expect(CreateIndexDataSchema.safeParse({ ...base, isEstimate: true, estimateSource: 'REM' }).success).toBe(true);
    expect(CreateIndexDataSchema.safeParse({ ...base, estimateSource: 'REM' }).success).toBe(false);
  });

  it('acepta la tasa activa del BNA como índice', () => {
    expect(CreateIndexDataSchema.safeParse({ ...base, indexType: 'TasaActivaBNA' }).success).toBe(true);
  });
});

describe('operationalDefaultsFormSchema', () => {
  const form = operationalDefaultsToForm(DEFAULT_OPERATIONAL_DEFAULTS);

  it('los valores por defecto hacen ida y vuelta por el formulario', () => {
    expect(operationalDefaultsFormSchema.safeParse(form).success).toBe(true);
    expect(OperationalDefaultsSchema.parse(operationalDefaultsFromForm(form))).toEqual(
      DEFAULT_OPERATIONAL_DEFAULTS,
    );
  });

  it('acepta coma decimal', () => {
    const parsed = operationalDefaultsFormSchema.parse({ ...form, commissionPct: '7,5' });
    expect(operationalDefaultsFromForm(parsed).commissionPct).toBe(7.5);
  });

  it.each([
    ['dueDay', ''],
    ['dueDay', '29'],
    ['dueDay', '1.5'],
    ['commissionPct', 'abc'],
    ['commissionPct', '101'],
    ['everyDays', '0'],
    ['ipcLagMonths', '-1'],
  ])('rechaza %s = %j', (field, value) => {
    const result = operationalDefaultsFormSchema.safeParse({ ...form, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe(field);
  });

  it('el amarillo no puede ser menor que el rojo', () => {
    const result = operationalDefaultsFormSchema.safeParse({ ...form, redDays: '90', yellowDays: '60' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path[0]).toBe('yellowDays');
  });
});

describe('convenciones de liquidación', () => {
  it('los valores por defecto de la inmobiliaria reproducen el comportamiento original', () => {
    expect(DEFAULT_OPERATIONAL_DEFAULTS).toMatchObject({
      prorationMode: 'DiasReales',
      midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
      firstDueMode: 'DiaDeInicio',
      fixedDiscountProration: 'Proporcional',
    });
  });

  it('cada valor por defecto acepta cualquiera de sus opciones y rechaza otras', () => {
    const ok = OperationalDefaultsSchema.parse({
      prorationMode: 'Mes30',
      midMonthAdjustmentMode: 'Prorrateado',
      firstDueMode: 'AlFirmar',
      fixedDiscountProration: 'Completo',
    });
    expect(ok).toMatchObject({ prorationMode: 'Mes30', firstDueMode: 'AlFirmar' });
    expect(() => OperationalDefaultsSchema.parse({ prorationMode: 'Quincena' })).toThrow();
    expect(() => OperationalDefaultsSchema.parse({ firstDueMode: 'Nunca' })).toThrow();
  });

  it('el formulario ida y vuelta conserva las cuatro opciones', () => {
    const saved = OperationalDefaultsSchema.parse({ prorationMode: 'SinProrrateo', fixedDiscountProration: 'Completo' });
    const form = operationalDefaultsToForm(saved);
    expect(form).toMatchObject({ prorationMode: 'SinProrrateo', fixedDiscountProration: 'Completo' });
    expect(operationalDefaultsFormSchema.safeParse(form).success).toBe(true);
    expect(operationalDefaultsFromForm(form)).toMatchObject({
      prorationMode: 'SinProrrateo',
      midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
      firstDueMode: 'DiaDeInicio',
      fixedDiscountProration: 'Completo',
    });
    expect(operationalDefaultsFormSchema.safeParse({ ...form, prorationMode: 'x' }).success).toBe(false);
  });

  it('el convenio acepta las convenciones en termsPatch y rechaza valores inválidos', () => {
    expect(TermsPatchSchema.parse({ prorationMode: 'Mes30', firstDueMode: 'VencimientoMesSiguiente' })).toEqual({
      prorationMode: 'Mes30',
      firstDueMode: 'VencimientoMesSiguiente',
    });
    expect(() => TermsPatchSchema.parse({ prorationMode: 'Quincena' })).toThrow();
  });

  it('el alta y la edición del contrato aceptan liquidationRules parcial y estricto', () => {
    expect(LiquidationConventionsSchema.parse({})).toEqual({});
    expect(LiquidationConventionsSchema.parse({ midMonthAdjustmentMode: 'DesdeEsePeriodo' })).toEqual({
      midMonthAdjustmentMode: 'DesdeEsePeriodo',
    });
    expect(() => LiquidationConventionsSchema.parse({ dueDay: 5 })).toThrow();
    expect(UpdateContractSchema.parse({ liquidationRules: { prorationMode: 'Mes30' } })).toEqual({
      liquidationRules: { prorationMode: 'Mes30' },
    });
    expect(() => UpdateContractSchema.parse({ liquidationRules: { prorationMode: 'x' } })).toThrow();
    const created = CreateContractSchema.parse({
      propertyId: '00000000-0000-4000-8000-000000000001',
      contractType: 'Alquiler',
      startDate: '2026-11-16T00:00:00.000Z',
      endDate: '2028-11-15T00:00:00.000Z',
      rentAmount: '100000',
      adjustmentType: 'IPC',
      adjustmentPeriod: 'Trimestral',
      persons: [{ personId: '00000000-0000-4000-8000-000000000002', role: 'Inquilino' }],
      liquidationRules: { firstDueMode: 'AlFirmar' },
    });
    expect(created.liquidationRules).toEqual({ firstDueMode: 'AlFirmar' });
  });

  it('el anticipo por contrato: base elegible, umbral entero de 0 a 24 o null', () => {
    expect(OperationalDefaultsSchema.parse({ upfrontBasis: 'PorcentajePorDefecto' }).upfrontBasis).toBe('PorcentajePorDefecto');
    expect(() => OperationalDefaultsSchema.parse({ upfrontBasis: 'Otra' })).toThrow();
    const form = operationalDefaultsToForm(OperationalDefaultsSchema.parse({ upfrontBasis: 'PorcentajePorDefecto' }));
    expect(form.upfrontBasis).toBe('PorcentajePorDefecto');
    expect(operationalDefaultsFromForm(form).upfrontBasis).toBe('PorcentajePorDefecto');

    expect(LiquidationConventionsSchema.parse({ upfrontBasis: 'ComisionPactada', upfrontThresholdFees: 3 })).toEqual({
      upfrontBasis: 'ComisionPactada',
      upfrontThresholdFees: 3,
    });
    expect(LiquidationConventionsSchema.parse({ upfrontThresholdFees: null })).toEqual({ upfrontThresholdFees: null });
    for (const bad of [-1, 25, 1.5]) {
      expect(() => LiquidationConventionsSchema.parse({ upfrontThresholdFees: bad })).toThrow();
    }
    expect(TermsPatchSchema.parse({ upfrontThresholdFees: 1, upfrontBasis: 'PorcentajePorDefecto' })).toEqual({
      upfrontThresholdFees: 1,
      upfrontBasis: 'PorcentajePorDefecto',
    });
  });

  it('lo que debe el locador que cobró directamente se pacta por contrato o por convenio; null vuelve al de la inmobiliaria', () => {
    expect(LiquidationConventionsSchema.parse({ lessorDirectOwes: 'SoloInmobiliaria' })).toEqual({
      lessorDirectOwes: 'SoloInmobiliaria',
    });
    expect(TermsPatchSchema.parse({ lessorDirectOwes: null })).toEqual({ lessorDirectOwes: null });
    expect(() => TermsPatchSchema.parse({ lessorDirectOwes: 'Todo' })).toThrow();
  });
});
