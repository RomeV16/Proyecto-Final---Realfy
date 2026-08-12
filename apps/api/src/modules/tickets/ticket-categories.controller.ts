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
import { TicketCategoriesService } from './ticket-categories.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('ticket-categories')
export class TicketCategoriesController {
  constructor(
    private readonly categoriesService: TicketCategoriesService,
  ) {}

  /**
   * POST /ticket-categories — Create a category.
   * Admin, Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.categoriesService.create(body);
  }

  /**
   * GET /ticket-categories — List categories (active only by default).
   * All authenticated users can read.
   */
  @Get()
  async findAll(@Query('activeOnly') activeOnly?: string) {
    // Default to active only; pass false explicitly to get all
    const onlyActive = activeOnly !== 'false';
    return this.categoriesService.findAll(onlyActive);
  }

  /**
   * PATCH /ticket-categories/:id — Update a category.
   * Admin, Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.categoriesService.update(id, body);
  }

  /**
   * DELETE /ticket-categories/:id — Soft delete (set isActive=false).
   * Admin, Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.categoriesService.softDelete(id);
  }
}
