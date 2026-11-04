import {
  IMPORT_ERROR_CODES,
  ImportBankAccountSchema,
  ImportBatchRequestSchema,
  ImportBatchRowsQuerySchema,
  ImportChargeRuleSchema,
  ImportContractSchema,
  ImportPersonSchema,
  ImportPropertySchema,
  ImportServiceSchema,
} from './import-batch.schema';

const contract = {
  externalRef: 'C-1',
  propertyExternalRef: 'U-1',
  status: 'Activo',
  startDate: '2025-01-01',
  endDate: '2027-12-31',
  rentAmount: 150000,
  terms: { adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral' },
};

describe('ImportBatchRequestSchema', () => {
  it('exige dryRun y completa los valores por defecto', () => {
    expect(ImportBatchRequestSchema.safeParse({}).success).toBe(false);
    expect(ImportBatchRequestSchema.parse({ dryRun: true })).toEqual({
      dryRun: true,
      atomic: false,
      kind: 'SistemaAnterior',
      persons: [],
      properties: [],
      contracts: [],
      services: [],
      chargeRules: [],
    });
  });

  it('no valida las filas: eso es por fila y no aborta el lote', () => {
    const parsed = ImportBatchRequestSchema.parse({ dryRun: false, persons: [{ cualquier: 'cosa' }, 7] });
    expect(parsed.persons).toHaveLength(2);
  });

  it('rechaza campos desconocidos', () => {
    expect(ImportBatchRequestSchema.safeParse({ dryRun: true, personas: [] }).success).toBe(false);
  });
});

describe('ImportContractSchema', () => {
  it('lo mínimo es válido y toma los valores por defecto', () => {
    const parsed = ImportContractSchema.parse(contract);
    expect(parsed).toMatchObject({
      contractType: 'Alquiler',
      currency: 'ARS',
      selfManaged: false,
      terms: { adjustmentBase: 'Vigente', fixedInitialMonths: 0, paymentFlow: 'Partido' },
    });
    expect(parsed.tenants).toBeUndefined();
    expect(parsed.lessors).toBeUndefined();
  });

  it.each([
    [{ startDate: '01/01/2025' }, 'startDate'],
    [{ endDate: '2027-13-45' }, 'endDate'],
    [{ status: 'Inventado' }, 'status'],
    [{ rentAmount: -1 }, 'rentAmount'],
    [{ terms: { adjustmentType: 'IPC' } }, 'terms'],
    [{ terms: { adjustmentType: 'IPC', adjustmentPeriod: 'Anual', dueDay: 31 } }, 'terms'],
    [{ lessors: [{ personExternalRef: 'L', payoutPct: 101 }] }, 'lessors'],
    [{ externalRef: '   ' }, 'externalRef'],
  ])('rechaza %j', (patch, field) => {
    const r = ImportContractSchema.safeParse({ ...contract, ...patch });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path[0]).toBe(field);
  });

  it.each(['Custom', 'FixedPercent'])('CP-1305 — un ajuste %s sin porcentaje se rechaza en la fila, con código estable', (adjustmentType) => {
    const r = ImportContractSchema.safeParse({
      ...contract,
      terms: { adjustmentType, adjustmentPeriod: 'Anual' },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path.join('.') === 'terms.customPct');
      expect(issue).toBeDefined();
      expect((issue as { params?: { code?: string } }).params?.code).toBe('MISSING_ADJUSTMENT_PCT');
    }
  });

  it('CP-1306 — con porcentaje, Custom y FixedPercent son válidos; un índice no lo necesita', () => {
    for (const adjustmentType of ['Custom', 'FixedPercent']) {
      expect(
        ImportContractSchema.safeParse({ ...contract, terms: { adjustmentType, adjustmentPeriod: 'Anual', customPct: 8 } }).success,
      ).toBe(true);
    }
    expect(ImportContractSchema.safeParse(contract).success).toBe(true);
  });

  it('acepta fechas ISO con hora y lessors con todos sus campos', () => {
    const r = ImportContractSchema.safeParse({
      ...contract,
      startDate: '2025-01-01T00:00:00.000Z',
      lessors: [
        { personExternalRef: 'L', payoutPct: 100, payeeExternalRef: 'A', bankAccountCbu: '0000000000000000000001', needsReview: true },
      ],
      adjustmentsHistory: [{ periodNumber: 1, appliedAt: '2025-04-01', previousAmount: 1, newAmount: 2, factor: 2 }],
      commission: { percentage: 7 },
    });
    expect(r.success).toBe(true);
  });
});

describe('ImportPropertySchema y ImportBankAccountSchema', () => {
  it('la propiedad exige tipo y referencia', () => {
    expect(ImportPropertySchema.safeParse({ externalRef: 'U' }).success).toBe(false);
    expect(ImportPropertySchema.safeParse({ externalRef: 'U', type: 'Casa' }).success).toBe(true);
    expect(ImportPropertySchema.safeParse({ externalRef: 'U', type: 'Mansion' }).success).toBe(false);
  });

  it('una cuenta necesita CBU o alias y el CBU son 22 dígitos', () => {
    expect(ImportBankAccountSchema.safeParse({ currency: 'ARS' }).success).toBe(false);
    expect(ImportBankAccountSchema.safeParse({ cbu: '123' }).success).toBe(false);
    expect(ImportBankAccountSchema.parse({ alias: 'a.b' }).currency).toBe('ARS');
  });
});

describe('ImportPersonSchema', () => {
  it('una razón social no pide nombre', () => {
    expect(ImportPersonSchema.safeParse({ externalRef: 'P', personType: 'Juridica', businessName: 'Ejemplo SA' }).success).toBe(true);
  });

  it('valida el dígito verificador del CUIT', () => {
    expect(ImportPersonSchema.safeParse({ externalRef: 'P', firstName: 'A', cuit: '20-12345678-0' }).success).toBe(false);
    expect(ImportPersonSchema.safeParse({ externalRef: 'P', firstName: 'A', cuit: '20-12345678-6' }).success).toBe(true);
  });
});

describe('consulta de filas y códigos', () => {
  it('filtra por acción y entidad conocidas', () => {
    expect(ImportBatchRowsQuerySchema.safeParse({ action: 'Error', entity: 'Contrato' }).success).toBe(true);
    expect(ImportBatchRowsQuerySchema.safeParse({ action: 'Otra' }).success).toBe(false);
  });

  it('los códigos de error son únicos', () => {
    expect(new Set(IMPORT_ERROR_CODES).size).toBe(IMPORT_ERROR_CODES.length);
  });
});

describe('ImportServiceSchema', () => {
  const service = {
    externalRef: 'SRV-1-agua',
    propertyRef: 'U-1',
    serviceType: 'Agua',
    amount: 0,
    dueDay: 31,
  };

  it('completa los valores por defecto', () => {
    expect(ImportServiceSchema.parse(service)).toMatchObject({
      currency: 'ARS',
      billingFrequency: 'Mensual',
      hasAnnualOption: false,
      isActive: true,
    });
  });

  it.each([
    [{ amount: -1 }, 'amount'],
    [{ dueDay: 0 }, 'dueDay'],
    [{ dueDay: 32 }, 'dueDay'],
    [{ serviceType: 'Telepatia' }, 'serviceType'],
    [{ propertyRef: undefined }, 'propertyRef'],
    [{ externalRef: ' ' }, 'externalRef'],
    [{ proveedor: 'x' }, ''],
  ])('rechaza %j', (patch, field) => {
    const r = ImportServiceSchema.safeParse({ ...service, ...patch });
    expect(r.success).toBe(false);
    if (!r.success && field) expect(r.error.issues[0].path[0]).toBe(field);
  });

  it('admite proveedor y cuenta nulos', () => {
    expect(ImportServiceSchema.safeParse({ ...service, providerName: null, accountNumber: null, notes: null }).success).toBe(true);
  });
});

describe('ImportChargeRuleSchema', () => {
  const rule = { contractRef: 'C-1', serviceRef: 'SRV-1-agua', payer: 'Inquilino', validFrom: '2025-01-01' };

  it('completa los valores por defecto', () => {
    expect(ImportChargeRuleSchema.parse(rule)).toMatchObject({
      splitMode: 'Porcentaje',
      tenantSharePct: 100,
      paymentPlan: 'Mensual',
      annualRecovery: 'Prorrateado',
      annualInstallments: 12,
      annualDiscountBeneficiary: 'Inquilino',
      remainingInstallmentsOnEnd: 'CobrarEnLiquidacionFinal',
    });
  });

  it.each([
    [{ splitMode: 'Fijo' }, 'fixedAmount'],
    [{ splitMode: 'Fijo', fixedAmount: 0 }, 'fixedAmount'],
    [{ tenantSharePct: 101 }, 'tenantSharePct'],
    [{ tenantSharePct: -1 }, 'tenantSharePct'],
    [{ annualInstallments: 13 }, 'annualInstallments'],
    [{ payer: 'Nadie' }, 'payer'],
    [{ validFrom: '2025-02-30' }, 'validFrom'],
    [{ validFrom: '2025-01-01T00:00:00Z' }, 'validFrom'],
    [{ validFrom: undefined }, 'validFrom'],
    [{ validTo: '2025-12-31' }, ''],
  ])('rechaza %j', (patch, field) => {
    const r = ImportChargeRuleSchema.safeParse({ ...rule, ...patch });
    expect(r.success).toBe(false);
    if (!r.success && field) expect(r.error.issues[0].path[0]).toBe(field);
  });

  it('un reparto fijo con importe es válido', () => {
    expect(ImportChargeRuleSchema.safeParse({ ...rule, splitMode: 'Fijo', fixedAmount: 12000.5 }).success).toBe(true);
  });
});
