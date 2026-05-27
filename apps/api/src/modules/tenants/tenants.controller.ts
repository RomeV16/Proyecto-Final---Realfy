import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * POST /tenants — Create a new tenant (inmobiliaria).
   * @Public because it's called during onboarding after registration,
   * when the user needs to set up their real tenant data.
   */
  @Public()
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.tenantsService.create(body);
  }

  /**
   * PATCH /tenants/:id — Update tenant (branding, settings).
   * Restricted to Admin and Gerente roles.
   * Only own tenant — enforced both by guard and Prisma Extension.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.tenantsService.update(id, body);
  }

  /**
   * GET /tenants/me — Return current user's tenant details.
   * Used by frontend for branding, config, tenant name display.
   */
  @Get('me')
  async findMine() {
    return this.tenantsService.findMine();
  }
}
