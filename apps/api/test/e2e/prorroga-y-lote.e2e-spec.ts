import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, cleanDatabase, teardownTestApp, registerUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PersonRole, PropertyType, ContractType, AdjustmentType, AdjustmentPeriod } from '@realfy/shared';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const dayOf = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

describe('Prórroga de palabra y aplicación masiva sobre contratos importados (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let tenantId: string;

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
      email: 'admin@prorroga.test',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    token = admin.accessToken;
    tenantId = admin.user.tenantId;
  });

  const post = (path: string, body: object = {}) =>
    request(app.getHttpServer()).post(`/api${path}`).set({ Authorization: `Bearer ${token}` }).send(body);

  /** Contrato activo de $100.000 con el cronograma que arma el alta (hasta el fin pactado). */
  async function activeContract(
    startDate: string,
    endDate: string,
    adjustmentType: AdjustmentType,
    adjustmentPeriod = AdjustmentPeriod.Trimestral,
  ) {
    const owner = (await post('/persons', { firstName: 'Ana', lastName: 'Sintética' }).expect(201)).body.id;
    const tenantPerson = (await post('/persons', { firstName: 'Ines', lastName: 'Sintética' }).expect(201)).body.id;
    await post(`/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post('/properties', {
      title: `Unidad ${Math.random().toString(36).slice(2, 7)}`,
      type: PropertyType.Departamento,
    }).expect(201);
    const res = await post('/contracts', {
      propertyId: property.body.id,
      contractType: ContractType.Alquiler,
      startDate: `${startDate}T00:00:00.000Z`,
      endDate: `${endDate}T00:00:00.000Z`,
      rentAmount: '100000.00',
      adjustmentType,
      adjustmentPeriod,
      ...(adjustmentType === AdjustmentType.FixedPercent ? { customAdjustmentPct: '10.00' } : {}),
      guarantees: [],
      persons: [
        { personId: owner, role: PersonRole.Propietario },
        { personId: tenantPerson, role: PersonRole.Inquilino },
      ],
    }).expect(201);
    await prisma.baseClient.contract.update({ where: { id: res.body.id }, data: { status: 'Activo' } });
    return res.body.id as string;
  }

  /** Un ajuste ya aplicado del historial (de $rent a $rent*1.1), como lo deja la importación. */
  const history = (contractId: string, periodNumber: number, date: string, previous: number) =>
    prisma.baseClient.contractAdjustment.create({
      data: {
        tenantId,
        contractId,
        periodNumber,
        adjustmentDate: day(date),
        previousAmount: previous.toFixed(2),
        newAmount: (previous * 1.1).toFixed(2),
        percentage: '10.0000',
        currency: 'ARS',
        calculatedAt: day(date),
        appliedAt: day(date),
        notes: 'Imported',
      },
    });

  const schedules = (contractId: string) =>
    prisma.baseClient.adjustmentSchedule.findMany({ where: { contractId }, orderBy: { periodNumber: 'asc' } });

  it('CP-1280 — la prórroga de palabra no crea pendientes ya cubiertos por el historial y el lote los aplica', async () => {
    const id = await activeContract('2025-01-01', '2025-12-31', AdjustmentType.FixedPercent);
    // El historial siguió después del fin pactado: seis ajustes, el último en julio de 2026.
    await prisma.baseClient.adjustmentSchedule.updateMany({ where: { contractId: id }, data: { status: 'Applied' } });
    let rent = 100000;
    const dates = ['2025-04-01', '2025-07-01', '2025-10-01', '2026-01-01', '2026-04-01', '2026-07-01'];
    for (const [i, date] of dates.entries()) {
      await history(id, i + 1, date, rent);
      rent *= 1.1;
    }
    await prisma.baseClient.contract.update({ where: { id }, data: { rentAmount: rent.toFixed(2) } });

    await post(`/contracts/${id}/oral-extension`, { until: '2027-06-30', note: 'Hablado' }).expect(201);

    const pending = (await schedules(id)).filter((s) => s.status === 'Pending');
    expect(pending.map((s) => [s.periodNumber, dayOf(s.nextAdjustmentDate)])).toEqual([
      [7, '2026-10-01'],
      [8, '2027-01-01'],
      [9, '2027-04-01'],
    ]);

    const preview = await post('/adjustments/preview-batch', { period: '2026-10' }).expect(201);
    expect(preview.body.rows.find((r: any) => r.contractId === id)).toMatchObject({ periodNumber: 7, status: 'ready' });
    const res = await post('/adjustments/apply-batch', { period: '2026-10', contractIds: [id] }).expect(201);
    expect(res.body.results[0]).toMatchObject({ contractId: id, result: 'applied', status: 'applied' });
    const adjustments = await prisma.baseClient.contractAdjustment.count({ where: { contractId: id } });
    expect(adjustments).toBe(7);
  });

  it('CP-1281 — un contrato que choca no corta el lote: cada contrato informa su resultado', async () => {
    const a = await activeContract('2026-07-01', '2027-07-01', AdjustmentType.FixedPercent);
    const b = await activeContract('2026-07-01', '2027-07-01', AdjustmentType.FixedPercent);
    const c = await activeContract('2026-07-01', '2027-07-01', AdjustmentType.FixedPercent);
    // El período 1 de b ya figura en el historial: aplicar su cronograma viola el índice único.
    await history(b, 1, '2026-10-01', 100000);

    const res = await post('/adjustments/apply-batch', { period: '2026-10', contractIds: [a, b, c] }).expect(201);

    expect(res.body.results.map((r: any) => [r.contractId, r.result])).toEqual([
      [a, 'applied'],
      [b, 'error'],
      [c, 'applied'],
    ]);
    expect(res.body.results[1].reason).toBe('CONFLICT');
    const rents = await prisma.baseClient.contract.findMany({
      where: { id: { in: [a, b, c] } },
      select: { id: true, rentAmount: true },
    });
    const rentOf = (id: string) => rents.find((r) => r.id === id)!.rentAmount.toString();
    expect(rentOf(a)).toBe('110000');
    expect(rentOf(b)).toBe('100000');
    expect(rentOf(c)).toBe('110000');
  });

  it('CP-1282 — sin cronograma aplicado, el primer ajuste no acumula los períodos salteados al importar', async () => {
    const id = await activeContract('2024-10-01', '2026-09-30', AdjustmentType.IPC);
    // Importado sin historial: todos los períodos vencidos quedaron salteados.
    await prisma.baseClient.adjustmentSchedule.updateMany({ where: { contractId: id }, data: { status: 'Skipped' } });
    for (let m = 0; m < 26; m++) {
      const period = new Date(Date.UTC(2024, 7 + m, 1)).toISOString().slice(0, 10);
      await prisma.baseClient.indexData.create({
        data: { tenantId, indexType: 'IPC', period: day(period), value: '2.000000', source: 'INDEC', isEstimate: false },
      });
    }
    await post(`/contracts/${id}/oral-extension`, { until: '2027-12-31', note: 'Hablado' }).expect(201);

    const preview = await post('/adjustments/preview-batch', { period: '2026-10' }).expect(201);
    const row = preview.body.rows.find((r: any) => r.contractId === id);

    expect(row.status).toBe('ready');
    const periods: string[] = row.indexValues.map((v: any) => v.period);
    // Un trimestre de variación mensual (con el rezago de la inmobiliaria), no veinticuatro meses.
    expect(periods.length).toBeLessThanOrEqual(3);
    expect(periods.every((p) => p >= '2026-05')).toBe(true);
  });
});
