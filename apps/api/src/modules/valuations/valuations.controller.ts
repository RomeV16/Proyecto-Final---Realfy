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
import { ValuationsService } from './valuations.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('properties/:propertyId/valuations')
export class ValuationsController {
  constructor(private readonly valuationsService: ValuationsService) {}

  /**
   * GET /properties/:propertyId/valuations — List valuations with pagination/filters.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(
    @Param('propertyId') propertyId: string,
    @Query() query: Record<string, any>,
  ) {
    // Coerce numeric query params from strings
    const coerced = { ...query };
    if (coerced.page !== undefined) coerced.page = Number(coerced.page);
    if (coerced.limit !== undefined) coerced.limit = Number(coerced.limit);
    return this.valuationsService.findAll(propertyId, coerced);
  }

  /**
   * GET /properties/:propertyId/valuations/comparables — Find comparable properties.
   * Any authenticated user can read.
   * NOTE: This route MUST be defined before :valuationId to avoid route conflicts.
   */
  @Get('comparables')
  async findComparables(@Param('propertyId') propertyId: string) {
    return this.valuationsService.findComparables(propertyId);
  }

  /**
   * GET /properties/:propertyId/valuations/:valuationId — Get single valuation.
   * Any authenticated user can read.
   */
  @Get(':valuationId')
  async findOne(
    @Param('propertyId') propertyId: string,
    @Param('valuationId') valuationId: string,
  ) {
    return this.valuationsService.findOne(propertyId, valuationId);
  }

  /**
   * POST /properties/:propertyId/valuations — Create a valuation.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post()
  async create(
    @Param('propertyId') propertyId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.valuationsService.create(propertyId, body);
  }

  /**
   * PATCH /properties/:propertyId/valuations/:valuationId — Update a valuation.
   * Ventas+ roles.
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':valuationId')
  async update(
    @Param('propertyId') propertyId: string,
    @Param('valuationId') valuationId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.valuationsService.update(propertyId, valuationId, body);
  }

  /**
   * DELETE /properties/:propertyId/valuations/:valuationId — Delete a valuation.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Delete(':valuationId')
  async remove(
    @Param('propertyId') propertyId: string,
    @Param('valuationId') valuationId: string,
  ) {
    return this.valuationsService.remove(propertyId, valuationId);
  }
}
