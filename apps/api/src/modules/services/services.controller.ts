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
import { ServicesService } from './services.service';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';

@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  /**
   * GET /services — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    if (coerced.isActive !== undefined) {
      coerced.isActive = coerced.isActive === 'true';
    }
    return this.servicesService.findAll(coerced);
  }

  /**
   * GET /services/:id — Full detail with property + payments.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.servicesService.findOne(id);
  }

  /**
   * POST /services — Create a service.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(...SALES_ROLES)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.servicesService.create(body);
  }

  /**
   * PATCH /services/:id — Update a service.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(...SALES_ROLES)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.servicesService.update(id, body);
  }

  /**
   * DELETE /services/:id — Soft delete.
   * Admin and Gerente only.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.servicesService.softDelete(id);
  }

  /**
   * POST /services/:id/payments — Register a service payment.
   * Admin, Gerente, Ventas roles.
   */
  @Roles(...SALES_ROLES)
  @Post(':id/payments')
  async registerPayment(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.servicesService.registerPayment(id, body);
  }
}
