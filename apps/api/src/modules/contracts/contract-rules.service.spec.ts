import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ContractRulesService } from './contract-rules.service';

const TENANT_ID = 'tenant-1';
const CONTRACT_ID = 'con-1';
const START = new Date('2026-01-01T00:00:00.000Z');

const BASE_TERMS = {
  id: 'tv-1',
  validFrom: START,
  adjustmentType: 'IPC',
  adjustmentPeriod: 'Trimestral',
  adjustmentBase: 'Vigente',
  indexLagMonths: 2,
  fixedInitialMonths: 0,
  customPct: null,
  customSteps: null,
  rentOverride: null,
  discountPct: null,
  discountAmount: null,
  dueDay: 10,
  paymentFlow: 'Partido',
  penaltyConfig: null,
};

function build(overrides: { terms?: any; contract?: any } = {}) {
  const contract = {
    id: CONTRACT_ID,
    tenantId: TENANT_ID,
    startDate: START,
    adjustmentType: 'IPC',
    adjustmentPeriod: 'Trimestral',
    customAdjustmentPct: null,
    ...overrides.contract,
  };
  const client: any = {
    contract: {
      findFirst: jest.fn().mockResolvedValue(contract),
      update: jest.fn().mockResolvedValue({}),
    },
    contractAgreement: {
      create: jest.fn().mockResolvedValue({ id: 'ag-1' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'ag-1', versions: [] }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    contractTermsVersion: {
      // Con orderBy es getTermsAt (la versión vigente a la fecha pedida); sin él,
      // la búsqueda de una versión que ya empieza ese día.
      findFirst: jest.fn((args: any) => Promise.resolve(args.orderBy ? (overrides.terms ?? BASE_TERMS) : null)),
      findMany: jest.fn().mockResolvedValue([BASE_TERMS]),
      create: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    contractPeriod: { findMany: jest.fn().mockResolvedValue([]) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const prisma: any = { client };
  const tenantContext: any = {
    getTenantId: () => TENANT_ID,
    getUserId: () => 'user-1',
  };
  const contracts: any = { rebuildPendingSchedule: jest.fn().mockResolvedValue(undefined) };
  const service = new ContractRulesService(prisma, tenantContext, contracts);
  return { service, client, contracts };
}

const errorCode = (err: any): string => err?.getResponse?.()?.error;

describe('ContractRulesService — convenios', () => {
  const rebaja = {
    kind: 'Rebaja',
    effectiveFrom: '2026-06-01T00:00:00.000Z',
    termsPatch: { discountPct: '10' },
  };

  it('un convenio con termsPatch crea la versión (copia de la vigente + cambio) con el convenio', async () => {
    const { service, client } = build();

    await service.createAgreement(CONTRACT_ID, rebaja);

    const data = client.contractTermsVersion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: TENANT_ID,
      contractId: CONTRACT_ID,
      agreementId: 'ag-1',
      validFrom: new Date('2026-06-01T00:00:00.000Z'),
      adjustmentType: 'IPC',
      dueDay: 10,
      discountPct: '10',
    });
    // Los JSON nulos se guardan como NULL de base.
    expect(data.customSteps).toBe(Prisma.DbNull);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
  });

  it('el convenio registra quién lo cargó', async () => {
    const { service, client } = build();
    await service.createAgreement(CONTRACT_ID, rebaja);
    expect(client.contractAgreement.create.mock.calls[0][0].data).toMatchObject({
      tenantId: TENANT_ID,
      createdById: 'user-1',
      kind: 'Rebaja',
    });
  });

  it('si rige desde hoy o antes, las columnas del contrato siguen a la versión vigente', async () => {
    const { service, client, contracts } = build({
      terms: { ...BASE_TERMS, adjustmentType: 'FixedPercent', adjustmentPeriod: 'Anual', customPct: '12' },
    });

    await service.createAgreement(CONTRACT_ID, {
      kind: 'CambioRegla',
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      termsPatch: { adjustmentType: 'FixedPercent', adjustmentPeriod: 'Anual', customPct: '12' },
    });

    expect(client.contract.update).toHaveBeenCalledWith({
      where: { id: CONTRACT_ID },
      data: { adjustmentType: 'FixedPercent', adjustmentPeriod: 'Anual', customAdjustmentPct: '12' },
    });
    // Cambió la periodicidad: se rehace el cronograma pendiente.
    expect(contracts.rebuildPendingSchedule).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it('si la versión vigente hoy no cambia las columnas (convenio futuro), el contrato no se toca', async () => {
    const { service, client, contracts } = build();
    await service.createAgreement(CONTRACT_ID, rebaja);
    expect(client.contract.update).not.toHaveBeenCalled();
    expect(contracts.rebuildPendingSchedule).not.toHaveBeenCalled();
  });

  it('un cambio sin variar la periodicidad no rehace el cronograma', async () => {
    const { service, client, contracts } = build({
      terms: { ...BASE_TERMS, adjustmentType: 'ICL' },
    });
    await service.createAgreement(CONTRACT_ID, {
      kind: 'CambioRegla',
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      termsPatch: { adjustmentType: 'ICL' },
    });
    expect(client.contract.update).toHaveBeenCalled();
    expect(contracts.rebuildPendingSchedule).not.toHaveBeenCalled();
  });

  it('un convenio sin cambio de reglas no crea versión', async () => {
    const { service, client } = build();
    await service.createAgreement(CONTRACT_ID, {
      kind: 'CambioReparto',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    });
    expect(client.contractTermsVersion.create).not.toHaveBeenCalled();
    expect(client.contractAgreement.create).toHaveBeenCalled();
  });

  it('rechaza una fecha anterior al inicio del contrato', async () => {
    const { service, client } = build();
    const err = await service
      .createAgreement(CONTRACT_ID, { ...rebaja, effectiveFrom: '2025-12-31T00:00:00.000Z' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(errorCode(err)).toBe('AGREEMENT_BEFORE_START');
    expect(client.contractAgreement.create).not.toHaveBeenCalled();
  });

  it('rechaza dos versiones en la misma fecha (409 TERMS_VERSION_EXISTS)', async () => {
    const { service, client } = build();
    client.contractTermsVersion.findFirst.mockResolvedValueOnce({ id: 'otra' });
    const err = await service.createAgreement(CONTRACT_ID, rebaja).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(errorCode(err)).toBe('TERMS_VERSION_EXISTS');
    expect(client.contractTermsVersion.create).not.toHaveBeenCalled();
  });

  it('una modalidad con porcentaje exige customPct', async () => {
    const { service } = build();
    const err = await service
      .createAgreement(CONTRACT_ID, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { adjustmentType: 'FixedPercent' },
      })
      .catch((e) => e);
    expect(errorCode(err)).toBe('MISSING_ADJUSTMENT_PCT');
  });

  it('el escalonado exige los escalones', async () => {
    const { service } = build();
    const err = await service
      .createAgreement(CONTRACT_ID, {
        kind: 'CambioRegla',
        effectiveFrom: '2026-06-01T00:00:00.000Z',
        termsPatch: { adjustmentType: 'Escalonado' },
      })
      .catch((e) => e);
    expect(errorCode(err)).toBe('VALIDATION_ERROR');
  });

  it('un cuerpo inválido responde VALIDATION_ERROR sin escribir', async () => {
    const { service, client } = build();
    const err = await service
      .createAgreement(CONTRACT_ID, { kind: 'Rebaja', effectiveFrom: '2026-06-01T00:00:00.000Z' })
      .catch((e) => e);
    expect(errorCode(err)).toBe('VALIDATION_ERROR');
    expect(client.contractAgreement.create).not.toHaveBeenCalled();
  });

  it('un contrato inexistente responde 404', async () => {
    const { service, client } = build();
    client.contract.findFirst.mockResolvedValue(null);
    await expect(service.createAgreement(CONTRACT_ID, rebaja)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ContractRulesService — cambio y baja', () => {
  const withVersion = { id: 'ag-1', versions: [{ validFrom: new Date('2026-06-01T00:00:00.000Z') }] };

  it('no se toca ni se borra un convenio del que depende una versión posterior (409)', async () => {
    const { service, client } = build();
    client.contractAgreement.findFirst.mockResolvedValue(withVersion);
    client.contractTermsVersion.count.mockResolvedValue(1);

    const patched = await service.updateAgreement(CONTRACT_ID, 'ag-1', { notes: 'x' }).catch((e) => e);
    const removed = await service.removeAgreement(CONTRACT_ID, 'ag-1').catch((e) => e);

    expect(errorCode(patched)).toBe('AGREEMENT_HAS_LATER_VERSIONS');
    expect(errorCode(removed)).toBe('AGREEMENT_HAS_LATER_VERSIONS');
    expect(client.contractAgreement.update).not.toHaveBeenCalled();
    expect(client.contractAgreement.delete).not.toHaveBeenCalled();
  });

  it('el último convenio se corrige', async () => {
    const { service, client } = build();
    client.contractAgreement.findFirst.mockResolvedValue(withVersion);

    await service.updateAgreement(CONTRACT_ID, 'ag-1', { notes: 'nota', effectiveTo: null });

    expect(client.contractAgreement.update).toHaveBeenCalledWith({
      where: { id: 'ag-1' },
      data: { effectiveTo: null, notes: 'nota' },
    });
  });

  it('el último convenio se borra con su versión y las columnas vuelven a la vigente', async () => {
    const { service, client } = build({ contract: { adjustmentType: 'ICL' } });
    client.contractAgreement.findFirst.mockResolvedValue(withVersion);

    await expect(service.removeAgreement(CONTRACT_ID, 'ag-1')).resolves.toEqual({ deleted: true });

    expect(client.contractTermsVersion.deleteMany).toHaveBeenCalledWith({ where: { agreementId: 'ag-1' } });
    expect(client.contractAgreement.delete).toHaveBeenCalledWith({ where: { id: 'ag-1' } });
    expect(client.contract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ adjustmentType: 'IPC' }) }),
    );
  });

  it('un convenio inexistente responde 404', async () => {
    const { service, client } = build();
    client.contractAgreement.findFirst.mockResolvedValue(null);
    const err = await service.removeAgreement(CONTRACT_ID, 'nada').catch((e) => e);
    expect(errorCode(err)).toBe('AGREEMENT_NOT_FOUND');
  });
});

describe('ContractRulesService — lecturas', () => {
  it('listTerms devuelve las versiones y la vigente a la fecha', async () => {
    const { service, client } = build();

    const result = await service.listTerms(CONTRACT_ID, '2026-05-01T00:00:00.000Z');

    expect(result.at).toBe('2026-05-01T00:00:00.000Z');
    expect(result.current).toMatchObject({ id: 'tv-1' });
    expect(result.versions).toHaveLength(1);
    expect(client.contractTermsVersion.findFirst.mock.calls[0][0].where.validFrom).toEqual({
      lte: new Date('2026-05-01T00:00:00.000Z'),
    });
  });

  it('listTerms rechaza una fecha inválida', async () => {
    const { service } = build();
    await expect(service.listTerms(CONTRACT_ID, 'ayer')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listPeriods y listAgreements piden por contrato en orden', async () => {
    const { service, client } = build();
    await service.listPeriods(CONTRACT_ID);
    await service.listAgreements(CONTRACT_ID);
    expect(client.contractPeriod.findMany).toHaveBeenCalledWith({
      where: { contractId: CONTRACT_ID },
      orderBy: { seq: 'asc' },
    });
    expect(client.contractAgreement.findMany.mock.calls[0][0].where).toEqual({ contractId: CONTRACT_ID });
  });
});
