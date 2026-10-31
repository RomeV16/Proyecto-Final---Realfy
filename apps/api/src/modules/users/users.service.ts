import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AcceptInvitationSchema,
  InviteUserSchema,
  UpdateUserSchema,
  UserRole,
  type ShareableLink,
  type TeamMember,
} from '@realfy/shared';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CommonEmailService } from '../../common/email/common-email.service';
import { parseOrThrow } from '../../common/validation/zod';
import {
  buildWebLink,
  expiryFromNow,
  generateOneTimeToken,
  hashToken,
  INVITATION_TTL_MS,
  isExpired,
  resolveWebBaseUrl,
} from '../../common/auth/one-time-token';

const ACCEPT_PATH = '/auth/accept-invitation';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly bcryptRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    private readonly email: CommonEmailService,
  ) {}

  /**
   * Equipo de la inmobiliaria: usuarios (activos o desactivados) más las
   * invitaciones que todavía no se aceptaron. Auto-filtrado por tenant.
   */
  async findAll(): Promise<TeamMember[]> {
    const [users, invitations] = await Promise.all([
      this.prisma.client.user.findMany({
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      }),
      this.prisma.client.userInvitation.findMany({
        where: { acceptedAt: null },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          createdAt: true,
        },
      }),
    ]);

    const members: TeamMember[] = [
      ...users.map((u: any) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role as UserRole,
        status: u.isActive ? ('active' as const) : ('inactive' as const),
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        createdAt: u.createdAt.toISOString(),
        invitationExpiresAt: null,
        invitationExpired: false,
      })),
      ...invitations.map((i: any) => ({
        id: i.id,
        email: i.email,
        firstName: null,
        lastName: null,
        role: i.role as UserRole,
        status: 'invited' as const,
        isActive: false,
        lastLoginAt: null,
        createdAt: i.createdAt.toISOString(),
        invitationExpiresAt: i.expiresAt.toISOString(),
        invitationExpired: isExpired(i.expiresAt),
      })),
    ];
    return members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Update the current user's own profile (name only).
   */
  async updateMe(data: { firstName?: string; lastName?: string }) {
    const userId = this.tenantContext.getUserId();
    if (!userId) {
      throw new ForbiddenException({
        error: 'USER_CONTEXT_REQUIRED',
        message: 'No authenticated user in context',
      });
    }

    const clean: { firstName?: string; lastName?: string } = {};
    if (typeof data.firstName === 'string' && data.firstName.trim()) {
      clean.firstName = data.firstName.trim();
    }
    if (typeof data.lastName === 'string' && data.lastName.trim()) {
      clean.lastName = data.lastName.trim();
    }
    if (Object.keys(clean).length === 0) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Nothing to update',
      });
    }

    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: clean,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        tenantId: true,
      },
    });

    this.logger.log(`User profile updated: id=${user.id}`);
    return user;
  }

  private acceptLink(token: string): string {
    return buildWebLink(
      resolveWebBaseUrl({
        WEB_BASE_URL: this.config.get<string>('WEB_BASE_URL'),
        CORS_ORIGINS: this.config.get<string>('CORS_ORIGINS'),
      }),
      ACCEPT_PATH,
      token,
    );
  }

  /** Manda el enlace por correo si hay servicio; nunca hace fallar la operación. */
  private async mailInvitation(email: string, link: string): Promise<boolean> {
    if (!this.email.isConfigured()) return false;
    const sent = await this.email.sendEmail({
      to: email,
      subject: 'Te invitaron a Realfy',
      html:
        `<p>Te invitaron a sumarte a una inmobiliaria en Realfy.</p>` +
        `<p>Creá tu cuenta desde este enlace. Sirve una sola vez y vence en 7 días:</p>` +
        `<p><a href="${link}">${link}</a></p>`,
    });
    return sent !== null;
  }

  private requireAdminContext(): { tenantId: string; userId: string } {
    const tenantId = this.tenantContext.getTenantId();
    const userId = this.tenantContext.getUserId();
    if (!tenantId || !userId) {
      throw new ForbiddenException({
        error: 'TENANT_CONTEXT_REQUIRED',
        message: 'Tenant context is required',
      });
    }
    // Defensa en profundidad: el enlace de acceso solo lo ve un Admin, aunque
    // el decorador del controlador cambie.
    if (this.tenantContext.getUserRole() !== UserRole.Admin) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'Only an Admin can manage invitations',
      });
    }
    return { tenantId, userId };
  }

  /**
   * Invite a user to the current tenant. The token is random (256 bits), only
   * its SHA-256 is stored, and it is returned once, to the Admin, as a link.
   */
  async invite(data: unknown): Promise<ShareableLink> {
    const validated = parseOrThrow(InviteUserSchema, data, 'Invalid invitation data');
    const { tenantId, userId } = this.requireAdminContext();
    const email = validated.email.trim();

    const existingUser = await this.prisma.client.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existingUser) {
      throw new BadRequestException({
        error: 'USER_ALREADY_EXISTS',
        message: 'A user with this email already exists in your organization',
      });
    }

    const pending = await this.prisma.client.userInvitation.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, acceptedAt: null },
    });
    if (pending && !isExpired(pending.expiresAt)) {
      throw new ConflictException({
        error: 'INVITATION_ALREADY_PENDING',
        message: 'There is already a pending invitation for this email',
      });
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = expiryFromNow(INVITATION_TTL_MS);

    // Una invitación vencida del mismo correo se reutiliza en vez de duplicarla.
    const invitation = pending
      ? await this.prisma.client.userInvitation.update({
          where: { id: pending.id },
          data: {
            role: validated.role,
            token: tokenHash,
            expiresAt,
            invitedByUserId: userId,
          },
        })
      : await this.prisma.client.userInvitation.create({
          data: {
            email,
            tenantId,
            role: validated.role,
            invitedByUserId: userId,
            token: tokenHash,
            expiresAt,
          },
        });

    const link = this.acceptLink(token);
    const emailSent = await this.mailInvitation(email, link);
    this.logger.log(`User invited: invitationId=${invitation.id} role=${validated.role}`);

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as UserRole,
      expiresAt: invitation.expiresAt.toISOString(),
      token,
      link,
      emailSent,
    };
  }

  /** Reenvío: rota el token (el anterior deja de servir) y renueva el plazo. */
  async resendInvitation(invitationId: string): Promise<ShareableLink> {
    this.requireAdminContext();

    const invitation = await this.prisma.client.userInvitation.findFirst({
      where: { id: invitationId, acceptedAt: null },
    });
    if (!invitation) {
      throw new NotFoundException({
        error: 'INVITATION_NOT_FOUND',
        message: 'Pending invitation not found in your organization',
      });
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = expiryFromNow(INVITATION_TTL_MS);
    await this.prisma.client.userInvitation.update({
      where: { id: invitation.id },
      data: { token: tokenHash, expiresAt },
    });

    const link = this.acceptLink(token);
    const emailSent = await this.mailInvitation(invitation.email, link);
    this.logger.log(`Invitation resent: invitationId=${invitation.id}`);

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as UserRole,
      expiresAt: expiresAt.toISOString(),
      token,
      link,
      emailSent,
    };
  }

  /**
   * Accept an invitation — creates a user in the inviter's tenant.
   * @Public endpoint — no JWT required.
   */
  async acceptInvitation(data: unknown) {
    const validated = parseOrThrow(
      AcceptInvitationSchema,
      data,
      'token, password, firstName and lastName are required',
    );

    const invitation = await this.prisma.baseClient.userInvitation.findUnique({
      where: { token: hashToken(validated.token) },
    });

    if (!invitation) {
      throw new BadRequestException({
        error: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }
    if (invitation.acceptedAt) {
      throw new BadRequestException({
        error: 'INVITATION_ALREADY_ACCEPTED',
        message: 'This invitation has already been accepted',
      });
    }
    if (isExpired(invitation.expiresAt)) {
      throw new BadRequestException({
        error: 'INVITATION_EXPIRED',
        message: 'This invitation has expired',
      });
    }

    const passwordHash = await bcrypt.hash(validated.password, this.bcryptRounds);

    const result = await this.prisma.baseClient.$transaction(async (tx: any) => {
      // Reclama la invitación primero: si dos pedidos llegan juntos, solo uno
      // pasa de acceptedAt = null.
      const claimed = await tx.userInvitation.updateMany({
        where: { id: invitation.id, acceptedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({
          error: 'INVITATION_ALREADY_ACCEPTED',
          message: 'This invitation has already been accepted',
        });
      }
      return tx.user.create({
        data: {
          email: invitation.email,
          passwordHash,
          firstName: validated.firstName,
          lastName: validated.lastName,
          role: invitation.role,
          tenantId: invitation.tenantId,
        },
      });
    });

    this.logger.log(
      `Invitation accepted: userId=${result.id} tenantId=${invitation.tenantId} role=${invitation.role}`,
    );

    return {
      id: result.id,
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      role: result.role,
      tenantId: result.tenantId,
    };
  }

  private async findUserOrThrow(userId: string) {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        error: 'USER_NOT_FOUND',
        message: 'User not found in your organization',
      });
    }
    return user;
  }

  /** Never leave the organization without an active Admin. */
  private async assertNotLastAdmin(user: { id: string; role: string; isActive: boolean }) {
    if (user.role !== UserRole.Admin || !user.isActive) return;
    const others = await this.prisma.client.user.count({
      where: { role: UserRole.Admin, isActive: true, id: { not: user.id } },
    });
    if (others === 0) {
      throw new ConflictException({
        error: 'LAST_ADMIN',
        message: 'The organization must keep at least one active Admin',
      });
    }
  }

  /** Cambia el rol de un usuario. Admin only, own tenant. */
  async updateRole(userId: string, data: unknown) {
    const { role } = parseOrThrow(UpdateUserSchema, data, 'Invalid role');
    const user = await this.findUserOrThrow(userId);

    if (user.role === role) {
      return { id: user.id, email: user.email, role: user.role };
    }
    if (role !== UserRole.Admin) {
      await this.assertNotLastAdmin(user);
    }

    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: { role },
    });

    this.logger.log(`User role updated: userId=${userId} from=${user.role} to=${role}`);
    return { id: updated.id, email: updated.email, role: updated.role };
  }

  /** Da de baja a un usuario y cierra sus sesiones. */
  async deactivate(userId: string) {
    if (userId === this.tenantContext.getUserId()) {
      throw new BadRequestException({
        error: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account',
      });
    }
    const user = await this.findUserOrThrow(userId);
    await this.assertNotLastAdmin(user);

    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    await this.prisma.baseClient.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    });

    this.logger.log(`User deactivated: userId=${userId}`);
    return { id: updated.id, email: updated.email, isActive: updated.isActive };
  }

  async reactivate(userId: string) {
    const user = await this.findUserOrThrow(userId);
    const updated = await this.prisma.client.user.update({
      where: { id: user.id },
      data: { isActive: true },
    });

    this.logger.log(`User reactivated: userId=${userId}`);
    return { id: updated.id, email: updated.email, isActive: updated.isActive };
  }
}
