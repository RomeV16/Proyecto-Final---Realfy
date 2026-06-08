import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const MOCK_TOKENS = {
  accessToken: 'access-jwt-token',
  refreshToken: 'refresh-jwt-token',
};

const MOCK_USER = {
  id: 'u0000000-0000-0000-0000-000000000001',
  email: 'test@example.com',
  firstName: 'Test',
  lastName: 'User',
};

function buildMockRes() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
}

function buildMockReq(overrides: Record<string, any> = {}) {
  return {
    cookies: {},
    body: {},
    user: { userId: MOCK_USER.id },
    ...overrides,
  } as any;
}

function buildMocks() {
  const authService = {
    register: jest.fn().mockResolvedValue({ user: MOCK_USER, tokens: MOCK_TOKENS }),
    login: jest.fn().mockResolvedValue({ user: MOCK_USER, tokens: MOCK_TOKENS }),
    refreshToken: jest.fn().mockResolvedValue(MOCK_TOKENS),
    logout: jest.fn().mockResolvedValue(undefined),
  };
  return { authService };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;
  let mocks: ReturnType<typeof buildMocks>;

  beforeEach(async () => {
    mocks = buildMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mocks.authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  // ─── Register ─────────────────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    const VALID_BODY = {
      email: 'new@example.com',
      password: 'secret123',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('returns user + tokens on happy path', async () => {
      const res = buildMockRes();
      const result = await controller.register(VALID_BODY as any, res);
      expect(result).toMatchObject({ user: { email: 'test@example.com' }, tokens: MOCK_TOKENS });
      expect(mocks.authService.register).toHaveBeenCalledWith(
        VALID_BODY.email,
        VALID_BODY.password,
        VALID_BODY.firstName,
        VALID_BODY.lastName,
      );
    });

    it('sets httpOnly access_token and refresh_token cookies', async () => {
      const res = buildMockRes();
      await controller.register(VALID_BODY as any, res);
      expect(res.cookie).toHaveBeenCalledWith('access_token', MOCK_TOKENS.accessToken, expect.objectContaining({ httpOnly: true }));
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', MOCK_TOKENS.refreshToken, expect.objectContaining({ httpOnly: true }));
    });

    it('propagates ConflictException from service when email exists', async () => {
      mocks.authService.register.mockRejectedValueOnce(new ConflictException('Email already registered'));
      const res = buildMockRes();
      await expect(controller.register(VALID_BODY as any, res)).rejects.toThrow(ConflictException);
    });
  });

  // ─── Login ────────────────────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    const VALID_BODY = { email: 'test@example.com', password: 'secret123' };

    it('returns user + tokens on valid credentials', async () => {
      const res = buildMockRes();
      const result = await controller.login(VALID_BODY as any, res);
      expect(result).toMatchObject({ tokens: MOCK_TOKENS });
      expect(mocks.authService.login).toHaveBeenCalledWith(VALID_BODY.email, VALID_BODY.password);
    });

    it('sets cookies on successful login', async () => {
      const res = buildMockRes();
      await controller.login(VALID_BODY as any, res);
      expect(res.cookie).toHaveBeenCalledTimes(2);
    });

    it('propagates UnauthorizedException on bad credentials', async () => {
      mocks.authService.login.mockRejectedValueOnce(new UnauthorizedException('Invalid credentials'));
      const res = buildMockRes();
      await expect(controller.login(VALID_BODY as any, res)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── Refresh ──────────────────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('returns new tokens when refresh_token cookie present', async () => {
      const req = buildMockReq({ cookies: { refresh_token: 'old-refresh' } });
      const res = buildMockRes();
      const result = await controller.refresh(req, res);
      expect(result).toMatchObject({ tokens: MOCK_TOKENS });
      expect(mocks.authService.refreshToken).toHaveBeenCalledWith('old-refresh');
    });

    it('returns 401 when no refresh token provided', async () => {
      const req = buildMockReq({ cookies: {}, body: {} });
      const res = buildMockRes();
      const result = await controller.refresh(req, res);
      expect(result).toBeUndefined();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('sets new cookies on successful refresh', async () => {
      const req = buildMockReq({ cookies: { refresh_token: 'old-refresh' } });
      const res = buildMockRes();
      await controller.refresh(req, res);
      expect(res.cookie).toHaveBeenCalledWith('access_token', MOCK_TOKENS.accessToken, expect.objectContaining({ httpOnly: true }));
    });
  });

  // ─── Logout ───────────────────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('calls authService.logout with userId and clears cookies', async () => {
      const req = buildMockReq({ user: { userId: MOCK_USER.id } });
      const res = buildMockRes();
      const result = await controller.logout(req, res);
      expect(mocks.authService.logout).toHaveBeenCalledWith(MOCK_USER.id);
      expect(res.clearCookie).toHaveBeenCalledWith('access_token', expect.anything());
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.anything());
      expect(result).toMatchObject({ message: 'Logged out successfully' });
    });
  });
});
