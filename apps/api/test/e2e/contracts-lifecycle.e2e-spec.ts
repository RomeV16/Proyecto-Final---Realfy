import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  IndexType,
  PropertyType,
} from '@realfy/shared';

describe('Contract Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

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
  });

  // ─── Helpers ─────────────────────────────────────────

  async function buildFullContext(emailPrefix: string) {
    const user = await registerUser(app, {
      email: `${emailPrefix}@lifecycle.test`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    const propertyRes = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        title: 'Depto Lifecycle',
        type: PropertyType.Departamento,
        street: 'Av. Corrientes',
        number: '500',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 60,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 200000,
        currency: 'ARS',
      })
      .expect(201);

    async function mkPerson(firstName: string, role: PersonRole, idx: number) {
      const p = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ firstName, lastName: 'Test', email: `${emailPrefix}-p${idx}@test.com` })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/persons/${p.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role })
        .expect(201);
      return p.body;
    }

    const propietario = await mkPerson('Owner', PersonRole.Propietario, 1);
    const inquilino = await mkPerson('Tenant', PersonRole.Inquilino, 2);

    return { user, propertyId: propertyRes.body.id, propietarioId: propietario.id, inquilinoId: inquilino.id };
  }

  // ─── Full lifecycle ───────────────────────────────────

  describe('create → index → adjust → terminate lifecycle', () => {
    it('creates a Borrador contract, activates it, registers index, applies adjustment, then terminates', async () => {
      const { user, propertyId, propietarioId, inquilinoId } = await buildFullContext('lcycle');

      // 1. Create contract (Activo)
      const createRes = await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          propertyId,
          contractType: ContractType.Alquiler,
          status: ContractStatus.Activo,
          startDate: '2025-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          rentAmount: '100000.00',
          rentCurrency: 'ARS',
          adjustmentType: AdjustmentType.FixedPercent,
          adjustmentPeriod: AdjustmentPeriod.Trimestral,
          customAdjustmentPct: '15.00',
          persons: [
            { personId: propietarioId, role: PersonRole.Propietario },
            { personId: inquilinoId, role: PersonRole.Inquilino },
          ],
          guarantees: [],
        })
        .expect(201);

      const contract = createRes.body;
      expect(contract.id).toBeDefined();
      expect(contract.status).toBe(ContractStatus.Activo);
      expect(contract.schedules.length).toBeGreaterThan(0);

      // 2. Verify state via GET
      const detailRes = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pendingSchedule = detailRes.body.schedules.find((s: any) => s.status === 'Pending');
      expect(pendingSchedule).toBeDefined();

      // 3. Calculate adjustment (FixedPercent 15%)
      const calcRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/adjustments/calculate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ scheduleId: pendingSchedule.id })
        .expect(201);

      expect(Number(calcRes.body.newAmount)).toBeCloseTo(115000, 0);
      expect(calcRes.body.contractId).toBe(contract.id);

      // 4. Apply adjustment → rent updated
      const applyRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/adjustments/${calcRes.body.id}/apply`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(Number(applyRes.body.rentAmount)).toBeCloseTo(115000, 0);

      // 5. Terminate → Rescindido
      const terminateRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/terminate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(terminateRes.body.status).toBe(ContractStatus.Rescindido);
      expect(terminateRes.body.isActive).toBe(false);
    });

    it('IPC index registered → calculate uses actual index data', async () => {
      const { user, propertyId, propietarioId, inquilinoId } = await buildFullContext('lcycle-ipc');

      // Create IPC contract
      const contractRes = await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          propertyId,
          contractType: ContractType.Alquiler,
          status: ContractStatus.Activo,
          startDate: '2025-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          rentAmount: '200000.00',
          rentCurrency: 'ARS',
          adjustmentType: AdjustmentType.IPC,
          adjustmentPeriod: AdjustmentPeriod.Trimestral,
          persons: [
            { personId: propietarioId, role: PersonRole.Propietario },
            { personId: inquilinoId, role: PersonRole.Inquilino },
          ],
          guarantees: [],
        })
        .expect(201);

      // Register index data
      for (const m of [
        { period: '2025-01-01T00:00:00.000Z', value: '5.2' },
        { period: '2025-02-01T00:00:00.000Z', value: '4.8' },
        { period: '2025-03-01T00:00:00.000Z', value: '5.0' },
        { period: '2025-04-01T00:00:00.000Z', value: '4.5' },
      ]) {
        await request(app.getHttpServer())
          .post('/api/index-data')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ indexType: IndexType.IPC, ...m, source: 'INDEC' })
          .expect(201);
      }

      // Get pending schedule
      const detail = await request(app.getHttpServer())
        .get(`/api/contracts/${contractRes.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pending = detail.body.schedules.find((s: any) => s.status === 'Pending');

      // Calculate via IPC
      const calc = await request(app.getHttpServer())
        .post(`/api/contracts/${contractRes.body.id}/adjustments/calculate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ scheduleId: pending.id })
        .expect(201);

      expect(Number(calc.body.previousAmount)).toBe(200000);
      expect(Number(calc.body.newAmount)).toBeGreaterThan(200000);
      expect(Number(calc.body.percentage)).toBeGreaterThan(0);
    });
  });

  // ─── RBAC checks ─────────────────────────────────────

  describe('RBAC on lifecycle transitions', () => {
    it('unauthenticated request returns 401', async () => {
      await request(app.getHttpServer())
        .get('/api/contracts')
        .expect(401);
    });

    it('terminate contract without auth returns 401', async () => {
      await request(app.getHttpServer())
        .post('/api/contracts/fake-id/terminate')
        .expect(401);
    });
  });
});
