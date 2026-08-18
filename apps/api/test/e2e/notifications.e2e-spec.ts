import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { NotificationType } from '@realfy/shared';

describe('Notifications (e2e)', () => {
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

  /**
   * Create a notification directly in the database.
   * Used to seed data for read-side tests.
   */
  async function createNotificationDirect(params: {
    tenantId: string;
    userId: string;
    type?: string;
    title?: string;
    message?: string;
    isRead?: boolean;
  }) {
    return prisma.baseClient.notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: (params.type ?? NotificationType.SystemAlert) as any,
        title: params.title ?? 'Test notification',
        message: params.message ?? 'Test notification message',
        isRead: params.isRead ?? false,
      },
    });
  }

  // ─── List ─────────────────────────────────────────────

  describe('GET /notifications', () => {
    it('returns empty list initially', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-empty.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
      expect(res.body.page).toBe(1);
    });

    it('returns notifications created for the user', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-list.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Seed two notifications directly
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        title: 'Notification 1',
        message: 'First notification',
      });
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        title: 'Notification 2',
        message: 'Second notification',
        type: NotificationType.ContractExpiring,
      });

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters by isRead', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-filter.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        title: 'Unread',
        isRead: false,
      });
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        title: 'Already read',
        isRead: true,
      });

      const unread = await request(app.getHttpServer())
        .get('/api/notifications')
        .query({ isRead: 'false' })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(unread.body.items).toHaveLength(1);
      expect(unread.body.items[0].title).toBe('Unread');
    });
  });

  // ─── Unread Count ─────────────────────────────────────

  describe('GET /notifications/unread-count', () => {
    it('returns correct unread count', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-count.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Start with 0
      const empty = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(empty.body.count).toBe(0);

      // Add three notifications — two unread, one read
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: false,
      });
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: false,
      });
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: true,
      });

      const res = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.count).toBe(2);
    });
  });

  // ─── Mark as Read ─────────────────────────────────────

  describe('PATCH /notifications/:id/read', () => {
    it('marks a single notification as read', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-mark.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const notif = await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: false,
      });

      const res = await request(app.getHttpServer())
        .patch(`/api/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.isRead).toBe(true);

      // Verify unread count decreased
      const count = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(count.body.count).toBe(0);
    });

    it('returns 404 for non-existent notification', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-mark-404.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .patch('/api/notifications/00000000-0000-0000-0000-000000000000/read')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });
  });

  // ─── Mark All as Read ─────────────────────────────────

  describe('PATCH /notifications/mark-all-read', () => {
    it('marks all unread notifications as read', async () => {
      const user = await registerUser(app, {
        email: 'admin@notif-all.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Create three unread notifications
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: false,
      });
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: false,
      });
      await createNotificationDirect({
        tenantId: user.user.tenantId,
        userId: user.user.id,
        isRead: false,
      });

      const res = await request(app.getHttpServer())
        .patch('/api/notifications/mark-all-read')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.updated).toBe(3);

      // Verify unread count is 0
      const count = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(count.body.count).toBe(0);
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────

  describe('Tenant isolation', () => {
    it('user cannot see notifications from another tenant', async () => {
      const userA = await registerUser(app, {
        email: 'admin@notif-iso-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      const userB = await registerUser(app, {
        email: 'admin@notif-iso-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // Create notification for user A
      await createNotificationDirect({
        tenantId: userA.user.tenantId,
        userId: userA.user.id,
        title: 'For tenant A',
      });

      // User A sees it
      const resA = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      expect(resA.body.items).toHaveLength(1);

      // User B sees nothing
      const resB = await request(app.getHttpServer())
        .get('/api/notifications')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(resB.body.items).toHaveLength(0);
    });

    it('user cannot mark-as-read notifications from another user (404)', async () => {
      const userA = await registerUser(app, {
        email: 'admin@notif-iso-mark-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      const userB = await registerUser(app, {
        email: 'admin@notif-iso-mark-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // Create notification for user A
      const notif = await createNotificationDirect({
        tenantId: userA.user.tenantId,
        userId: userA.user.id,
      });

      // User B tries to mark as read — should get 404 (scoped by userId)
      await request(app.getHttpServer())
        .patch(`/api/notifications/${notif.id}/read`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });
});
