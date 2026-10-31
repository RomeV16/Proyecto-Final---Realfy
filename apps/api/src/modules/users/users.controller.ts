import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { CREDENTIALS_THROTTLE } from '../../common/auth/credentials-throttle';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ADMIN_ONLY, MANAGEMENT_ROLES } from '../../common/auth/role-groups';

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /**
   * GET /users — equipo de la inmobiliaria con su estado
   * (invited / active / inactive). Admin y Gerente (solo lectura).
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  /**
   * POST /users/invite — invita a alguien con un rol. Admin only; la respuesta
   * trae el enlace de aceptación para compartirlo a mano.
   */
  @Roles(...ADMIN_ONLY)
  @Post('invite')
  async invite(@Body() body: Record<string, unknown>) {
    return this.usersService.invite(body);
  }

  /**
   * POST /users/accept-invitation — Accept an invitation.
   * @Public — no JWT required.
   */
  @Public()
  @Throttle(CREDENTIALS_THROTTLE)
  @Post('accept-invitation')
  async acceptInvitation(@Body() body: Record<string, unknown>) {
    return this.usersService.acceptInvitation(body);
  }

  /**
   * PATCH /users/me — Update the current user's own profile.
   * Any authenticated user may edit their name.
   */
  @Patch('me')
  async updateMe(
    @Body() body: { firstName?: string; lastName?: string },
  ) {
    return this.usersService.updateMe(body);
  }

  /** PATCH /users/:id — cambia el rol. Admin only. */
  @Roles(...ADMIN_ONLY)
  @AuditOperation('role-change')
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.usersService.updateRole(id, body);
  }

  /** POST /users/:id/deactivate — baja del usuario y cierre de sesiones. Admin only. */
  @Roles(...ADMIN_ONLY)
  @AuditOperation('deactivate')
  @Post(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }

  /** POST /users/:id/reactivate — vuelve a habilitar al usuario. Admin only. */
  @Roles(...ADMIN_ONLY)
  @AuditOperation('reactivate')
  @Post(':id/reactivate')
  async reactivate(@Param('id') id: string) {
    return this.usersService.reactivate(id);
  }

  /** POST /users/:id/invitation/resend — `:id` es el de la invitación pendiente. Admin only. */
  @Roles(...ADMIN_ONLY)
  @AuditOperation('invitation-resend')
  @Post(':id/invitation/resend')
  async resendInvitation(@Param('id') id: string) {
    return this.usersService.resendInvitation(id);
  }

  /** POST /users/:id/password-reset-link — enlace de un solo uso para compartir. Admin only. */
  @Roles(...ADMIN_ONLY)
  @AuditOperation('password-reset-link')
  @Post(':id/password-reset-link')
  async passwordResetLink(@Param('id') id: string) {
    return this.passwordReset.createLinkForUser(id);
  }
}
