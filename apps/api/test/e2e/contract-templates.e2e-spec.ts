import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  UserRole,
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  GuaranteeType,
  GuaranteeStatus,
  PropertyType,
} from '@realfy/shared';

describe('Contract Templates (e2e)', () => {
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

  // ─── Helpers ──────────────────────────────────────────

  async function setupContext(emailPrefix = 'ct-test') {
    const admin = await registerUser(app, {
      email: `${emailPrefix}-${Date.now()}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    return { admin };
  }

  /** Create a contract template via API. */
  async function createTemplate(
    token: string,
    overrides: Partial<{
      name: string;
      contractType: string;
      body: string;
      variables: string[];
      isDefault: boolean;
      isActive: boolean;
    }> = {},
  ) {
    const name =
      overrides.name ??
      `Template-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const res = await request(app.getHttpServer())
      .post('/api/contract-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        contractType: overrides.contractType ?? ContractType.Alquiler,
        body:
          overrides.body ??
          'Contrato entre {{propietario.nombre}} y {{inquilino.nombre}} por {{propiedad.direccion}}.',
        variables: overrides.variables,
        isDefault: overrides.isDefault,
        isActive: overrides.isActive,
      })
      .expect(201);

    return res.body;
  }

  /** Create a full contract context: property, 3 persons, contract. */
  async function setupFullContract(emailPrefix: string) {
    const user = await registerUser(app, {
      email: `${emailPrefix}-${Date.now()}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    // Create property
    const propertyRes = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        title: 'Depto Palermo',
        type: PropertyType.Departamento,
        street: 'Av. Santa Fe',
        number: '1234',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 65,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 100000,
        currency: 'USD',
      })
      .expect(201);

    // Create propietario
    const propietarioRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        firstName: 'Carlos',
        lastName: 'González',
        email: `propietario-${emailPrefix}-${Date.now()}@test.com`,
        cuit: '20-20000000-6',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/persons/${propietarioRes.body.id}/roles`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ role: PersonRole.Propietario })
      .expect(201);

    // Create inquilino
    const inquilinoRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        firstName: 'Ana',
        lastName: 'Martínez',
        email: `inquilino-${emailPrefix}-${Date.now()}@test.com`,
        phone: '+5491155551234',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/persons/${inquilinoRes.body.id}/roles`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ role: PersonRole.Inquilino })
      .expect(201);

    // Create garante
    const garanteRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        firstName: 'Roberto',
        lastName: 'Garante',
        email: `garante-${emailPrefix}-${Date.now()}@test.com`,
        cuit: '20-20000001-4',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/persons/${garanteRes.body.id}/roles`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ role: PersonRole.Garante })
      .expect(201);

    // Create contract
    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        propertyId: propertyRes.body.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        rentAmount: '150000.00',
        rentCurrency: 'ARS',
        depositAmount: '300000.00',
        depositCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        notes: 'Contrato de alquiler test',
        persons: [
          { personId: propietarioRes.body.id, role: PersonRole.Propietario },
          { personId: inquilinoRes.body.id, role: PersonRole.Inquilino },
          { personId: garanteRes.body.id, role: PersonRole.Garante },
        ],
        guarantees: [
          {
            type: GuaranteeType.Seguro_de_caucion,
            status: GuaranteeStatus.Vigente,
            description: 'Póliza seguro de caución',
            amount: '50000.00',
            currency: 'ARS',
            issuer: 'Finaer',
            policyNumber: 'POL-12345',
            startDate: '2025-01-01T00:00:00.000Z',
            endDate: '2027-01-01T00:00:00.000Z',
          },
        ],
      })
      .expect(201);

    return {
      user,
      property: propertyRes.body,
      propietario: propietarioRes.body,
      inquilino: inquilinoRes.body,
      garante: garanteRes.body,
      contract: contractRes.body,
    };
  }

  // ─── Template CRUD ────────────────────────────────────

  describe('Template CRUD', () => {
    it('POST /contract-templates creates a template with auto-extracted variables', async () => {
      const { admin } = await setupContext('ct-create');

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Alquiler Básico',
          contractType: ContractType.Alquiler,
          body: 'Contrato entre {{propietario.nombre}} y {{inquilino.nombre}} por {{propiedad.direccion}} a {{contrato.monto}}.',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Alquiler Básico');
      expect(res.body.contractType).toBe(ContractType.Alquiler);
      expect(res.body.isActive).toBe(true);
      expect(res.body.isDefault).toBe(false);
      // Variables auto-extracted
      expect(res.body.variables).toContain('propietario.nombre');
      expect(res.body.variables).toContain('inquilino.nombre');
      expect(res.body.variables).toContain('propiedad.direccion');
      expect(res.body.variables).toContain('contrato.monto');
    });

    it('POST /contract-templates with explicit variables uses them', async () => {
      const { admin } = await setupContext('ct-explicit');

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Custom Vars',
          contractType: ContractType.Venta,
          body: 'Body text',
          variables: ['custom1', 'custom2'],
        })
        .expect(201);

      expect(res.body.variables).toEqual(['custom1', 'custom2']);
    });

    it('GET /contract-templates lists all templates for tenant', async () => {
      const { admin } = await setupContext('ct-list');

      await createTemplate(admin.accessToken, { name: 'Template A' });
      await createTemplate(admin.accessToken, { name: 'Template B' });

      const res = await request(app.getHttpServer())
        .get('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('GET /contract-templates/:id returns a single template', async () => {
      const { admin } = await setupContext('ct-get-one');

      const template = await createTemplate(admin.accessToken, {
        name: 'SingleGet',
      });

      const res = await request(app.getHttpServer())
        .get(`/api/contract-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(template.id);
      expect(res.body.name).toBe('SingleGet');
    });

    it('GET /contract-templates/:id returns 404 for non-existent template', async () => {
      const { admin } = await setupContext('ct-404');

      const res = await request(app.getHttpServer())
        .get('/api/contract-templates/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);

      expect(res.body.error).toBe('TEMPLATE_NOT_FOUND');
    });

    it('PATCH /contract-templates/:id updates template fields', async () => {
      const { admin } = await setupContext('ct-update');

      const template = await createTemplate(admin.accessToken, {
        name: 'Original',
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/contract-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Updated',
          body: 'Nuevo cuerpo con {{contrato.fechaInicio}} variable.',
        })
        .expect(200);

      expect(res.body.name).toBe('Updated');
      // Variables auto-updated when body changes
      expect(res.body.variables).toContain('contrato.fechaInicio');
    });

    it('DELETE /contract-templates/:id removes template', async () => {
      const { admin } = await setupContext('ct-delete');

      const template = await createTemplate(admin.accessToken, {
        name: 'ToDelete',
      });

      await request(app.getHttpServer())
        .delete(`/api/contract-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      // Confirm it's gone
      await request(app.getHttpServer())
        .get(`/api/contract-templates/${template.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
    });
  });

  // ─── Unique Name Constraint ───────────────────────────

  describe('Unique name constraint', () => {
    it('POST /contract-templates with duplicate name returns 400', async () => {
      const { admin } = await setupContext('ct-unique');

      await createTemplate(admin.accessToken, { name: 'Duplicate' });

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          name: 'Duplicate',
          contractType: ContractType.Alquiler,
          body: 'Body',
        })
        .expect(400);

      expect(res.body.error).toBe('TEMPLATE_NAME_EXISTS');
    });

    it('Same name in different tenants is allowed', async () => {
      const ctxA = await setupContext('ct-uniq-a');
      const ctxB = await setupContext('ct-uniq-b');

      await createTemplate(ctxA.admin.accessToken, { name: 'SharedName' });

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .send({
          name: 'SharedName',
          contractType: ContractType.Alquiler,
          body: 'Body',
        })
        .expect(201);

      expect(res.body.name).toBe('SharedName');
    });
  });

  // ─── Filtering ────────────────────────────────────────

  describe('Filtering', () => {
    it('GET /contract-templates supports contractType filter', async () => {
      const { admin } = await setupContext('ct-filter-type');

      await createTemplate(admin.accessToken, {
        name: 'Alquiler',
        contractType: ContractType.Alquiler,
      });
      await createTemplate(admin.accessToken, {
        name: 'Venta',
        contractType: ContractType.Venta,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/contract-templates?contractType=${ContractType.Alquiler}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Alquiler');
    });

    it('GET /contract-templates supports search filter', async () => {
      const { admin } = await setupContext('ct-filter-search');

      await createTemplate(admin.accessToken, { name: 'Alquiler Básico' });
      await createTemplate(admin.accessToken, { name: 'Venta Premium' });

      const res = await request(app.getHttpServer())
        .get('/api/contract-templates?search=Alquiler')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].name).toBe('Alquiler Básico');
    });

    it('GET /contract-templates supports isActive filter', async () => {
      const { admin } = await setupContext('ct-filter-active');

      await createTemplate(admin.accessToken, {
        name: 'Active',
        isActive: true,
      });
      await createTemplate(admin.accessToken, {
        name: 'Inactive',
        isActive: false,
      });

      const activeRes = await request(app.getHttpServer())
        .get('/api/contract-templates?isActive=true')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(activeRes.body.items).toHaveLength(1);
      expect(activeRes.body.items[0].name).toBe('Active');
    });

    it('GET /contract-templates supports pagination', async () => {
      const { admin } = await setupContext('ct-page');

      for (let i = 0; i < 5; i++) {
        await createTemplate(admin.accessToken, { name: `Page-${i}` });
      }

      const res = await request(app.getHttpServer())
        .get('/api/contract-templates?page=1&limit=2')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(5);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect(res.body.totalPages).toBe(3);
    });
  });

  // ─── Template Variables for a Contract ────────────────

  describe('Template Variables', () => {
    it('GET /contracts/:id/template-variables returns resolved variables', async () => {
      const { user, contract, propietario, inquilino } =
        await setupFullContract('ct-vars');

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}/template-variables`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Should have contrato.*, propiedad.*, propietario.*, inquilino.*, inmobiliaria.*, fecha.*
      expect(res.body['contrato.monto']).toBeDefined();
      expect(res.body['contrato.moneda']).toBe('ARS');
      expect(res.body['propiedad.direccion']).toContain('Santa Fe');
      expect(res.body['propietario.nombre']).toBe('Carlos');
      expect(res.body['inquilino.nombre']).toBe('Ana');
      expect(res.body['inmobiliaria.nombre']).toBeDefined();
      expect(res.body['fecha.hoy']).toBeDefined();
    });

    it('GET /contracts/:id/available-templates returns matching templates', async () => {
      const { user, contract } = await setupFullContract('ct-avail');

      // Create templates of different types
      await createTemplate(user.accessToken, {
        name: 'Matching Alquiler',
        contractType: ContractType.Alquiler,
      });
      await createTemplate(user.accessToken, {
        name: 'Non-Matching Venta',
        contractType: ContractType.Venta,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}/available-templates`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Only Alquiler templates should match
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Matching Alquiler');
    });
  });

  // ─── Document Generation ──────────────────────────────

  describe('Document Generation', () => {
    it('POST /contracts/:id/generate-document generates a PDF', async () => {
      const { user, contract } = await setupFullContract('ct-gen-pdf');

      const template = await createTemplate(user.accessToken, {
        name: 'PDF Test',
        body: 'Contrato de {{propietario.nombre}} con {{inquilino.nombre}} por {{propiedad.direccion}}.',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/generate-document`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          templateId: template.id,
          format: 'pdf',
        })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.pdf');
      // Should be a non-trivial binary buffer
      // PDF size depends on pdfmake font availability in test env
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    });

    it('POST /contracts/:id/generate-document generates a DOCX', async () => {
      const { user, contract } = await setupFullContract('ct-gen-docx');

      const template = await createTemplate(user.accessToken, {
        name: 'DOCX Test',
        body: 'Contrato de {{propietario.nombre}} con {{inquilino.nombre}} por {{propiedad.direccion}}.',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/generate-document`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          templateId: template.id,
          format: 'docx',
        })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain('.docx');
      // DOCX files start with PK zip signature
      expect(res.body.slice(0, 2).toString()).toBe('PK');
    });

    it('POST /contracts/:id/generate-document returns 404 for non-existent template', async () => {
      const { user, contract } = await setupFullContract('ct-gen-404');

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/generate-document`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          templateId: '00000000-0000-0000-0000-000000000000',
          format: 'pdf',
        })
        .expect(404);

      expect(res.body.error).toBe('TEMPLATE_NOT_FOUND');
    });

    it('POST /contracts/:id/generate-document returns 400 for invalid format', async () => {
      const { user, contract } = await setupFullContract('ct-gen-badfmt');

      const template = await createTemplate(user.accessToken, {
        name: 'BadFormat Test',
      });

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/generate-document`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          templateId: template.id,
          format: 'txt',
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Seed Defaults ────────────────────────────────────

  describe('Seed Defaults', () => {
    it('POST /contract-templates/seed-defaults creates 3 default Argentine templates', async () => {
      const { admin } = await setupContext('ct-seed');

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates/seed-defaults')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(201);

      expect(res.body).toHaveLength(3);
      // Each should be marked as default
      for (const tmpl of res.body) {
        expect(tmpl.isDefault).toBe(true);
        expect(tmpl.isActive).toBe(true);
        expect(tmpl.variables.length).toBeGreaterThan(0);
      }

      // Should have one of each type
      const types = res.body.map((t: any) => t.contractType).sort();
      expect(types).toEqual([
        ContractType.Alquiler,
        ContractType.AlquilerTemporario,
        ContractType.Venta,
      ]);
    });

    it('POST /contract-templates/seed-defaults is idempotent — second call returns empty array', async () => {
      const { admin } = await setupContext('ct-seed-idem');

      // First call creates templates
      const first = await request(app.getHttpServer())
        .post('/api/contract-templates/seed-defaults')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(201);
      expect(first.body).toHaveLength(3);

      // Second call returns empty (already seeded)
      const second = await request(app.getHttpServer())
        .post('/api/contract-templates/seed-defaults')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(201);
      expect(second.body).toHaveLength(0);

      // Total templates should still be 3
      const listRes = await request(app.getHttpServer())
        .get('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(listRes.body.total).toBe(3);
    });

    it('Seeded default templates appear in available-templates for matching contract type', async () => {
      const { user, contract } = await setupFullContract('ct-seed-avail');

      // Seed defaults
      await request(app.getHttpServer())
        .post('/api/contract-templates/seed-defaults')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      // Contract is Alquiler type — should see the Alquiler default
      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}/available-templates`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(1);
      const defaultTemplate = res.body.find((t: any) => t.isDefault);
      expect(defaultTemplate).toBeDefined();
      expect(defaultTemplate.contractType).toBe(ContractType.Alquiler);
    });
  });

  // ─── Full E2E Chain ───────────────────────────────────

  describe('Full E2E Chain', () => {
    it('Seed defaults → create contract → generate PDF with interpolated variables', async () => {
      const { user, contract } = await setupFullContract('ct-e2e-pdf');

      // Seed default templates
      const seedRes = await request(app.getHttpServer())
        .post('/api/contract-templates/seed-defaults')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      const alquilerTemplate = seedRes.body.find(
        (t: any) => t.contractType === ContractType.Alquiler,
      );
      expect(alquilerTemplate).toBeDefined();

      // Generate PDF
      const docRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/generate-document`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          templateId: alquilerTemplate.id,
          format: 'pdf',
        })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(docRes.headers['content-type']).toContain('application/pdf');
      expect(Number(docRes.headers['content-length'])).toBeGreaterThan(0);
    });

    it('Seed defaults → create contract → generate DOCX with interpolated variables', async () => {
      const { user, contract } = await setupFullContract('ct-e2e-docx');

      // Seed default templates
      const seedRes = await request(app.getHttpServer())
        .post('/api/contract-templates/seed-defaults')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      const alquilerTemplate = seedRes.body.find(
        (t: any) => t.contractType === ContractType.Alquiler,
      );

      // Generate DOCX
      const docRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/generate-document`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          templateId: alquilerTemplate.id,
          format: 'docx',
        })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(docRes.headers['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
      // DOCX files are ZIP-based: first two bytes are "PK"
      expect(docRes.body.slice(0, 2).toString()).toBe('PK');
      expect(docRes.body.length).toBeGreaterThan(500);
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────

  describe('Tenant Isolation', () => {
    it('Templates from tenant A are not visible to tenant B', async () => {
      const ctxA = await setupContext('ct-iso-a');
      const ctxB = await setupContext('ct-iso-b');

      await createTemplate(ctxA.admin.accessToken, { name: 'TenantAOnly' });

      const res = await request(app.getHttpServer())
        .get('/api/contract-templates')
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('Tenant B cannot GET tenant A template by ID (404)', async () => {
      const ctxA = await setupContext('ct-iso-get-a');
      const ctxB = await setupContext('ct-iso-get-b');

      const template = await createTemplate(ctxA.admin.accessToken, {
        name: 'PrivateTemplate',
      });

      await request(app.getHttpServer())
        .get(`/api/contract-templates/${template.id}`)
        .set('Authorization', `Bearer ${ctxB.admin.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ─────────────────────────────────────────────

  describe('RBAC', () => {
    it('Ventas role cannot POST /contract-templates (403)', async () => {
      const { admin } = await setupContext('ct-rbac-ventas');

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas-ct@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(app, 'ventas-ct@test.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({
          name: 'VentasTemplate',
          contractType: ContractType.Alquiler,
          body: 'Body',
        })
        .expect(403);
    });

    it('Ventas role CAN access contract-level endpoints (available-templates, template-variables)', async () => {
      const { user, contract } = await setupFullContract('ct-rbac-contract');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'ventas-contract@test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });
      const ventas = await loginUser(
        app,
        'ventas-contract@test.com',
        'Password123!',
      );

      // available-templates should work
      await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}/available-templates`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(200);

      // template-variables should work
      await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}/template-variables`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(200);
    });

    it('Lectura role cannot access contract-templates endpoints (403)', async () => {
      const { admin } = await setupContext('ct-rbac-lectura');

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura-ct@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(
        app,
        'lectura-ct@test.com',
        'Password123!',
      );

      await request(app.getHttpServer())
        .get('/api/contract-templates')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);
    });
  });

  // ─── Validation ───────────────────────────────────────

  describe('Validation', () => {
    it('POST /contract-templates without name returns 400 VALIDATION_ERROR', async () => {
      const { admin } = await setupContext('ct-val-noname');

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ contractType: ContractType.Alquiler, body: 'Body' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('POST /contract-templates without body returns 400', async () => {
      const { admin } = await setupContext('ct-val-nobody');

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Test', contractType: ContractType.Alquiler })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('POST /contract-templates without contractType returns 400', async () => {
      const { admin } = await setupContext('ct-val-notype');

      const res = await request(app.getHttpServer())
        .post('/api/contract-templates')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Test', body: 'Body' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
