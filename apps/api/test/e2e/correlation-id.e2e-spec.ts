import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, teardownTestApp } from '../helpers/test-utils';

describe('Identificador de correlación (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = (await setupTestApp()).app;
  });

  afterAll(async () => {
    await teardownTestApp();
  });

  it('cada respuesta trae x-request-id generado', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('respeta el x-request-id del cliente y lo repite en el cuerpo del error', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/contracts')
      .set('x-request-id', 'cliente-123');
    expect(res.status).toBe(401);
    expect(res.headers['x-request-id']).toBe('cliente-123');
    expect(res.body.correlationId).toBe('cliente-123');
  });

  it('descarta un x-request-id con caracteres no válidos', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/contracts')
      .set('x-request-id', 'a b<script>');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.correlationId).toBe(res.headers['x-request-id']);
  });
});
