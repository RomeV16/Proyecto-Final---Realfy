import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { UserRole } from '@realfy/shared';
import { JwtPayload } from '../../common/auth/jwt.strategy';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly bcryptRounds = 12;
  private readonly accessTokenExpiry: string;
  private readonly refreshTokenDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tenantContext: TenantContextService,
  ) {
    this.accessTokenExpiry = this.configService.get('JWT_ACCESS_EXPIRY', '15m');
    this.refreshTokenDays = parseInt(
      this.configService.get('JWT_REFRESH_DAYS', '7'),
      10,
    );
  }

  /**
   * Register a new user + auto-provision a tenant.
   * Bypasses tenant filter since no tenant exists yet.
   */
  async register(
    email: string,
    password: string,
    firstName: string,
    lastName: string,
  ): Promise<{ user: any; tokens: AuthTokens }> {
    // Bypass tenant filter — we're creating a new tenant
    this.tenantContext.setBypassTenantFilter(true);

    try {
      // Check if email already exists globally (not tenant-scoped for registration)
      const existingUser = await this.prisma.client.user.findFirst({
        where: { email },
      });

      if (existingUser) {
        throw new ConflictException({
          error: 'EMAIL_EXISTS',
          message: 'An account with this email already exists',
        });
      }

      const passwordHash = await bcrypt.hash(password, this.bcryptRounds);

      // Create tenant + admin user in a transaction
      const result = await this.prisma.baseClient.$transaction(async (tx: any) => {
        const tenant = await tx.tenant.create({
          data: {
            name: `${firstName}'s Organization`,
            cuit: `00-${String(Date.now()).slice(-8)}-0`, // Unique placeholder — updated during onboarding
            province: 'CABA',
          },
        });

        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            firstName,
            lastName,
            role: UserRole.Admin,
            tenantId: tenant.id,
          },
        });

        return { tenant, user };
      });

      const tokens = await this.generateTokens(
        result.user.id,
        result.tenant.id,
        result.user.role as UserRole,
      );

      this.logger.log(
        `User registered: userId=${result.user.id} tenantId=${result.tenant.id}`,
      );

      return {
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
          tenantId: result.tenant.id,
        },
        tokens,
      };
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Login with email + password.
   * Bypasses tenant filter since user hasn't been authenticated yet.
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ user: any; tokens: AuthTokens }> {
    this.tenantContext.setBypassTenantFilter(true);

    try {
      const user = await this.prisma.client.user.findFirst({
        where: { email, isActive: true },
      });

      if (!user) {
        this.logger.warn(`Login failed: no active user for email=${email}`);
        throw new UnauthorizedException({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        this.logger.warn(
          `Login failed: bad password for userId=${user.id}`,
        );
        throw new UnauthorizedException({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      // Update last login
      await this.prisma.baseClient.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const tokens = await this.generateTokens(
        user.id,
        user.tenantId,
        user.role as UserRole,
      );

      this.logger.log(
        `Login success: userId=${user.id} tenantId=${user.tenantId}`,
      );

      return {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
        },
        tokens,
      };
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Refresh tokens. Rotates the refresh token — old one is revoked.
   */
  async refreshToken(token: string): Promise<AuthTokens> {
    this.tenantContext.setBypassTenantFilter(true);

    try {
      const storedToken = await this.prisma.baseClient.refreshToken.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!storedToken) {
        throw new UnauthorizedException({
          error: 'TOKEN_INVALID',
          message: 'Refresh token not found',
        });
      }

      if (storedToken.isRevoked) {
        // Potential token theft — revoke ALL tokens for this user
        this.logger.warn(
          `Revoked refresh token reuse detected: userId=${storedToken.userId} tokenId=${storedToken.id}`,
        );
        await this.prisma.baseClient.refreshToken.updateMany({
          where: { userId: storedToken.userId },
          data: { isRevoked: true },
        });
        throw new UnauthorizedException({
          error: 'TOKEN_REVOKED',
          message: 'Refresh token has been revoked',
        });
      }

      if (storedToken.expiresAt < new Date()) {
        throw new UnauthorizedException({
          error: 'TOKEN_EXPIRED',
          message: 'Refresh token has expired',
        });
      }

      if (!storedToken.user.isActive) {
        throw new UnauthorizedException({
          error: 'USER_INACTIVE',
          message: 'User account is deactivated',
        });
      }

      // Rotate: revoke old, issue new
      await this.prisma.baseClient.refreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true },
      });

      const tokens = await this.generateTokens(
        storedToken.user.id,
        storedToken.user.tenantId,
        storedToken.user.role as UserRole,
      );

      this.logger.log(
        `Token refresh: userId=${storedToken.userId}`,
      );

      return tokens;
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Logout — revokes all refresh tokens for the user.
   */
  async logout(userId: string): Promise<void> {
    await this.prisma.baseClient.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });

    this.logger.log(`Logout: userId=${userId} — all tokens revoked`);
  }

  /**
   * Generate a JWT access token + persist a refresh token.
   */
  private async generateTokens(
    userId: string,
    tenantId: string,
    role: UserRole,
  ): Promise<AuthTokens> {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      tenantId,
      role,
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.accessTokenExpiry as any,
    });

    const refreshTokenValue = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenDays);

    await this.prisma.baseClient.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }
}
