import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  /**
   * GET /leads — List leads with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    if (coerced.isActive !== undefined) {
      coerced.isActive = coerced.isActive === 'true' || coerced.isActive === true;
    }
    return this.leadsService.findAll(coerced);
  }

  /**
   * GET /leads/:id — Single lead detail with person/pipeline/stage.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  /**
   * POST /leads — Create a new lead.
   * Admin/Gerente/Ventas can create.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.leadsService.create(body);
  }

  /**
   * PATCH /leads/:id — Update lead fields (notes, budget, propertyId, source).
   * Admin/Gerente/Ventas can update.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.leadsService.update(id, body);
  }

  /**
   * PATCH /leads/:id/stage — Move lead to a new stage (same pipeline).
   * Admin/Gerente/Ventas can move.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id/stage')
  async moveStage(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.leadsService.moveStage(id, body);
  }

  /**
   * PATCH /leads/:id/assign — Reassign lead to a specific user.
   * Admin/Gerente/Ventas can reassign.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id/assign')
  async assign(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.leadsService.assign(id, body);
  }

  /**
   * POST /leads/:id/convert — Convert lead to Inquilino or Comprador.
   * Admin/Gerente/Ventas can convert.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/convert')
  @HttpCode(200)
  async convert(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.leadsService.convert(id, body);
  }

  /**
   * POST /leads/:id/lose — Mark lead as lost with mandatory reason.
   * Admin/Gerente/Ventas can mark as lost.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/lose')
  @HttpCode(200)
  async lose(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.leadsService.lose(id, body);
  }

  /**
   * DELETE /leads/:id — Soft-delete a lead.
   * Admin/Gerente/Ventas can delete.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.leadsService.remove(id);
  }
}
