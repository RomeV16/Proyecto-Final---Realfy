import {
  CreateContractAgreementSchema,
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
import { CreateIndexDataSchema, UpdateContractSchema } from './contract.schema';

describe('OperationalDefaultsSchema', () => {
  it('un objeto vacío toma los valores por defecto (M1)', () => {
    expect(OperationalDefaultsSchema.parse({})).toEqual({
      dueDay: 10,
      leadDays: 10,
      ipcLagMonths: 2,
      commissionPct: 7,
      fees: { alta: 5, renovacion: 5, ventaConstruido: 3, ventaLote: 5 },
      valuationUsd: 100,
      upfrontThresholdFees: 2,
      collectionCadence: { firstReminderDays: 5, everyDays: 5 },
      expiryLight: { redDays: 0, yellowDays: 60 },
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
