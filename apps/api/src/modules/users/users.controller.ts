import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users — List users in current tenant.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get()
  async findAll() {
    return this.usersService.findAll();
  }

  /**
   * POST /users/invite — Invite a user to the current tenant.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('invite')
  async invite(@Body() body: Record<string, any>) {
    return this.usersService.invite(body);
  }

  /**
   * POST /users/accept-invitation — Accept an invitation.
   * @Public — no JWT required.
   */
  @Public()
  @Post('accept-invitation')
  async acceptInvitation(@Body() body: {
    token: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
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

  /**
   * PATCH /users/:id/role — Update a user's role.
   * Admin only.
   */
  @Roles(UserRole.Admin)
  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body('role') role: string,
  ) {
    return this.usersService.updateRole(id, role);
  }

  /**
   * PATCH /users/:id/deactivate — Deactivate a user.
   * Admin only.
   */
  @Roles(UserRole.Admin)
  @Patch(':id/deactivate')
  async deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
