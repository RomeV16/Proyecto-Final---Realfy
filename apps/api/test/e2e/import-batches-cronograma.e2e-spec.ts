import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, cleanDatabase, teardownTestApp, registerUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';

/** Primer día del mes que está `months` meses del actual (UTC), como `YYYY-MM-DD`. */
const first = (months: number): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1)).toISOString().slice(0, 10);
};

/** Ajustes encadenados (+10 % cada uno) que parten de 100.000 en las fechas dadas. */
function history(dates: string[], periodNumbers?: number[]) {
  let previous = 100000;
  return dates.map((appliedAt, i) => {
    const newAmount = Math.round(previous * 1.1);
    const entry = { periodNumber: periodNumbers?.[i] ?? i + 1, appliedAt, previousAmount: previous, newAmount };
    previous = newAmount;
    return entry;
  });
}

function contractRow(overrides: Record<string, unknown> = {}) {
  const adjustmentsHistory = (overrides.adjustmentsHistory as ReturnType<typeof history> | undefined) ?? [];
  const rentAmount = adjustmentsHistory.length ? adjustmentsHistory[adjustmentsHistory.length - 1].newAmount : 100000;
  return {
    externalRef: 'C-CRON',
    propertyExternalRef: 'U-CRON',
    status: 'Activo',
    startDate: first(-10),
    endDate: first(24),
    rentAmount,
    currency: 'ARS',
    initialRent: 100000,
    tenants: ['P-INQ'],
    lessors: [{ personExternalRef: 'P-LOC', payoutPct: 100 }],
    terms: { adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral', dueDay: 10 },
    commission: { type: 'FixedPercent', percentage: 7, adminFee: 0 },
    ...overrides,
  };
}

/** Lote sintético: un locador, un inquilino, una unidad y el contrato dado. */
const lote = (contract: Record<string, unknown>) => ({
  persons: [
    { externalRef: 'P-LOC', firstName: 'Luz', lastName: 'Locadora', dni: '10000001', roles: ['Propietario'] },
    { externalRef: 'P-INQ', firstName: 'Ines', lastName: 'Inquilina', dni: '20000001', roles: ['Inquilino'] },
  ],
  properties: [
    {
      externalRef: 'U-CRON',
      type: 'Departamento',
      street: 'Calle Falsa',
      number: '123',
      city: 'Cordoba',
      owners: [{ personExternalRef: 'P-LOC', sharePct: 100 }],
    },
  ],
  contracts: [contract],
});

describe('Importación: cronograma de ajustes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    const admin = await registerUser(app, {
      email: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    token = admin.accessToken;
  });

  const http = () => request(app.getHttpServer());
  const importar = (contract: Record<string, unknown>) =>
    http().post('/api/import/batches').set('Authorization', `Bearer ${token}`).send({ dryRun: false, ...lote(contract) }).expect(201);
  const rowOf = (res: request.Response) => res.body.rows.find((r: any) => r.externalRef === 'C-CRON');

  const schedule = async () =>
    (
      await prisma.baseClient.adjustmentSchedule.findMany({
        where: { contract: { externalRef: 'C-CRON' } },
        orderBy: { periodNumber: 'asc' },
      })
    ).map((s) => ({ k: s.periodNumber, date: s.nextAdjustmentDate.toISOString().slice(0, 10), status: s.status }));
  const statuses = async (upTo: number) => (await schedule()).filter((s) => s.k <= upTo).map((s) => s.status);
  const adjustmentPeriods = async () =>
    (
      await prisma.baseClient.contractAdjustment.findMany({
        where: { contract: { externalRef: 'C-CRON' } },
        orderBy: { periodNumber: 'asc' },
      })
    ).map((a) => a.periodNumber);

  describe('el período del historial sale de la fecha (DEF-125)', () => {
    it('CP-1243 — un ajuste cuya fecha no cae en un período del cronograma es ADJUSTMENT_HISTORY_INVALID', async () => {
      // Trimestral desde hace 2 meses y un ajuste "del período 1" un mes después del inicio.
      const res = await importar(
        contractRow({ startDate: first(-2), adjustmentsHistory: history([first(-1)]) }),
      );

      expect(rowOf(res).action).toBe('Error');
      expect(rowOf(res).errors[0]).toMatchObject({ code: 'ADJUSTMENT_HISTORY_INVALID' });
      expect(await prisma.baseClient.contract.count({ where: { externalRef: 'C-CRON' } })).toBe(0);
    });

    it('CP-1244 — el período lo da la fecha aunque el lote traiga otro número', async () => {
      // El ajuste de hace 4 meses es el período 2 (inicio hace 10, trimestral); el lote dice 1.
      const res = await importar(contractRow({ adjustmentsHistory: history([first(-4)], [1]) }));

      expect(rowOf(res).action).toBe('Creado');
      expect(await statuses(3)).toEqual(['Skipped', 'Applied', 'Pending']);
      expect(await adjustmentPeriods()).toEqual([2]);
    });

    it('CP-1245 — un ajuste con fecha futura se rechaza: nunca queda aplicado un período que no llegó', async () => {
      const res = await importar(contractRow({ adjustmentsHistory: history([first(-4), first(2)]) }));

      expect(rowOf(res).errors[0]).toMatchObject({ code: 'ADJUSTMENT_HISTORY_INVALID' });
      expect(await prisma.baseClient.adjustmentSchedule.count()).toBe(0);
    });
  });

  describe('los períodos vencidos después del último ajuste son aplicables (DEF-126)', () => {
    it('CP-1246 — quedan Pending y la vista previa del mes los lista como atrasados', async () => {
      await importar(contractRow({ adjustmentsHistory: history([first(-7), first(-4)]) }));

      // Período 3 venció el mes pasado y no tiene historial: pendiente atrasado.
      expect(await statuses(4)).toEqual(['Applied', 'Applied', 'Pending', 'Pending']);
      const contract = await prisma.baseClient.contract.findFirstOrThrow({ where: { externalRef: 'C-CRON' } });
      const preview = await http()
        .post('/api/adjustments/preview-batch')
        .set('Authorization', `Bearer ${token}`)
        .send({ period: first(0).slice(0, 7) })
        .expect(201);
      const row = preview.body.rows.find((r: any) => r.contractId === contract.id);
      expect(row).toMatchObject({ periodNumber: 3, overdue: true });
    });

    it('CP-1247 — el período anterior al último ajuste sin historial queda Skipped', async () => {
      // Historial sólo del período 3: los períodos 1 y 2 quedan salteados, los posteriores pendientes.
      await importar(contractRow({ adjustmentsHistory: history([first(-1)]) }));

      expect(await statuses(4)).toEqual(['Skipped', 'Skipped', 'Applied', 'Pending']);
    });

    it('CP-1248 — sin historial no hay último ajuste: los vencidos siguen Skipped y los futuros Pending', async () => {
      await importar(contractRow());

      expect(await statuses(4)).toEqual(['Skipped', 'Skipped', 'Skipped', 'Pending']);
    });
  });

  describe('reenviar el lote actualiza el cronograma (DEF-127, DEF-128, DEF-129)', () => {
    it('CP-1249 — un ajuste nuevo en el historial pasa su período a Applied y deja los siguientes Pending', async () => {
      await importar(contractRow({ adjustmentsHistory: history([first(-7), first(-4)]) }));
      expect((await statuses(3))[2]).toBe('Pending');

      const res = await importar(contractRow({ adjustmentsHistory: history([first(-7), first(-4), first(-1)]) }));

      expect(rowOf(res).action).toBe('Actualizado');
      expect(await statuses(4)).toEqual(['Applied', 'Applied', 'Applied', 'Pending']);
      expect(await adjustmentPeriods()).toEqual([1, 2, 3]);
    });

    it('CP-1250 — reenviar el mismo lote otra vez es SinCambios y no duplica períodos', async () => {
      const body = contractRow({ adjustmentsHistory: history([first(-7), first(-4)]) });
      await importar(body);
      const before = await schedule();

      const again = await importar(body);

      expect(rowOf(again).action).toBe('SinCambios');
      expect(await schedule()).toEqual(before);
    });

    it('CP-1251 — con otro período de ajuste se reconstruyen los pendientes con las fechas nuevas', async () => {
      const start = first(-1);
      await importar(contractRow({ startDate: start, terms: { adjustmentType: 'IPC', adjustmentPeriod: 'Cuatrimestral', dueDay: 10 } }));

      const res = await importar(contractRow({ startDate: start }));

      expect(rowOf(res).action).toBe('Actualizado');
      const rows = await schedule();
      expect(rows.slice(0, 3).map((s) => s.date)).toEqual([first(2), first(5), first(8)]);
      expect(new Set(rows.map((s) => s.date)).size).toBe(rows.length);
      expect(rows.every((s) => s.status === 'Pending')).toBe(true);
    });

    it('CP-1252 — Semestral a Trimestral con un ajuste aplicado: sin fechas repetidas y el aplicado no se pisa', async () => {
      const start = first(-8);
      const semestral = { adjustmentType: 'IPC', adjustmentPeriod: 'Semestral', dueDay: 10 };
      const applied = history([first(-2)]);
      await importar(contractRow({ startDate: start, terms: semestral, adjustmentsHistory: applied }));

      await importar(contractRow({ startDate: start, adjustmentsHistory: applied }));

      const rows = await schedule();
      expect(new Set(rows.map((s) => s.date)).size).toBe(rows.length);
      // Trimestral desde hace 8 meses: el ajuste de hace 2 meses es el período 2; el 1 (hace 5) quedó atrás.
      expect(rows.slice(0, 4)).toEqual([
        { k: 1, date: first(-5), status: 'Skipped' },
        { k: 2, date: first(-2), status: 'Applied' },
        { k: 3, date: first(1), status: 'Pending' },
        { k: 4, date: first(4), status: 'Pending' },
      ]);
    });

    it('CP-1253 — un ajuste aplicado por el sistema (fuera del historial) no se revierte al reenviar el lote', async () => {
      const body = contractRow({ adjustmentsHistory: history([first(-7)]) });
      await importar(body);
      const contract = await prisma.baseClient.contract.findFirstOrThrow({ where: { externalRef: 'C-CRON' } });
      await prisma.baseClient.contractAdjustment.create({
        data: {
          tenantId: contract.tenantId,
          contractId: contract.id,
          periodNumber: 2,
          adjustmentDate: new Date(`${first(-4)}T00:00:00.000Z`),
          previousAmount: 110000,
          newAmount: 120000,
          percentage: 9.0909,
          calculatedAt: new Date(),
          appliedAt: new Date(),
        },
      });
      await prisma.baseClient.adjustmentSchedule.updateMany({
        where: { contractId: contract.id, periodNumber: 2 },
        data: { status: 'Applied' },
      });

      await importar(body);

      expect(await statuses(3)).toEqual(['Applied', 'Applied', 'Pending']);
      expect(await adjustmentPeriods()).toEqual([1, 2]);
    });

    it('CP-1254 — los ajustes cargados antes con el número equivocado pasan al período de su fecha sin duplicarse', async () => {
      const body = contractRow({ adjustmentsHistory: history([first(-4), first(-1)], [1, 2]) });
      await importar(body);
      // Estado que dejó el importador anterior: períodos 1 y 2 aplicados, aunque las fechas son los períodos 2 y 3.
      const contract = await prisma.baseClient.contract.findFirstOrThrow({ where: { externalRef: 'C-CRON' } });
      await prisma.baseClient.contractAdjustment.deleteMany({ where: { contractId: contract.id } });
      const legacy = history([first(-4), first(-1)], [1, 2]);
      for (const h of legacy) {
        await prisma.baseClient.contractAdjustment.create({
          data: {
            tenantId: contract.tenantId,
            contractId: contract.id,
            periodNumber: h.periodNumber,
            adjustmentDate: new Date(`${h.appliedAt}T00:00:00.000Z`),
            previousAmount: h.previousAmount,
            newAmount: h.newAmount,
            percentage: 10,
            notes: 'Imported',
            calculatedAt: new Date(),
            appliedAt: new Date(`${h.appliedAt}T00:00:00.000Z`),
          },
        });
      }
      await prisma.baseClient.adjustmentSchedule.updateMany({ where: { contractId: contract.id, periodNumber: { in: [1, 2] } }, data: { status: 'Applied' } });
      await prisma.baseClient.adjustmentSchedule.updateMany({ where: { contractId: contract.id, periodNumber: { in: [3, 4] } }, data: { status: 'Pending' } });

      const res = await importar(body);

      expect(rowOf(res).action).toBe('Actualizado');
      expect(await adjustmentPeriods()).toEqual([2, 3]);
      expect(await statuses(4)).toEqual(['Skipped', 'Applied', 'Applied', 'Pending']);
    });
  });
});
