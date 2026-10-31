import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES, SUPPORT_ROLES } from '../../common/auth/role-groups';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  /**
   * POST /providers — Create a provider (person + profile in transaction).
   * Admin, Gerente, Ventas roles.
   */
  @Roles(...SALES_ROLES)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.providersService.create(body);
  }

  /**
   * GET /providers — List providers with rubro/zone/search/isActive filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    if (coerced.page !== undefined) coerced.page = Number(coerced.page);
    if (coerced.limit !== undefined) coerced.limit = Number(coerced.limit);
    if (coerced.isActive !== undefined) coerced.isActive = coerced.isActive === 'true';
    return this.providersService.findAll(coerced);
  }

  /**
   * GET /providers/for-ticket/:ticketId — Providers filtered by ticket's category rubro and property city.
   * Admin, Gerente, Soporte roles.
   */
  @Roles(...SUPPORT_ROLES)
  @Get('for-ticket/:ticketId')
  async findForTicket(@Param('ticketId') ticketId: string) {
    return this.providersService.findForTicket(ticketId);
  }

  /**
   * GET /providers/:id — Provider detail with profile and roles.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.providersService.findOne(id);
  }

  /**
   * PATCH /providers/:id — Update provider (person fields + profile fields).
   * Admin, Gerente, Ventas roles.
   */
  @Roles(...SALES_ROLES)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.providersService.update(id, body);
  }

  /**
   * DELETE /providers/:id — Soft delete provider (deactivates person + profile).
   * Admin and Gerente only.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.providersService.softDelete(id);
  }
}
