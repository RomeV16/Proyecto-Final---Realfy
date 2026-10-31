import {
  Controller,
  Post,
  Patch,
  Put,
  Get,
  Param,
  Body,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { Public } from '../../common/auth/public.decorator';
import { Roles } from '../../common/auth/roles.decorator';
import { ADMIN_ONLY, MANAGEMENT_ROLES } from '../../common/auth/role-groups';

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
  @Roles(...MANAGEMENT_ROLES)
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

  /**
   * GET /tenants/me/read-policy — Política de lectura por rol (Admin).
   * Sin configurar devuelve la política por defecto: todos leen todo.
   */
  @Roles(...ADMIN_ONLY)
  @Get('me/read-policy')
  async getReadPolicy() {
    return this.tenantsService.getReadPolicy();
  }

  /**
   * PUT /tenants/me/read-policy — Reemplaza la política de lectura (Admin).
   */
  @Roles(...ADMIN_ONLY)
  @Put('me/read-policy')
  async updateReadPolicy(@Body() body: unknown) {
    return this.tenantsService.updateReadPolicy(body);
  }

  /**
   * GET /tenants/me/read-access — Qué recursos sensibles puede leer el rol del
   * usuario actual. Lo usa la web para ocultar secciones.
   */
  @Get('me/read-access')
  async getReadAccess() {
    return this.tenantsService.getReadAccess();
  }
}
