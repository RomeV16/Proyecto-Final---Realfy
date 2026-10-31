import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import {
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  type ShareableLink,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CommonEmailService } from '../../common/email/common-email.service';
import { parseOrThrow } from '../../common/validation/zod';
import {
  buildWebLink,
  expiryFromNow,
  generateOneTimeToken,
  hashToken,
  isExpired,
  PASSWORD_RESET_TTL_MS,
  resolveWebBaseUrl,
} from '../../common/auth/one-time-token';

const RESET_PATH = '/auth/password-reset';

/**
 * Recupero de contraseña con enlace de un solo uso. Solo se guarda el hash del
 * token; el valor en claro sale una vez, hacia el Admin o por correo.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly bcryptRounds = 12;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    private readonly email: CommonEmailService,
  ) {}

  private link(token: string): string {
    return buildWebLink(
      resolveWebBaseUrl({
        WEB_BASE_URL: this.config.get<string>('WEB_BASE_URL'),
        CORS_ORIGINS: this.config.get<string>('CORS_ORIGINS'),
      }),
      RESET_PATH,
      token,
    );
  }

  /**
   * Pedido público por correo. No revela si la cuenta existe: el llamador
   * responde siempre 202. Si no hay servicio de correo, no se envía nada.
   */
  async requestByEmail(data: unknown): Promise<void> {
    const { email } = parseOrThrow(PasswordResetRequestSchema, data, 'Invalid request');

    const user = await this.prisma.baseClient.user.findFirst({
      where: { email, isActive: true },
      select: { id: true, tenantId: true, firstName: true },
    });
    if (!user) return;

    if (!this.email.isConfigured()) {
      this.logger.warn('Password reset requested but mail is not configured; nothing sent');
      return;
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = expiryFromNow(PASSWORD_RESET_TTL_MS);
    await this.prisma.baseClient.$transaction([
      this.prisma.baseClient.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.baseClient.passwordResetToken.create({
        data: { tenantId: user.tenantId, userId: user.id, tokenHash, expiresAt },
      }),
    ]);

    await this.email.sendEmail({
      to: email,
      subject: 'Recuperá tu contraseña de Realfy',
      html:
        `<p>Hola ${escapeHtml(user.firstName)},</p>` +
        `<p>Para elegir una contraseña nueva entrá a este enlace. Sirve una sola vez y vence en 1 hora:</p>` +
        `<p><a href="${this.link(token)}">${this.link(token)}</a></p>` +
        `<p>Si no lo pediste, ignorá este mensaje.</p>`,
    });
    this.logger.log(`Password reset mail sent: userId=${user.id}`);
  }

  /** Enlace generado por un Admin para una persona de su inmobiliaria. */
  async createLinkForUser(userId: string): Promise<ShareableLink> {
    const adminId = this.tenantContext.getUserId();
    if (!adminId) {
      throw new ForbiddenException({
        error: 'USER_CONTEXT_REQUIRED',
        message: 'No authenticated user in context',
      });
    }

    const user = await this.prisma.client.user.findFirst({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException({
        error: 'USER_NOT_FOUND',
        message: 'User not found in your organization',
      });
    }
    if (!user.isActive) {
      throw new BadRequestException({
        error: 'USER_INACTIVE',
        message: 'The user is deactivated',
      });
    }

    const { token, tokenHash } = generateOneTimeToken();
    const expiresAt = expiryFromNow(PASSWORD_RESET_TTL_MS);
    await this.prisma.client.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const row = await this.prisma.client.passwordResetToken.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash,
        expiresAt,
        createdById: adminId,
      },
    });

    this.logger.log(`Password reset link created: userId=${user.id} by=${adminId}`);
    return {
      id: row.id,
      email: user.email,
      expiresAt: expiresAt.toISOString(),
      token,
      link: this.link(token),
      emailSent: false,
    };
  }

  /** Consume el token (una sola vez) y fija la contraseña nueva. */
  async confirm(data: unknown): Promise<void> {
    const { token, newPassword } = parseOrThrow(
      PasswordResetConfirmSchema,
      data,
      'Invalid password reset data',
    );

    const row = await this.prisma.baseClient.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, isActive: true } } },
    });

    if (!row || !row.user.isActive) {
      throw new BadRequestException({
        error: 'PASSWORD_RESET_INVALID',
        message: 'The link is not valid',
      });
    }
    if (row.usedAt) {
      throw new BadRequestException({
        error: 'PASSWORD_RESET_USED',
        message: 'This link has already been used',
      });
    }
    if (isExpired(row.expiresAt)) {
      throw new BadRequestException({
        error: 'PASSWORD_RESET_EXPIRED',
        message: 'This link has expired',
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, this.bcryptRounds);

    await this.prisma.baseClient.$transaction(async (tx: any) => {
      // El updateMany condicionado a usedAt: null es el que garantiza el
      // uso único aunque lleguen dos pedidos a la vez.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException({
          error: 'PASSWORD_RESET_USED',
          message: 'This link has already been used',
        });
      }
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await tx.refreshToken.updateMany({
        where: { userId: row.userId },
        data: { isRevoked: true },
      });
    });

    this.logger.log(`Password reset completed: userId=${row.userId}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
