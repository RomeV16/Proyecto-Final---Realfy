import { BadRequestException, ConflictException } from '@nestjs/common';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { ContractsService } from './contracts.service';

const TENANT_ID = 'tenant-1';
const CONTRACT_ID = 'con-1';
const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2027-01-01T00:00:00.000Z');

const EXISTING = {
  id: CONTRACT_ID,
  tenantId: TENANT_ID,
  propertyId: 'prop-1',
  contractType: 'Alquiler',
  status: 'Activo',
  startDate: START,
  endDate: END,
  actualEndDate: null,
  adjustmentType: 'IPC',
  adjustmentPeriod: 'Trimestral',
  customAdjustmentPct: null,
};

function build(existing: Record<string, unknown> = EXISTING, versions = 1) {
  const client: any = {
    contract: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    contractTermsVersion: {
      count: jest.fn().mockResolvedValue(versions),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    contractPeriod: {
      findFirst: jest.fn().mockResolvedValue({ id: 'per-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    adjustmentSchedule: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    property: { findFirst: jest.fn().mockResolvedValue({ id: 'prop-1' }) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const service = new ContractsService(
    { client } as any,
    { getTenantId: () => TENANT_ID } as any,
    {} as any,
    {} as any,
    { get: jest.fn().mockResolvedValue(DEFAULT_OPERATIONAL_DEFAULTS) } as any,
  );
  jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
  return { service, client };
}

const errorCode = (err: any): string => err?.getResponse?.()?.error;

describe('ContractsService — fin real y reglas al editar', () => {
  it('guarda el fin real o prórroga de palabra y rehace el cronograma hasta ese fin', async () => {
    const { service, client } = build();

    await service.update(CONTRACT_ID, { actualEndDate: '2027-04-01T00:00:00.000Z' });

    expect(client.contract.update.mock.calls[0][0].data).toMatchObject({
      actualEndDate: '2027-04-01T00:00:00.000Z',
    });
    expect(client.adjustmentSchedule.deleteMany).toHaveBeenCalled();
    // El cronograma se arma hasta el fin efectivo: lo que ya devolvió el contrato (ver findFirst).
    expect(client.adjustmentSchedule.create).toHaveBeenCalled();
  });

  it('el fin real no puede ser anterior al inicio', async () => {
    const { service, client } = build();
    const err = await service
      .update(CONTRACT_ID, { actualEndDate: '2025-12-31T00:00:00.000Z' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(errorCode(err)).toBe('VALIDATION_ERROR');
    expect(client.contract.update).not.toHaveBeenCalled();
  });

  it('quitar el fin real (null) es válido', async () => {
    const { service, client } = build({ ...EXISTING, actualEndDate: new Date('2027-04-01T00:00:00.000Z') });
    await service.update(CONTRACT_ID, { actualEndDate: null });
    expect(client.contract.update.mock.calls[0][0].data).toMatchObject({ actualEndDate: null });
  });

  it('extender con fin real un contrato activo no puede pisar a otro alquiler activo', async () => {
    const { service, client } = build();
    client.contract.findMany.mockResolvedValue([
      { id: 'otro', startDate: END, endDate: END, actualEndDate: null },
    ]);
    const err = await service
      .update(CONTRACT_ID, { actualEndDate: '2027-04-01T00:00:00.000Z' })
      .catch((e) => e);
    expect(errorCode(err)).toBe('CONTRACT_NOT_ACTIVATABLE');
    expect(client.contract.update).not.toHaveBeenCalled();
  });

  it('corregir la modalidad de un contrato sin convenios actualiza su versión inicial', async () => {
    const { service, client } = build();

    await service.update(CONTRACT_ID, { adjustmentType: 'ICL', adjustmentPeriod: 'Anual' });

    expect(client.contractTermsVersion.updateMany).toHaveBeenCalledWith({
      where: { contractId: CONTRACT_ID },
      data: { adjustmentType: 'ICL', adjustmentPeriod: 'Anual' },
    });
  });

  it('con varias versiones la modalidad solo cambia por convenio (409)', async () => {
    const { service, client } = build(EXISTING, 2);
    const err = await service.update(CONTRACT_ID, { adjustmentType: 'ICL' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(errorCode(err)).toBe('RULES_CHANGE_REQUIRES_AGREEMENT');
    expect(client.contract.update).not.toHaveBeenCalled();
  });

  it('repetir la modalidad vigente no es un cambio de reglas', async () => {
    const { service, client } = build(EXISTING, 2);
    await service.update(CONTRACT_ID, { adjustmentType: 'IPC', notes: 'nota' });
    expect(client.contract.update).toHaveBeenCalled();
    expect(client.contractTermsVersion.updateMany).not.toHaveBeenCalled();
  });

  it('un cambio del fin pactado lleva el último período', async () => {
    const { service, client } = build();
    await service.update(CONTRACT_ID, { endDate: '2027-06-01T00:00:00.000Z' });
    expect(client.contractPeriod.update).toHaveBeenCalledWith({
      where: { id: 'per-1' },
      data: { endDate: new Date('2027-06-01T00:00:00.000Z') },
    });
  });

  it('rebuildPendingSchedule usa el fin efectivo y conserva lo ya calculado', async () => {
    const { service, client } = build({
      ...EXISTING,
      adjustmentPeriod: 'Semestral',
      actualEndDate: new Date('2027-07-01T00:00:00.000Z'),
    });
    client.adjustmentSchedule.findFirst.mockResolvedValue({
      periodNumber: 1,
      nextAdjustmentDate: new Date('2026-07-01T00:00:00.000Z'),
    });

    await service.rebuildPendingSchedule(CONTRACT_ID);

    expect(client.adjustmentSchedule.deleteMany).toHaveBeenCalledWith({
      where: { contractId: CONTRACT_ID, status: 'Pending' },
    });
    const created = client.adjustmentSchedule.create.mock.calls.map((c: any) => [
      c[0].data.periodNumber,
      c[0].data.nextAdjustmentDate.toISOString().slice(0, 10),
    ]);
    // Del ajuste del 2026-07-01 hasta el fin real 2027-07-01: enero y julio de 2027.
    expect(created).toEqual([
      [2, '2027-01-01'],
      [3, '2027-07-01'],
    ]);
  });
});
