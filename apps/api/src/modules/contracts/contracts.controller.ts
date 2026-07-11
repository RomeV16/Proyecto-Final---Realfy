import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractAdjustmentService } from '../index-data/contract-adjustment.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    // NOTE: ContractAdjustmentService is provided by IndexDataModule (exported)
    // and imported into ContractsModule so RBAC + tenant scoping stay consistent.
    private readonly contractAdjustmentService: ContractAdjustmentService,
  ) {}

  /**
   * GET /contracts — List with filters + pagination.
   * Any authenticated user can read.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    const numericFields = ['page', 'limit', 'guaranteeExpiringWithinDays'];
    for (const field of numericFields) {
      if (coerced[field] !== undefined) {
        coerced[field] = Number(coerced[field]);
      }
    }
    return this.contractsService.findAll(coerced);
  }

  /**
   * GET /contracts/:id — Full detail with persons, guarantees, adjustments.
   * Any authenticated user can read.
   */
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  /**
   * POST /contracts — Create a contract with linked persons and guarantees.
   * Ventas+ roles (Admin, Gerente, Ventas).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.contractsService.create(body);
  }

  /**
   * PATCH /contracts/:id — Update contract fields.
   * Ventas+ roles (Admin, Gerente, Ventas).
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.contractsService.update(id, body);
  }

  /**
   * POST /contracts/:id/terminate — Terminate contract (set Rescindido, isActive false).
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post(':id/terminate')
  async terminate(@Param('id') id: string) {
    return this.contractsService.terminate(id);
  }

  /**
   * POST /contracts/:id/adjustments/calculate — Calculate an adjustment for a schedule entry.
   * Ventas+ roles (Admin, Gerente, Ventas).
   * Body: { scheduleId: string }
   */
  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Post(':id/adjustments/calculate')
  async calculateAdjustment(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    if (!body.scheduleId) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'scheduleId is required',
      });
    }
    return this.contractsService.calculateAdjustment(id, body.scheduleId);
  }

  /**
   * POST /contracts/:id/adjustments/:adjId/apply — Apply a calculated adjustment.
   * Admin and Gerente only.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post(':id/adjustments/:adjId/apply')
  async applyAdjustment(
    @Param('id') id: string,
    @Param('adjId') adjId: string,
  ) {
    return this.contractsService.applyAdjustment(id, adjId);
  }

  /**
   * GET /contracts/:id/adjustments — List adjustment history for a contract.
   * Any authenticated user can read.
   */
  @Get(':id/adjustments')
  async findAdjustments(@Param('id') id: string) {
    return this.contractsService.findAdjustments(id);
  }

  /**
   * POST /contracts/:id/preview-adjustment — Read-only preview of the next
   * adjustment for a contract (factor, projected rent, delta).
   * Admin and Gerente only.
   *
   * Placed here (contracts.controller.ts) rather than index-data.controller.ts
   * so the :id param resolver, RBAC guard, and tenant scoping all work via the
   * existing ContractsController pipeline.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post(':id/preview-adjustment')
  async previewAdjustment(@Param('id') id: string) {
    const preview = await this.contractAdjustmentService.preview(id);
    return {
      period: preview.period,
      indexType: preview.indexType,
      factor: preview.factor.toFixed(6),
      currentRent: preview.currentRent.toFixed(2),
      projectedRent: preview.projectedRent.toFixed(2),
      projectedDelta: preview.projectedDelta.toFixed(2),
    };
  }
}
