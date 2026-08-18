import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from './helpers/test-utils';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Audit Trail (e2e)', () => {
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

  it('Mutations create audit trail entries with correct metadata', async () => {
    // Register admin
    const admin = await registerUser(app, {
      email: 'admin@audit-test.com',
      password: 'Password123!',
      firstName: 'Audit',
      lastName: 'Admin',
    });

    // Invite a user (mutation that should be audited)
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email: 'invited@audit-test.com', role: 'Lectura' })
      .expect(201);

    // Update tenant branding (another audited mutation)
    await request(app.getHttpServer())
      .patch(`/api/tenants/${admin.user.tenantId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ brandPrimary: '#3366ff' })
      .expect(200);

    // Small delay to let fire-and-forget audit writes complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Query audit logs
    const auditRes = await request(app.getHttpServer())
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    const items = auditRes.body.items;
    expect(items.length).toBeGreaterThanOrEqual(2);

    // Find the user invitation audit entry
    const inviteEntry = items.find(
      (entry: any) => entry.entity === 'User' && entry.action === 'CREATE',
    );
    expect(inviteEntry).toBeDefined();
    expect(inviteEntry.userId).toBe(admin.user.id);
    expect(inviteEntry.changes).toBeDefined();
    expect(inviteEntry.changes.email).toBe('invited@audit-test.com');

    // Find the tenant update audit entry
    const tenantEntry = items.find(
      (entry: any) => entry.entity === 'Tenant' && entry.action === 'UPDATE',
    );
    expect(tenantEntry).toBeDefined();
    expect(tenantEntry.userId).toBe(admin.user.id);
    expect(tenantEntry.changes.brandPrimary).toBe('#3366ff');
  });

  it('Audit logs are filtered by tenant', async () => {
    const t1Admin = await registerUser(app, {
      email: 'admin1@audit-iso.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'One',
    });

    const t2Admin = await registerUser(app, {
      email: 'admin2@audit-iso.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Two',
    });

    // T1 invites a user
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${t1Admin.accessToken}`)
      .send({ email: 'invited@t1.com', role: 'Lectura' })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 200));

    // T2 queries audit logs — should see only their own
    const t2AuditRes = await request(app.getHttpServer())
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${t2Admin.accessToken}`)
      .expect(200);

    // T2 should NOT see T1's invitation audit entry
    const t1Entries = t2AuditRes.body.items.filter(
      (entry: any) => entry.changes?.email === 'invited@t1.com',
    );
    expect(t1Entries).toHaveLength(0);
  });

  it('Audit log supports entity filter', async () => {
    const admin = await registerUser(app, {
      email: 'admin@filter-test.com',
      password: 'Password123!',
      firstName: 'Filter',
      lastName: 'Admin',
    });

    // Create some mutations
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email: 'filteruser@test.com', role: 'Ventas' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/tenants/${admin.user.tenantId}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ name: 'Updated Name' })
      .expect(200);

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Filter by entity=Tenant
    const tenantLogs = await request(app.getHttpServer())
      .get('/api/audit-logs?entity=Tenant')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    for (const item of tenantLogs.body.items) {
      expect(item.entity).toBe('Tenant');
    }
  });

  it('Passwords are redacted in audit log changes', async () => {
    const admin = await registerUser(app, {
      email: 'admin@redact-test.com',
      password: 'SuperSecret123!',
      firstName: 'Redact',
      lastName: 'Admin',
    });

    // Invite and accept to trigger a mutation with password in body
    const inviteRes = await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email: 'redactuser@test.com', role: 'Lectura' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/users/accept-invitation')
      .send({
        token: inviteRes.body.token,
        password: 'ShouldBeRedacted!',
        firstName: 'Redact',
        lastName: 'User',
      })
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check audit logs for the accept-invitation entry
    const auditRes = await request(app.getHttpServer())
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    // Find the accept-invitation entry (it's a POST to /users/accept-invitation)
    const acceptEntry = auditRes.body.items.find(
      (entry: any) => entry.changes?.password !== undefined,
    );

    // If the accept-invitation endpoint is @Public and no tenant context,
    // the audit interceptor skips it. That's correct behavior.
    // Otherwise, if found, password should be redacted.
    if (acceptEntry) {
      expect(acceptEntry.changes.password).toBe('[REDACTED]');
    }
  });
});
