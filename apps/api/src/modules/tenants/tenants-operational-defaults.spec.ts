import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DEFAULT_OPERATIONAL_DEFAULTS } from '@realfy/shared';
import { TenantsService } from './tenants.service';
import { OperationalDefaultsService } from './operational-defaults.service';

describe('Valores por defecto de la inmobiliaria', () => {
  const buildPrisma = (stored: unknown) => {
    const baseClient = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ operationalDefaults: stored }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { baseClient } as any;
  };

  const build = (tenantId: string | undefined, stored: unknown = null) => {
    const prisma = buildPrisma(stored);
    const defaults = new OperationalDefaultsService(prisma);
    const ctx = { getTenantId: () => tenantId };
    const service = new TenantsService(prisma, ctx as never, {} as never, defaults);
    return { service, prisma, defaults };
  };

  it('sin valores guardados rigen los del código (M1)', async () => {
    const { service } = build('t1');
    const values = await service.getOperationalDefaults();
    expect(values).toEqual(DEFAULT_OPERATIONAL_DEFAULTS);
    expect(values).toMatchObject({
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

  it('un valor parcial guardado se completa con los del código', async () => {
    const { service } = build('t1', { dueDay: 5, fees: { alta: 6 } });
    const values = await service.getOperationalDefaults();
    expect(values.dueDay).toBe(5);
    expect(values.fees).toEqual({ alta: 6, renovacion: 5, ventaConstruido: 3, ventaLote: 5 });
    expect(values.ipcLagMonths).toBe(2);
  });

  it('exige contexto de inmobiliaria', async () => {
    await expect(build(undefined).service.getOperationalDefaults()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('guarda un valor completo en la inmobiliaria del contexto', async () => {
    const { service, prisma } = build('t1');
    const saved = await service.updateOperationalDefaults({ dueDay: 8 });
    expect(saved.dueDay).toBe(8);
    expect(saved.commissionPct).toBe(7);
    expect(prisma.baseClient.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { operationalDefaults: saved },
    });
  });

  it.each([
    ['día fuera de rango', { dueDay: 31 }],
    ['campo desconocido', { surprise: 1 }],
    ['porcentaje mayor a 100', { commissionPct: 101 }],
    ['semáforo invertido', { expiryLight: { redDays: 90, yellowDays: 60 } }],
    ['rezago negativo', { ipcLagMonths: -1 }],
  ])('rechaza con 400: %s', async (_name, body) => {
    const { service, prisma } = build('t1');
    await expect(service.updateOperationalDefaults(body)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.baseClient.tenant.update).not.toHaveBeenCalled();
  });
});
