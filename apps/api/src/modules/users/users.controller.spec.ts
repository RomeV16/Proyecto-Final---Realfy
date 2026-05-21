import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'u0000000-0000-0000-0000-000000000001';

const MOCK_USER = {
  id: USER_ID,
  email: 'agent@example.com',
  firstName: 'Agent',
  lastName: 'Smith',
  role: 'Ventas',
  isActive: true,
};

function buildMocks() {
  const usersService = {
    findAll: jest.fn().mockResolvedValue([MOCK_USER]),
    invite: jest.fn().mockResolvedValue({ id: USER_ID, invitationToken: 'token-123' }),
    acceptInvitation: jest.fn().mockResolvedValue({ user: MOCK_USER, tokens: { accessToken: 'at', refreshToken: 'rt' } }),
    updateRole: jest.fn().mockResolvedValue({ ...MOCK_USER, role: 'Gerente' }),
    deactivate: jest.fn().mockResolvedValue({ ...MOCK_USER, isActive: false }),
  };
  return { usersService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UsersController', () => {
  let controller: UsersController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mocks.usersService }],
    })
      .overrideGuard(require('../../common/auth/jwt-auth.guard').JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(require('../../common/auth/rbac.guard').RbacGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
  });

  // ─── GET /users ───────────────────────────────────────────────────────────

  describe('GET /users', () => {
    it('returns list of users in tenant', async () => {
      const result = await controller.findAll();
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toMatchObject({ id: USER_ID });
    });

    it('calls usersService.findAll once', async () => {
      await controller.findAll();
      expect(mocks.usersService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  // ─── POST /users/invite ───────────────────────────────────────────────────

  describe('POST /users/invite', () => {
    const INVITE_BODY = { email: 'new@example.com', role: 'Ventas' };

    it('returns invitation token on happy path', async () => {
      const result = await controller.invite(INVITE_BODY);
      expect(result).toHaveProperty('invitationToken');
      expect(mocks.usersService.invite).toHaveBeenCalledWith(INVITE_BODY);
    });

    it('propagates error when email already exists', async () => {
      mocks.usersService.invite.mockRejectedValueOnce(new Error('Email already in use'));
      await expect(controller.invite(INVITE_BODY)).rejects.toThrow('Email already in use');
    });
  });

  // ─── POST /users/accept-invitation ───────────────────────────────────────

  describe('POST /users/accept-invitation', () => {
    const ACCEPT_BODY = {
      token: 'inv-token-abc',
      password: 'newPass123',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('accepts invitation and returns user + tokens', async () => {
      const result = await controller.acceptInvitation(ACCEPT_BODY);
      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('tokens');
      expect(mocks.usersService.acceptInvitation).toHaveBeenCalledWith(ACCEPT_BODY);
    });

    it('propagates UnauthorizedException for invalid token', async () => {
      mocks.usersService.acceptInvitation.mockRejectedValueOnce(new UnauthorizedException('Invalid or expired token'));
      await expect(controller.acceptInvitation({ ...ACCEPT_BODY, token: 'bad-token' })).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── PATCH /users/:id/role ────────────────────────────────────────────────

  describe('PATCH /users/:id/role', () => {
    it('updates user role and returns modified user', async () => {
      const result = await controller.updateRole(USER_ID, 'Gerente');
      expect(result).toMatchObject({ role: 'Gerente' });
      expect(mocks.usersService.updateRole).toHaveBeenCalledWith(USER_ID, 'Gerente');
    });

    it('propagates NotFoundException when user missing', async () => {
      mocks.usersService.updateRole.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.updateRole('bad-id', 'Admin')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── PATCH /users/:id/deactivate ─────────────────────────────────────────

  describe('PATCH /users/:id/deactivate', () => {
    it('deactivates user', async () => {
      const result = await controller.deactivate(USER_ID);
      expect(result).toMatchObject({ isActive: false });
      expect(mocks.usersService.deactivate).toHaveBeenCalledWith(USER_ID);
    });

    it('propagates NotFoundException when user missing', async () => {
      mocks.usersService.deactivate.mockRejectedValueOnce(new NotFoundException());
      await expect(controller.deactivate('bad-id')).rejects.toThrow(NotFoundException);
    });
  });
});
