import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ForbiddenException,
  } from '@nestjs/common';
import Decimal from 'decimal.js';
import { Roles } from '../../common/auth/roles.decorator';
import {
  PenaltyConfigSchema,
  PreviewPenaltySchema,
  WaivePenaltySchema,
  WaiveAllQuerySchema,
  OVERDUE_STATUSES,
  accruePenalty,
  personName,
  todayInAR,
} from '@realfy/shared';
import type { PenaltyConfig, PreviewPenaltyInput } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { PenaltiesService, parseDay } from './penalties.service';
import { PenaltiesScheduler } from './penalties.scheduler';
import { ZodValidationPipe, parseOrThrow } from '../../common/validation/zod';
import { outstandingBalance } from '../liquidaciones/receivables';
import { ADMIN_ONLY, MANAGEMENT_ROLES } from '../../common/auth/role-groups';

@Controller()
export class PenaltiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantsService: TenantsService,
    private readonly penaltiesService: PenaltiesService,
    private readonly scheduler: PenaltiesScheduler,
  ) {}

  /**
   * GET /penalties?status=active|waived|all&contractId=
   * List penalties for the current tenant, optionally filtered by status and contract.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('penalties')
  async listPenalties(@Query('status') status?: string, @Query('contractId') contractId?: string) {
    const where: Record<string, any> = {};
    if (contractId) where.liquidacion = { contractId };

    if (status === 'active') {
      where.status = 'active';
    } else if (status === 'waived') {
      where.status = 'waived';
    }
    // 'all' or omitted → no status filter

    return this.prisma.client.penalty.findMany({
      where,
      orderBy: { appliedOn: 'desc' },
      include: {
        liquidacion: {
          select: {
            id: true,
            period: true,
            dueDate: true,
            total: true,
            contract: {
              select: {
                id: true,
                property: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * GET /penalties/delinquent-tenants
   * Returns grouped delinquency summary per person/property.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('penalties/delinquent-tenants')
  async getDelinquentTenants() {
    const tenantId = this.tenantContext.getTenantId();
    const today = todayInAR();

    // Fetch overdue liquidaciones with their penalties
    const overdueLiquidaciones = await this.prisma.baseClient.liquidacion.findMany({
      where: {
        tenantId,
        status: { in: [...OVERDUE_STATUSES] as any },
        dueDate: { lt: today },
      },
      include: {
        payments: { select: { amount: true } },
        penalties: {
          where: { status: 'active' },
          select: { amount: true },
        },
        contract: {
          include: {
            property: { select: { id: true, title: true } },
            persons: {
              where: { role: 'Inquilino' },
              include: {
                person: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    // Group by person
    const grouped = new Map<
      string,
      {
        personId: string;
        fullName: string;
        propertyId?: string;
        propertyLabel?: string;
        totalDebt: Decimal;
        totalPenalty: Decimal;
        daysOverdueMax: number;
        lastReminderSentAt?: Date;
      }
    >();

    for (const liq of overdueLiquidaciones) {
      // Deuda = saldo pendiente (total menos pagos); una saldada no es morosa.
      const balance = outstandingBalance(liq as any);
      if (balance.lte(0)) continue;

      const daysOverdue = Math.max(
        0,
        Math.floor((today.getTime() - liq.dueDate.getTime()) / 86_400_000),
      );

      const inquilino = liq.contract.persons?.[0];
      const personId = inquilino?.person?.id ?? `unknown-${liq.id}`;
      const fullName = personName(inquilino?.person) || 'Desconocido';

      const propertyId = liq.contract.property?.id;
      const propertyLabel = liq.contract.property?.title;

      const penaltySum = liq.penalties.reduce(
        (acc, p) => acc.add(new Decimal(p.amount.toString())),
        new Decimal(0),
      );

      const key = `${personId}-${propertyId ?? 'noprop'}`;

      if (grouped.has(key)) {
        const entry = grouped.get(key)!;
        entry.totalDebt = entry.totalDebt.add(new Decimal(balance.toString()));
        entry.totalPenalty = entry.totalPenalty.add(penaltySum);
        entry.daysOverdueMax = Math.max(entry.daysOverdueMax, daysOverdue);
      } else {
        grouped.set(key, {
          personId,
          fullName,
          propertyId,
          propertyLabel,
          totalDebt: new Decimal(balance.toString()),
          totalPenalty: penaltySum,
          daysOverdueMax: daysOverdue,
        });
      }
    }

    return Array.from(grouped.values()).map((entry) => ({
      personId: entry.personId,
      fullName: entry.fullName,
      propertyId: entry.propertyId,
      propertyLabel: entry.propertyLabel,
      totalDebt: entry.totalDebt.toFixed(2),
      totalPenalty: entry.totalPenalty.toFixed(2),
      daysOverdueMax: entry.daysOverdueMax,
      lastReminderSentAt: entry.lastReminderSentAt ?? null,
    }));
  }

  /**
   * GET /penalties/delinquent-tenants/count
   * Returns count of delinquent persons.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('penalties/delinquent-tenants/count')
  async getDelinquentTenantsCount() {
    const tenantId = this.tenantContext.getTenantId();
    const today = todayInAR();

    const count = await this.prisma.baseClient.liquidacion.count({
      where: {
        tenantId,
        status: { in: [...OVERDUE_STATUSES] as any },
        dueDate: { lt: today },
      },
    });

    return { count };
  }

  /**
   * POST /penalties/:id/waive
   * Condona un punitorio con motivo obligatorio; queda auditado y no entra en la
   * próxima liquidación. Admin y Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post('penalties/:id/waive')
  async waivePenalty(@Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(WaivePenaltySchema, body, 'Invalid waive data');
    return this.penaltiesService.waive(id, dto.reason);
  }

  /**
   * POST /contracts/:id/penalties/waive-all?upTo=YYYY-MM-DD
   * Condonación masiva: todos los punitorios activos y sin cobrar del contrato
   * hasta `upTo` (por defecto hoy), con un motivo. Admin y Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post('contracts/:id/penalties/waive-all')
  async waiveAll(@Param('id') id: string, @Query() query: unknown, @Body() body: unknown) {
    const q = parseOrThrow(WaiveAllQuerySchema, query, 'Invalid waive-all query');
    const dto = parseOrThrow(WaivePenaltySchema, body, 'Invalid waive data');
    return this.penaltiesService.waiveAll(id, q.upTo ? parseDay(q.upTo) : todayInAR(), dto.reason);
  }

  /**
   * GET /tenants/me/penalty-config
   * Returns the current tenant's penalty configuration. Admin+Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Get('tenants/me/penalty-config')
  async getPenaltyConfig() {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required' });
    }
    return this.tenantsService.getPenaltyConfig(tenantId);
  }

  /**
   * PUT /tenants/me/penalty-config
   * Updates the current tenant's penalty configuration. Admin only.
   */
  @Roles(...ADMIN_ONLY)
  @Put('tenants/me/penalty-config')
  async updatePenaltyConfig(@Body(new ZodValidationPipe(PenaltyConfigSchema, 'Invalid penalty config')) dto: PenaltyConfig) {
    const tenantId = this.tenantContext.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required' });
    }
    return this.tenantsService.updatePenaltyConfig(tenantId, dto);
  }

  /**
   * POST /penalties/preview
   * Live preview of penalty calculation with a synthetic liquidacion. Admin+Gerente.
   */
  @Roles(...MANAGEMENT_ROLES)
  @Post('penalties/preview')
  async previewPenalty(@Body(new ZodValidationPipe(PreviewPenaltySchema, 'Invalid penalty preview')) dto: PreviewPenaltyInput) {
    const today = todayInAR();

    // Liquidación sintética con el vencimiento que da esos días de mora.
    const dueDate = new Date(today.getTime() - dto.daysOverdue * 86_400_000);

    const result = accruePenalty({
      dueDate,
      asOf: today,
      total: dto.debt,
      rule: dto.config,
      bnaRates: dto.bnaAnnualPct ? [{ from: new Date('2000-01-01T00:00:00.000Z'), annualPct: dto.bnaAnnualPct }] : [],
    });

    return {
      amount: result.amount.toFixed(2),
      daysOverdue: result.daysOverdue,
      compoundBase: result.baseAtStart.toFixed(2),
      capHit: result.capHit,
    };
  }

  /**
   * POST /penalties/run — Corre la acumulación de punitorios en el momento,
   * la misma que ejecuta el cron diario. Sirve para regularizar la mora sin
   * esperar a la corrida de la madrugada. Solo Admin.
   */
  @Roles(...ADMIN_ONLY)
  @Post('penalties/run')
  async run() {
    return this.scheduler.applyPenalties();
  }

  /**
   * POST /penalties/_run-now
   * Test-only endpoint: triggers the daily penalty scheduler immediately.
   * Solo Admin, y además solo con NODE_ENV=test o E2E_TEST_MODE=1.
   */
  @Roles(...ADMIN_ONLY)
  @Post('penalties/_run-now')
  async runNow() {
    const isTestMode =
      process.env.NODE_ENV === 'test' || process.env.E2E_TEST_MODE === '1';

    if (!isTestMode) {
      throw new ForbiddenException({
        error: 'FORBIDDEN',
        message: 'This endpoint is only available in test mode',
      });
    }

    const result = await this.scheduler.applyPenalties();
    return result;
  }
}
