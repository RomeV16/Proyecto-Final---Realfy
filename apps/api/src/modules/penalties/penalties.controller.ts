import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { PenaltiesService } from './penalties.service';
import { PenaltiesScheduler } from './penalties.scheduler';
import { UpdatePenaltyConfigDto } from '../tenants/dto/update-penalty-config.dto';
import { WaivePenaltyDto } from './dto/waive-penalty.dto';
import { PreviewPenaltyDto } from './dto/preview-penalty.dto';

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
   * GET /penalties?status=active|waived|all
   * List penalties for the current tenant, optionally filtered by status.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get('penalties')
  async listPenalties(@Query('status') status?: string) {
    const where: Record<string, any> = {};

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
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get('penalties/delinquent-tenants')
  async getDelinquentTenants() {
    const tenantId = this.tenantContext.getTenantId();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Fetch overdue liquidaciones with their penalties
    const overdueLiquidaciones = await this.prisma.baseClient.liquidacion.findMany({
      where: {
        tenantId,
        status: 'Enviada' as any,
        dueDate: { lt: today },
      },
      include: {
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
      const daysOverdue = Math.max(
        0,
        Math.floor((today.getTime() - liq.dueDate.getTime()) / 86_400_000),
      );

      const inquilino = liq.contract.persons?.[0];
      const personId = inquilino?.person?.id ?? `unknown-${liq.id}`;
      const fullName = inquilino
        ? `${inquilino.person.firstName} ${inquilino.person.lastName}`
        : 'Desconocido';

      const propertyId = liq.contract.property?.id;
      const propertyLabel = liq.contract.property?.title;

      const penaltySum = liq.penalties.reduce(
        (acc, p) => acc.add(new Decimal(p.amount.toString())),
        new Decimal(0),
      );

      const key = `${personId}-${propertyId ?? 'noprop'}`;

      if (grouped.has(key)) {
        const entry = grouped.get(key)!;
        entry.totalDebt = entry.totalDebt.add(new Decimal((liq as any).total?.toString() ?? '0'));
        entry.totalPenalty = entry.totalPenalty.add(penaltySum);
        entry.daysOverdueMax = Math.max(entry.daysOverdueMax, daysOverdue);
      } else {
        grouped.set(key, {
          personId,
          fullName,
          propertyId,
          propertyLabel,
          totalDebt: new Decimal((liq as any).total?.toString() ?? '0'),
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
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Get('penalties/delinquent-tenants/count')
  async getDelinquentTenantsCount() {
    const tenantId = this.tenantContext.getTenantId();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const count = await this.prisma.baseClient.liquidacion.count({
      where: {
        tenantId,
        status: 'Enviada' as any,
        dueDate: { lt: today },
      },
    });

    return { count };
  }

  /**
   * POST /penalties/:id/waive
   * Waive a penalty. Admin only.
   */
  @Roles(UserRole.Admin)
  @Post('penalties/:id/waive')
  async waivePenalty(
    @Param('id') id: string,
    @Body() dto: WaivePenaltyDto,
  ) {
    const penalty = await this.prisma.client.penalty.findFirst({
      where: { id },
    });

    if (!penalty) {
      throw new NotFoundException({ error: 'PENALTY_NOT_FOUND', message: `Penalty ${id} not found` });
    }

    const userId = this.tenantContext.getUserId() ?? null;

    const updated = await this.prisma.client.penalty.update({
      where: { id },
      data: {
        status: 'waived',
        waivedAt: new Date(),
        waivedBy: userId,
        waiveReason: dto.reason,
      },
    });

    return updated;
  }

  /**
   * GET /tenants/me/penalty-config
   * Returns the current tenant's penalty configuration. Admin+Gerente.
   */
  @Roles(UserRole.Admin, UserRole.Gerente)
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
  @Roles(UserRole.Admin)
  @Put('tenants/me/penalty-config')
  async updatePenaltyConfig(@Body() dto: UpdatePenaltyConfigDto) {
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
  @Roles(UserRole.Admin, UserRole.Gerente)
  @Post('penalties/preview')
  async previewPenalty(@Body() dto: PreviewPenaltyDto) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build synthetic dueDate so that daysOverdue matches
    const dueDate = new Date(today);
    dueDate.setDate(dueDate.getDate() - dto.daysOverdue);

    const result = this.penaltiesService.computePenalty({
      liquidacion: {
        id: 'preview',
        totalAmount: new Decimal(dto.debt),
        dueDate,
        tenantId: 'preview',
      },
      config: {
        mode: dto.config.mode as 'daily_fixed' | 'daily_percent' | 'compound_percent',
        value: new Decimal(dto.config.value),
        graceDays: dto.config.graceDays,
        maxMultiplier: new Decimal(dto.config.maxMultiplier),
      },
      asOf: today,
      alreadyAppliedPenalty: new Decimal(0),
    });

    return {
      amount: result.amount.toFixed(2),
      daysOverdue: result.daysOverdue,
      compoundBase: result.compoundBase.toFixed(2),
      capHit: result.capHit,
    };
  }

  /**
   * POST /penalties/_run-now
   * Test-only endpoint: triggers the daily penalty scheduler immediately.
   * Guarded by NODE_ENV=test or E2E_TEST_MODE=1.
   */
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
