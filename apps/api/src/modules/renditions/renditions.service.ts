import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateCommissionSchema,
  RendicionFilterSchema,
  monthStartUTC,
  periodFilter,
  todayInAR,
} from '@realfy/shared';
import { RenditionPdfService } from './rendition-pdf.service';
import { parseOrThrow } from '../../common/validation/zod';

/**
 * Rendiciones históricas (solo lectura): la cuenta corriente del locador y su
 * estado de cuenta las reemplazan (ADR-0009). Quedan la lista, el detalle y el
 * PDF de las que ya existían, y la configuración de la comisión del contrato.
 */
@Injectable()
export class RenditionsService {
  private readonly logger = new Logger(RenditionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly pdfService: RenditionPdfService,
  ) {}

  // ─── Commission CRUD ────────────────────────────────

  async createCommission(contractId: string, data: unknown) {
    const validated: any = parseOrThrow(CreateCommissionSchema, data, 'Invalid commission data');

    const tenantId = this.tenantContext.getTenantId()!;

    // Verify contract exists and belongs to this tenant
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId, tenantId },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    const commission = await this.prisma.client.contractCommission.upsert({
      where: { contractId },
      create: {
        tenantId,
        contractId,
        type: validated.type,
        percentage: validated.percentage ?? null,
        fixedAmount: validated.fixedAmount ?? null,
        adminFee: validated.adminFee ?? null,
        repairMgmtFeePct: validated.repairMgmtFeePct ?? null,
        currency: validated.currency ?? contract.rentCurrency,
        notes: validated.notes ?? null,
      },
      update: {
        type: validated.type,
        percentage: validated.percentage ?? null,
        fixedAmount: validated.fixedAmount ?? null,
        adminFee: validated.adminFee ?? null,
        repairMgmtFeePct: validated.repairMgmtFeePct ?? null,
        currency: validated.currency ?? contract.rentCurrency,
        notes: validated.notes ?? null,
      },
    });

    this.logger.log('Commission configured', {
      tenantId,
      contractId,
      commissionId: commission.id,
      type: validated.type,
    });

    return commission;
  }

  async getCommission(contractId: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const commission = await this.prisma.client.contractCommission.findFirst({
      where: { contractId, tenantId },
    });

    return commission ?? null;
  }

  async deleteCommission(contractId: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const commission = await this.prisma.client.contractCommission.findFirst({
      where: { contractId, tenantId },
    });

    if (!commission) {
      throw new NotFoundException({
        error: 'COMMISSION_NOT_FOUND',
        message: 'Commission configuration not found for this contract',
      });
    }

    await this.prisma.client.contractCommission.delete({
      where: { id: commission.id },
    });

    this.logger.log('Commission deleted', {
      tenantId,
      contractId,
      commissionId: commission.id,
    });

    return { deleted: true, contractId };
  }

  // ─── Rendition CRUD ─────────────────────────────────

  async findAll(query: unknown) {
    const filters: any = parseOrThrow(RendicionFilterSchema, query, 'Invalid filter parameters');

    const tenantId = this.tenantContext.getTenantId()!;
    const where: any = { tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.ownerId) where.ownerId = filters.ownerId;
    if (filters.month && filters.year) {
      where.period = monthStartUTC(filters.year, filters.month);
    } else if (filters.year) {
      where.period = periodFilter(filters.year);
    } else if (filters.month) {
      const currentYear = todayInAR().getUTCFullYear();
      where.period = monthStartUTC(currentYear, filters.month);
    }

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.ownerRendicion.findMany({
        where,
        include: {
          contract: { include: { property: true } },
          owner: true,
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.ownerRendicion.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async findOne(id: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const rendicion = await this.prisma.client.ownerRendicion.findFirst({
      where: { id, tenantId },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        contract: {
          include: {
            property: true,
            persons: { include: { person: true } },
          },
        },
        owner: true,
      },
    });

    if (!rendicion) {
      throw new NotFoundException({
        error: 'RENDICION_NOT_FOUND',
        message: 'Rendición not found',
      });
    }

    return rendicion;
  }

  // ─── PDF Generation ─────────────────────────────────

  async generatePdf(id: string): Promise<Buffer> {
    const rendicion = await this.findOne(id);
    const tenantId = this.tenantContext.getTenantId()!;

    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });

    const pdfBuffer = await this.pdfService.generateRenditionPdf(rendicion, {
      name: tenant?.name ?? 'Inmobiliaria',
      cuit: (tenant as any)?.cuit ?? null,
    });

    this.logger.log('Rendition PDF generated', {
      rendicionId: id,
      tenantId,
    });

    return pdfBuffer;
  }
}
