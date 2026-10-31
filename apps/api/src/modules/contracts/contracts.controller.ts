import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { ContractLessorsService } from './contract-lessors.service';
import { ContractRulesService } from './contract-rules.service';
import { AuditOperation } from '../../common/audit/audit-operation.decorator';
import { ContractAdjustmentService } from '../index-data/contract-adjustment.service';
import { Roles } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';
import { MaskReads } from '../../common/read-policy/read-resource.decorator';

@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly lessors: ContractLessorsService,
    private readonly rules: ContractRulesService,
    // NOTE: ContractAdjustmentService is provided by IndexDataModule (exported)
    // and imported into ContractsModule so RBAC + tenant scoping stay consistent.
    private readonly contractAdjustmentService: ContractAdjustmentService,
  ) {}

  /**
   * GET /contracts — List with filters + pagination.
   * Any authenticated user can read.
   */
  @MaskReads('persons.document', 'persons.bankAccounts', 'contracts.commission')
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
  @MaskReads('persons.document', 'persons.bankAccounts', 'contracts.commission')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.contractsService.findOne(id);
  }

  /**
   * POST /contracts — Create a contract with linked persons and guarantees.
   * Ventas+ roles (Admin, Gerente, Ventas).
   */
  @Roles(...SALES_ROLES)
  @Post()
  async create(@Body() body: Record<string, any>) {
    return this.contractsService.create(body);
  }

  /**
   * PATCH /contracts/:id — Update contract fields.
   * Ventas+ roles (Admin, Gerente, Ventas).
   */
  @Roles(...SALES_ROLES)
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    return this.contractsService.update(id, body);
  }

  /**
   * POST /contracts/:id/activate — Borrador → Activo.
   * Valida propiedad, partes, fechas y superposición con otro alquiler activo,
   * y deja la operación de alquiler de la propiedad en Alquilado.
   * Ventas+ roles (Admin, Gerente, Ventas): los mismos que pueden crear un
   * contrato, y crearlo ya activo pasa por las mismas reglas.
   */
  @Roles(...SALES_ROLES)
  @Post(':id/activate')
  async activate(@Param('id') id: string) {
    return this.contractsService.activate(id);
  }

  /**
   * POST /contracts/:id/terminate — Terminate contract (set Rescindido, isActive false).
   * Admin and Gerente only.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/terminate')
  async terminate(@Param('id') id: string) {
    return this.contractsService.terminate(id);
  }

  /**
   * POST /contracts/:id/adjustments/calculate — Calculate an adjustment for a schedule entry.
   * Ventas+ roles (Admin, Gerente, Ventas).
   * Body: { scheduleId: string }
   */
  @Roles(...SALES_ROLES)
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
  @Roles(...MANAGEMENT_ROLES)
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
  @Roles(...MANAGEMENT_ROLES)
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

  // ─── Locadores ─────────────────────────────────────

  /**
   * GET /contracts/:id/lessors — Locadores del contrato, con su porcentaje de
   * cobro. `?at=` limita a los vigentes en esa fecha.
   * Any authenticated user can read.
   */
  @MaskReads('persons.document', 'persons.bankAccounts', 'contracts.commission')
  @Get(':id/lessors')
  async listLessors(@Param('id') id: string, @Query('at') at?: string) {
    return this.lessors.list(id, at);
  }

  /**
   * POST /contracts/:id/lessors — Agrega un locador.
   * Admin, Gerente, Ventas.
   */
  @Roles(...SALES_ROLES)
  @Post(':id/lessors')
  async addLessor(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.lessors.create(id, body);
  }

  /**
   * PUT /contracts/:id/lessors — Reemplaza todo el conjunto de locadores en una
   * transacción (reparto entre varios, cesión). Admin, Gerente, Ventas.
   */
  @Roles(...SALES_ROLES)
  @Put(':id/lessors')
  async replaceLessors(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.lessors.replace(id, body);
  }

  /**
   * PATCH /contracts/:id/lessors/:lessorId — Cambia porcentaje, cuenta,
   * cobrador o vigencia. Admin, Gerente, Ventas.
   */
  @Roles(...SALES_ROLES)
  @Patch(':id/lessors/:lessorId')
  async updateLessor(
    @Param('id') id: string,
    @Param('lessorId') lessorId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.lessors.update(id, lessorId, body);
  }

  /**
   * DELETE /contracts/:id/lessors/:lessorId — Quita un locador.
   * Admin, Gerente, Ventas.
   */
  @Roles(...SALES_ROLES)
  @Delete(':id/lessors/:lessorId')
  async removeLessor(@Param('id') id: string, @Param('lessorId') lessorId: string) {
    return this.lessors.remove(id, lessorId);
  }

  // ─── Reglas versionadas y convenios ────────────────

  /**
   * GET /contracts/:id/terms — Versiones de reglas del contrato y la vigente a
   * `?at=` (hoy si se omite): `{ at, current, versions }`.
   * Any authenticated user can read.
   */
  @Get(':id/terms')
  async listTerms(@Param('id') id: string, @Query('at') at?: string) {
    return this.rules.listTerms(id, at);
  }

  /**
   * GET /contracts/:id/periods — Períodos del contrato (original, renovaciones,
   * prórrogas). Any authenticated user can read.
   */
  @Get(':id/periods')
  async listPeriods(@Param('id') id: string) {
    return this.rules.listPeriods(id);
  }

  /**
   * GET /contracts/:id/agreements — Convenios del contrato con la versión de
   * reglas que crearon. Any authenticated user can read.
   */
  @Get(':id/agreements')
  async listAgreements(@Param('id') id: string) {
    return this.rules.listAgreements(id);
  }

  /**
   * POST /contracts/:id/agreements — Registra un convenio. Si cambia las reglas
   * (`termsPatch`) crea una versión nueva en la misma transacción y actualiza
   * las columnas vigentes del contrato si rige desde hoy o antes.
   * Admin and Gerente only.
   */
  @Roles(...MANAGEMENT_ROLES)
  @AuditOperation('contract-agreement')
  @Post(':id/agreements')
  async createAgreement(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.rules.createAgreement(id, body);
  }

  /**
   * PATCH /contracts/:id/agreements/:agreementId — Corrige notas, documento o
   * fin del convenio, si ninguna versión posterior depende de él.
   * Admin and Gerente only.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id/agreements/:agreementId')
  async updateAgreement(
    @Param('id') id: string,
    @Param('agreementId') agreementId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.rules.updateAgreement(id, agreementId, body);
  }

  /**
   * DELETE /contracts/:id/agreements/:agreementId — Quita el convenio y su
   * versión de reglas, si ninguna versión posterior depende de él.
   * Admin and Gerente only.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id/agreements/:agreementId')
  async removeAgreement(@Param('id') id: string, @Param('agreementId') agreementId: string) {
    return this.rules.removeAgreement(id, agreementId);
  }
}
