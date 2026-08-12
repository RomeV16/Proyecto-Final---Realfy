import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PortalJwtPayload } from '../../common/auth/portal-jwt.strategy';

export interface PortalAuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class PortalAuthService {
  private readonly logger = new Logger(PortalAuthService.name);
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
   * Login with email + password for portal (inquilino) users.
   * Bypasses tenant filter since the user hasn't been authenticated yet.
   */
  async login(
    email: string,
    password: string,
  ): Promise<{ person: any; tokens: PortalAuthTokens }> {
    this.tenantContext.setBypassTenantFilter(true);

    try {
      // Find person by email with active portal credential
      const credential = await this.prisma.baseClient.inquilinoCredential.findFirst({
        where: {
          isActive: true,
          person: {
            email,
            isActive: true,
          },
        },
        include: {
          person: true,
        },
      });

      if (!credential) {
        this.logger.warn(`Portal login failed: no active credential for email=${email}`);
        throw new UnauthorizedException({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      const passwordValid = await bcrypt.compare(password, credential.passwordHash);
      if (!passwordValid) {
        this.logger.warn(
          `Portal login failed: bad password for personId=${credential.personId}`,
        );
        throw new UnauthorizedException({
          error: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        });
      }

      // Update last login
      await this.prisma.baseClient.inquilinoCredential.update({
        where: { id: credential.id },
        data: { lastLoginAt: new Date() },
      });

      const tokens = await this.generateTokens(
        credential.personId,
        credential.tenantId,
      );

      this.logger.log(
        `Portal login success: personId=${credential.personId} tenantId=${credential.tenantId}`,
      );

      return {
        person: {
          id: credential.person.id,
          email: credential.person.email,
          firstName: credential.person.firstName,
          lastName: credential.person.lastName,
          tenantId: credential.tenantId,
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
  async refreshToken(token: string): Promise<PortalAuthTokens> {
    this.tenantContext.setBypassTenantFilter(true);

    try {
      const storedToken = await this.prisma.baseClient.portalRefreshToken.findUnique({
        where: { token },
        include: { person: true },
      });

      if (!storedToken) {
        throw new UnauthorizedException({
          error: 'TOKEN_INVALID',
          message: 'Refresh token not found',
        });
      }

      if (storedToken.isRevoked) {
        // Potential token theft — revoke ALL tokens for this person
        this.logger.warn(
          `Portal revoked refresh token reuse detected: personId=${storedToken.personId} tokenId=${storedToken.id}`,
        );
        await this.prisma.baseClient.portalRefreshToken.updateMany({
          where: { personId: storedToken.personId },
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

      if (!storedToken.person.isActive) {
        throw new UnauthorizedException({
          error: 'PERSON_INACTIVE',
          message: 'Account is deactivated',
        });
      }

      // Rotate: revoke old, issue new
      await this.prisma.baseClient.portalRefreshToken.update({
        where: { id: storedToken.id },
        data: { isRevoked: true },
      });

      const tokens = await this.generateTokens(
        storedToken.personId,
        storedToken.tenantId,
      );

      this.logger.log(
        `Portal token refresh: personId=${storedToken.personId}`,
      );

      return tokens;
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Set password from invitation token.
   * Validates the invitation token, creates InquilinoCredential, and marks invitation as accepted.
   */
  async setPassword(
    invitationToken: string,
    password: string,
  ): Promise<{ person: any; tokens: PortalAuthTokens }> {
    this.tenantContext.setBypassTenantFilter(true);

    try {
      const invitation = await this.prisma.baseClient.portalInvitation.findUnique({
        where: { token: invitationToken },
        include: { person: true },
      });

      if (!invitation) {
        throw new BadRequestException({
          error: 'INVITATION_INVALID',
          message: 'Invalid invitation token',
        });
      }

      if (invitation.acceptedAt) {
        throw new BadRequestException({
          error: 'INVITATION_ALREADY_ACCEPTED',
          message: 'This invitation has already been used',
        });
      }

      if (invitation.expiresAt < new Date()) {
        throw new BadRequestException({
          error: 'INVITATION_EXPIRED',
          message: 'This invitation has expired',
        });
      }

      const passwordHash = await bcrypt.hash(password, this.bcryptRounds);

      // Create or update credential + accept invitation in a transaction
      const result = await this.prisma.baseClient.$transaction(async (tx: any) => {
        // Upsert credential — person may already have one from a previous invitation
        const credential = await tx.inquilinoCredential.upsert({
          where: { personId: invitation.personId },
          create: {
            personId: invitation.personId,
            tenantId: invitation.tenantId,
            passwordHash,
            isActive: true,
          },
          update: {
            passwordHash,
            isActive: true,
          },
        });

        // Mark invitation as accepted
        await tx.portalInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        return credential;
      });

      const tokens = await this.generateTokens(
        invitation.personId,
        invitation.tenantId,
      );

      this.logger.log(
        `Portal password set: personId=${invitation.personId} invitationId=${invitation.id}`,
      );

      return {
        person: {
          id: invitation.person.id,
          email: invitation.person.email,
          firstName: invitation.person.firstName,
          lastName: invitation.person.lastName,
          tenantId: invitation.tenantId,
        },
        tokens,
      };
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Logout — revokes all refresh tokens for the person.
   */
  async logout(personId: string): Promise<void> {
    await this.prisma.baseClient.portalRefreshToken.updateMany({
      where: { personId },
      data: { isRevoked: true },
    });

    this.logger.log(`Portal logout: personId=${personId} — all tokens revoked`);
  }

  /**
   * Generate a JWT access token with type:'portal' + persist a refresh token.
   */
  private async generateTokens(
    personId: string,
    tenantId: string,
  ): Promise<PortalAuthTokens> {
    const payload: Omit<PortalJwtPayload, 'iat' | 'exp'> = {
      sub: personId,
      tenantId,
      type: 'portal',
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.accessTokenExpiry as any,
    });

    const refreshTokenValue = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenDays);

    await this.prisma.baseClient.portalRefreshToken.create({
      data: {
        token: refreshTokenValue,
        personId,
        tenantId,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }
}
