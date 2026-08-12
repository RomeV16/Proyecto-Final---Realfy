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
import { UserRole } from '@realfy/shared';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  /**
   * POST /providers — Create a provider (person + profile in transaction).
   * Admin, Gerente, Ventas roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
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
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Soporte)
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
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
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
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.providersService.softDelete(id);
  }
}
