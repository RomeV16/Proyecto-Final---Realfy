import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { InviteUserSchema, UserRole } from '@realfy/shared';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';

/**
 * Checks if an error is a Zod validation error.
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly bcryptRounds = 12;
  private readonly invitationExpiryDays = 7;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * List all users in the current tenant.
   * Auto-filtered by Prisma Extension.
   */
  async findAll() {
    return this.prisma.client.user.findMany({
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
      orderBy: { createdAt: 'asc' },
    });
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

  /**
   * Invite a user to the current tenant.
   * Creates a UserInvitation with a unique token valid for 7 days.
   * Email sending is deferred to a later slice.
   */
  async invite(data: unknown) {
    let validated: { email: string; role: UserRole };
    try {
      validated = InviteUserSchema.parse(data) as { email: string; role: UserRole };
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid invitation data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId();
    const userId = this.tenantContext.getUserId();

    if (!tenantId || !userId) {
      throw new ForbiddenException({
        error: 'TENANT_CONTEXT_REQUIRED',
        message: 'Tenant context is required',
      });
    }

    // Check if user already exists in this tenant
    const existingUser = await this.prisma.client.user.findFirst({
      where: { email: validated.email },
    });

    if (existingUser) {
      throw new BadRequestException({
        error: 'USER_ALREADY_EXISTS',
        message: 'A user with this email already exists in your organization',
      });
    }

    const token = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.invitationExpiryDays);

    const invitation = await this.prisma.client.userInvitation.create({
      data: {
        email: validated.email,
        role: validated.role,
        tenantId,
        invitedByUserId: userId,
        token,
        expiresAt,
      },
    });

    this.logger.log(
      `User invited: email=${validated.email} role=${validated.role} tenantId=${tenantId}`,
    );

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      token: invitation.token,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Accept an invitation — creates a user in the inviter's tenant.
   * @Public endpoint — no JWT required.
   */
  async acceptInvitation(data: {
    token: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    if (!data.token || !data.password || !data.firstName || !data.lastName) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'token, password, firstName, and lastName are required',
      });
    }

    if (data.password.length < 8) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Password must be at least 8 characters',
      });
    }

    // Bypass tenant filter — we need to look up the invitation across tenants
    this.tenantContext.setBypassTenantFilter(true);
    try {
      const invitation =
        await this.prisma.client.userInvitation.findUnique({
          where: { token: data.token },
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

      if (invitation.expiresAt < new Date()) {
        throw new BadRequestException({
          error: 'INVITATION_EXPIRED',
          message: 'This invitation has expired',
        });
      }

      const passwordHash = await bcrypt.hash(
        data.password,
        this.bcryptRounds,
      );

      // Create user + mark invitation accepted in a transaction
      const result = await this.prisma.baseClient.$transaction(async (tx: any) => {
        const user = await tx.user.create({
          data: {
            email: invitation.email,
            passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
            role: invitation.role,
            tenantId: invitation.tenantId,
          },
        });

        await tx.userInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });

        return user;
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
    } finally {
      this.tenantContext.setBypassTenantFilter(false);
    }
  }

  /**
   * Update a user's role. Admin only, own tenant.
   */
  async updateRole(userId: string, role: string) {
    const validRoles = Object.values(UserRole);
    if (!validRoles.includes(role as UserRole)) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
      });
    }

    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException({
        error: 'USER_NOT_FOUND',
        message: 'User not found in your organization',
      });
    }

    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: { role: role as any },
    });

    this.logger.log(`User role updated: userId=${userId} role=${role}`);

    return {
      id: updated.id,
      email: updated.email,
      role: updated.role,
    };
  }

  /**
   * Deactivate a user. Admin only, own tenant.
   */
  async deactivate(userId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException({
        error: 'USER_NOT_FOUND',
        message: 'User not found in your organization',
      });
    }

    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    this.logger.log(`User deactivated: userId=${userId}`);

    return {
      id: updated.id,
      email: updated.email,
      isActive: updated.isActive,
    };
  }
}
