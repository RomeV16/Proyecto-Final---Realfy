import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from '../liquidaciones/liquidaciones.service';

@Injectable()
export class PortalService {
  private readonly logger = new Logger(PortalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly liquidacionesService: LiquidacionesService,
  ) {}

  /**
   * Get active contracts for the authenticated inquilino.
   * Scoped via ContractPerson join where personId = authenticated person
   * and role = 'Inquilino'.
   */
  async getContracts() {
    const personId = this.tenantContext.getPersonId();
    if (!personId) {
      throw new ForbiddenException({
        error: 'PORTAL_NO_PERSON',
        message: 'No person context found for portal request',
      });
    }

    const contractPersons = await this.prisma.client.contractPerson.findMany({
      where: {
        personId,
        role: 'Inquilino',
      },
      include: {
        contract: {
          include: {
            property: true,
            adjustments: {
              orderBy: { adjustmentDate: 'desc' },
              take: 1,
            },
            schedules: {
              where: {
                nextAdjustmentDate: { gt: new Date() },
                status: 'Pending',
              },
              orderBy: { nextAdjustmentDate: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    return contractPersons
      .filter((cp: any) => (cp as any).contract?.isActive)
      .map((cp: any) => {
        const c = (cp as any).contract;
        return {
          id: c.id,
          propertyId: c.propertyId,
          property: c.property
            ? {
                id: c.property.id,
                name: (c.property as any).name ?? null,
                address: (c.property as any).address ?? null,
              }
            : null,
          contractType: c.contractType,
          status: c.status,
          startDate: c.startDate,
          endDate: c.endDate,
          rentAmount: c.rentAmount.toString(),
          rentCurrency: c.rentCurrency,
          adjustmentType: c.adjustmentType,
          adjustmentPeriod: c.adjustmentPeriod,
          nextAdjustmentDate: c.schedules?.[0]?.nextAdjustmentDate ?? null,
          lastAdjustmentDate: c.adjustments?.[0]?.adjustmentDate ?? null,
        };
      });
  }

  /**
   * Get paginated liquidaciones for the authenticated inquilino's contracts.
   * First resolves the inquilino's contract IDs, then queries liquidaciones
   * scoped to those contracts.
   */
  async getLiquidaciones(query: { page?: number; limit?: number }) {
    const personId = this.tenantContext.getPersonId();
    if (!personId) {
      throw new ForbiddenException({
        error: 'PORTAL_NO_PERSON',
        message: 'No person context found for portal request',
      });
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit =
      query.limit && query.limit > 0 ? Math.min(query.limit, 100) : 20;
    const skip = (page - 1) * limit;

    // Get the inquilino's contract IDs
    const contractPersons = await this.prisma.client.contractPerson.findMany({
      where: {
        personId,
        role: 'Inquilino',
      },
      select: { contractId: true },
    });

    const contractIds = contractPersons.map((cp: any) => cp.contractId);

    if (contractIds.length === 0) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    }

    const where = { contractId: { in: contractIds } };

    const [items, total] = await Promise.all([
      this.prisma.client.liquidacion.findMany({
        where,
        include: {
          contract: {
            include: { property: true },
          },
          lineItems: { orderBy: { sortOrder: 'asc' } },
          _count: { select: { payments: true } },
        },
        orderBy: { period: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.client.liquidacion.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Generate PDF for a specific liquidacion, with ownership check.
   * Verifies the liquidacion belongs to one of the inquilino's contracts
   * before delegating to LiquidacionesService.generatePdf.
   */
  async getLiquidacionPdf(liquidacionId: string): Promise<Buffer> {
    const personId = this.tenantContext.getPersonId();
    if (!personId) {
      throw new ForbiddenException({
        error: 'PORTAL_NO_PERSON',
        message: 'No person context found for portal request',
      });
    }

    // Verify ownership: liquidacion must belong to a contract
    // where this person is an Inquilino
    const liquidacion = await this.prisma.client.liquidacion.findFirst({
      where: { id: liquidacionId },
      select: { id: true, contractId: true },
    });

    if (!liquidacion) {
      throw new NotFoundException({
        error: 'LIQUIDACION_NOT_FOUND',
        message: 'Liquidación not found',
      });
    }

    const ownership = await this.prisma.client.contractPerson.findFirst({
      where: {
        contractId: liquidacion.contractId,
        personId,
        role: 'Inquilino',
      },
    });

    if (!ownership) {
      throw new ForbiddenException({
        error: 'PORTAL_ACCESS_DENIED',
        message: 'You do not have access to this liquidación',
      });
    }

    this.logger.log(
      `Portal PDF download: personId=${personId}, liquidacionId=${liquidacionId}`,
    );

    return this.liquidacionesService.generatePdf(liquidacionId);
  }
}
