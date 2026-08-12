import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PortalAuthService } from './portal-auth.service';

jest.mock('bcrypt');

describe('PortalAuthService', () => {
  let service: PortalAuthService;
  let prisma: any;
  let jwtService: any;
  let configService: any;
  let tenantContext: any;

  beforeEach(() => {
    prisma = {
      baseClient: {
        inquilinoCredential: {
          findFirst: jest.fn(),
          update: jest.fn(),
        },
        portalRefreshToken: {
          create: jest.fn().mockResolvedValue({}),
          update: jest.fn(),
          updateMany: jest.fn(),
          findUnique: jest.fn(),
        },
        portalInvitation: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      },
    };

    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };

    configService = {
      get: jest.fn((key: string, fallback?: string) => fallback),
    };

    tenantContext = {
      setBypassTenantFilter: jest.fn(),
    };

    service = new PortalAuthService(
      prisma,
      jwtService,
      configService,
      tenantContext,
    );
  });

  describe('login', () => {
    it('throws UnauthorizedException when no active credential exists', async () => {
      prisma.baseClient.inquilinoCredential.findFirst.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', 'secret'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tenantContext.setBypassTenantFilter).toHaveBeenCalledWith(false);
    });

    it('throws UnauthorizedException when the password does not match', async () => {
      prisma.baseClient.inquilinoCredential.findFirst.mockResolvedValue({
        id: 'cred-1',
        personId: 'person-1',
        tenantId: 'tenant-1',
        passwordHash: 'hash',
        person: { id: 'person-1', email: 'a@b.com', isActive: true },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login('a@b.com', 'wrong'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns person + tokens on valid credentials', async () => {
      prisma.baseClient.inquilinoCredential.findFirst.mockResolvedValue({
        id: 'cred-1',
        personId: 'person-1',
        tenantId: 'tenant-1',
        passwordHash: 'hash',
        person: {
          id: 'person-1',
          email: 'a@b.com',
          firstName: 'Ada',
          lastName: 'Lovelace',
          isActive: true,
        },
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login('a@b.com', 'right');

      expect(result.person.id).toBe('person-1');
      expect(result.tokens.accessToken).toBe('signed.jwt.token');
      expect(typeof result.tokens.refreshToken).toBe('string');
      expect(prisma.baseClient.inquilinoCredential.update).toHaveBeenCalled();
      expect(prisma.baseClient.portalRefreshToken.create).toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes all refresh tokens for the person', async () => {
      await service.logout('person-1');
      expect(
        prisma.baseClient.portalRefreshToken.updateMany,
      ).toHaveBeenCalledWith({
        where: { personId: 'person-1' },
        data: { isRevoked: true },
      });
    });
  });
});
