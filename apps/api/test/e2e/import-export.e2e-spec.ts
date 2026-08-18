import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PropertyType } from '@realfy/shared';

describe('Import/Export (e2e)', () => {
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

  // ─── Helpers ────────────────────────────────────────

  async function getAuthToken() {
    const user = await registerUser(app, {
      email: `import-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });
    return user.accessToken;
  }

  function buildCsvBuffer(content: string): Buffer {
    return Buffer.from(content, 'utf-8');
  }

  // ─── Import: Upload ─────────────────────────────────

  describe('POST /import/upload', () => {
    it('uploads a CSV and returns headers + sample rows', async () => {
      const token = await getAuthToken();
      const csv = 'titulo,tipo,ciudad,precio\nDepto Centro,Departamento,CABA,150000\nCasa Norte,Casa,Córdoba,200000\n';

      const res = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'propiedades.csv')
        .expect(201);

      expect(res.body.fileId).toBeDefined();
      expect(res.body.headers).toEqual(['titulo', 'tipo', 'ciudad', 'precio']);
      expect(res.body.rowCount).toBe(2);
      expect(res.body.sampleRows).toHaveLength(2);
    });

    it('rejects non-CSV files', async () => {
      const token = await getAuthToken();

      await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('hello'), 'data.txt')
        .expect(400);
    });

    it('handles semicolon-delimited CSV', async () => {
      const token = await getAuthToken();
      const csv = 'nombre;apellido;email\nJuan;Pérez;juan@test.com\n';

      const res = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'personas.csv')
        .expect(201);

      expect(res.body.headers).toEqual(['nombre', 'apellido', 'email']);
      expect(res.body.rowCount).toBe(1);
    });

    it('handles Latin-1 encoded CSV', async () => {
      const token = await getAuthToken();
      // Create a Latin-1 buffer with accented chars that aren't valid UTF-8 sequences
      const latin1 = Buffer.from('nombre,ciudad\nJos\xe9,C\xf3rdoba\n', 'latin1');

      const res = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', latin1, 'latin1.csv')
        .expect(201);

      expect(res.body.headers).toEqual(['nombre', 'ciudad']);
      expect(res.body.rowCount).toBe(1);
    });
  });

  // ─── Import: Validate ───────────────────────────────

  describe('POST /import/validate', () => {
    it('validates property import and returns per-row errors', async () => {
      const token = await getAuthToken();
      const csv = 'titulo,tipo,precio\nDepto Centro,Departamento,150000\n,InvalidType,abc\n';

      // Upload
      const upload = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'props.csv')
        .expect(201);

      // Validate
      const res = await request(app.getHttpServer())
        .post('/api/import/validate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: upload.body.fileId,
          entityType: 'property',
          columnMappings: [
            { sourceColumn: 'titulo', targetField: 'title' },
            { sourceColumn: 'tipo', targetField: 'type' },
            { sourceColumn: 'precio', targetField: 'price' },
          ],
        })
        .expect(201);

      expect(res.body.totalRows).toBe(2);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors.length).toBeGreaterThan(0);
      // Row 2 should have errors (empty title, invalid type)
      const row2Errors = res.body.errors.filter((e: any) => e.row === 2);
      expect(row2Errors.length).toBeGreaterThan(0);
      expect(res.body.preview).toBeDefined();
    });

    it('validates person import correctly', async () => {
      const token = await getAuthToken();
      const csv = 'nombre,apellido,email\nJuan,Pérez,juan@test.com\nMaria,López,bad-email\n';

      const upload = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'personas.csv')
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/import/validate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: upload.body.fileId,
          entityType: 'person',
          columnMappings: [
            { sourceColumn: 'nombre', targetField: 'firstName' },
            { sourceColumn: 'apellido', targetField: 'lastName' },
            { sourceColumn: 'email', targetField: 'email' },
          ],
        })
        .expect(201);

      expect(res.body.totalRows).toBe(2);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
    });

    it('rejects invalid column mappings', async () => {
      const token = await getAuthToken();
      const csv = 'a,b\n1,2\n';

      const upload = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'test.csv')
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/import/validate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: upload.body.fileId,
          entityType: 'property',
          columnMappings: [
            { sourceColumn: 'nonexistent', targetField: 'title' },
          ],
        })
        .expect(400);
    });
  });

  // ─── Import: Execute ────────────────────────────────

  describe('POST /import/execute', () => {
    it('imports valid properties and skips invalid rows', async () => {
      const token = await getAuthToken();
      const csv = [
        'titulo,tipo,ciudad,precio',
        'Depto Centro,Departamento,CABA,150000',
        'Casa Norte,Casa,Córdoba,200000',
        ',InvalidType,Bad,abc',
      ].join('\n');

      const upload = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'props.csv')
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: upload.body.fileId,
          entityType: 'property',
          columnMappings: [
            { sourceColumn: 'titulo', targetField: 'title' },
            { sourceColumn: 'tipo', targetField: 'type' },
            { sourceColumn: 'ciudad', targetField: 'city' },
            { sourceColumn: 'precio', targetField: 'price' },
          ],
        })
        .expect(201);

      expect(res.body.totalRows).toBe(3);
      expect(res.body.importedRows).toBe(2);
      expect(res.body.skippedRows).toBe(1);
      expect(res.body.errors.length).toBeGreaterThan(0);

      // Verify properties were actually created in the database
      const props = await request(app.getHttpServer())
        .get('/api/properties')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(props.body.total).toBe(2);
    });

    it('imports persons and creates records', async () => {
      const token = await getAuthToken();
      const csv = 'nombre,apellido,email,telefono\nJuan,Pérez,juan@import.com,+5411-1234-5678\nMaria,López,maria@import.com,+5411-9876-5432\n';

      const upload = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'personas.csv')
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: upload.body.fileId,
          entityType: 'person',
          columnMappings: [
            { sourceColumn: 'nombre', targetField: 'firstName' },
            { sourceColumn: 'apellido', targetField: 'lastName' },
            { sourceColumn: 'email', targetField: 'email' },
            { sourceColumn: 'telefono', targetField: 'phone' },
          ],
        })
        .expect(201);

      expect(res.body.totalRows).toBe(2);
      expect(res.body.importedRows).toBe(2);
      expect(res.body.skippedRows).toBe(0);

      // Verify persons were created
      const persons = await request(app.getHttpServer())
        .get('/api/persons')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(persons.body.total).toBe(2);
    });

    it('rejects expired/missing fileId', async () => {
      const token = await getAuthToken();

      await request(app.getHttpServer())
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: 'nonexistent-id',
          entityType: 'property',
          columnMappings: [
            { sourceColumn: 'a', targetField: 'title' },
          ],
        })
        .expect(400);
    });
  });

  // ─── Export: Properties ─────────────────────────────

  describe('Properties Export', () => {
    async function seedProperties(token: string) {
      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Depto Export Test',
          type: PropertyType.Departamento,
          city: 'CABA',
          price: 150000,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Casa Export Test',
          type: PropertyType.Casa,
          city: 'Córdoba',
          price: 250000,
        })
        .expect(201);
    }

    it('GET /properties/export/csv — downloads CSV with property data', async () => {
      const token = await getAuthToken();
      await seedProperties(token);

      const res = await request(app.getHttpServer())
        .get('/api/properties/export/csv')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('propiedades-');
      expect(res.headers['content-disposition']).toContain('.csv');

      const csvText = res.text || res.body.toString();
      expect(csvText).toContain('Título');
      expect(csvText).toContain('Depto Export Test');
      expect(csvText).toContain('Casa Export Test');
    });

    it('GET /properties/export/excel — downloads Excel file', async () => {
      const token = await getAuthToken();
      await seedProperties(token);

      const res = await request(app.getHttpServer())
        .get('/api/properties/export/excel')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((res: any, callback: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('propiedades-');
      expect(res.headers['content-disposition']).toContain('.xlsx');
      // Excel files start with PK zip signature
      expect(res.body[0]).toBe(0x50); // 'P'
      expect(res.body[1]).toBe(0x4b); // 'K'
    });
  });

  // ─── Export: Persons ────────────────────────────────

  describe('Persons Export', () => {
    async function seedPersons(token: string) {
      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Juan',
          lastName: 'Pérez',
          email: 'juan@export.com',
          phone: '+5411-1234-5678',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'Maria',
          lastName: 'López',
          email: 'maria@export.com',
        })
        .expect(201);
    }

    it('GET /persons/export/csv — downloads CSV with person data', async () => {
      const token = await getAuthToken();
      await seedPersons(token);

      const res = await request(app.getHttpServer())
        .get('/api/persons/export/csv')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('personas-');

      const csvText = res.text || res.body.toString();
      expect(csvText).toContain('Nombre');
      expect(csvText).toContain('Juan');
      expect(csvText).toContain('Maria');
    });

    it('GET /persons/export/excel — downloads Excel file', async () => {
      const token = await getAuthToken();
      await seedPersons(token);

      const res = await request(app.getHttpServer())
        .get('/api/persons/export/excel')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((res: any, callback: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('personas-');
      expect(res.body[0]).toBe(0x50); // PK zip header
      expect(res.body[1]).toBe(0x4b);
    });
  });

  // ─── Full Import→Export roundtrip ───────────────────

  describe('Import → Export roundtrip', () => {
    it('imports properties via CSV then exports them back', async () => {
      const token = await getAuthToken();
      const csv = 'titulo,tipo,ciudad,precio,moneda\nDepto RT,Departamento,CABA,100000,ARS\nCasa RT,Casa,Mendoza,200000,USD\n';

      // Upload & execute import
      const upload = await request(app.getHttpServer())
        .post('/api/import/upload')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', buildCsvBuffer(csv), 'roundtrip.csv')
        .expect(201);

      const exec = await request(app.getHttpServer())
        .post('/api/import/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileId: upload.body.fileId,
          entityType: 'property',
          columnMappings: [
            { sourceColumn: 'titulo', targetField: 'title' },
            { sourceColumn: 'tipo', targetField: 'type' },
            { sourceColumn: 'ciudad', targetField: 'city' },
            { sourceColumn: 'precio', targetField: 'price' },
            { sourceColumn: 'moneda', targetField: 'currency' },
          ],
        })
        .expect(201);

      expect(exec.body.importedRows).toBe(2);

      // Export CSV
      const exportRes = await request(app.getHttpServer())
        .get('/api/properties/export/csv')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const csvText = exportRes.text || exportRes.body.toString();
      expect(csvText).toContain('Depto RT');
      expect(csvText).toContain('Casa RT');
      expect(csvText).toContain('CABA');
      expect(csvText).toContain('Mendoza');
    });
  });
});
