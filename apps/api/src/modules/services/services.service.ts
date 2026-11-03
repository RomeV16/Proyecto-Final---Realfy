import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreateServiceSchema,
  UpdateServiceSchema,
  ServiceFilterSchema,
  CreateServicePaymentSchema,
} from '@realfy/shared';
import { parseOrThrow } from '../../common/validation/zod';
import { resolveProviderFields } from '../bills-intake/providers/provider-account';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── List ───────────────────────────────────────────

  async findAll(query: unknown) {
    const filters: any = parseOrThrow(ServiceFilterSchema, query, 'Invalid filter parameters');

    const where: any = {};

    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.serviceType) where.serviceType = filters.serviceType;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.service.findMany({
        where,
        include: {
          property: { select: { id: true, title: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.service.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ─────────────────────────────────────────

  async findOne(id: string) {
    const service = await this.prisma.client.service.findFirst({
      where: { id },
      include: {
        property: { select: { id: true, title: true } },
        payments: { orderBy: { paymentDate: 'desc' } },
      },
    });

    if (!service) {
      throw new NotFoundException({
        error: 'SERVICE_NOT_FOUND',
        message: 'Service not found',
      });
    }

    return service;
  }

  // ─── Create ─────────────────────────────────────────

  async create(data: unknown) {
    const validated: any = parseOrThrow(CreateServiceSchema, data, 'Invalid service data');

    const tenantId = this.tenantContext.getTenantId()!;

    // Verify property exists in tenant
    const property = await this.prisma.client.property.findFirst({
      where: { id: validated.propertyId },
    });

    if (!property) {
      throw new NotFoundException({
        error: 'PROPERTY_NOT_FOUND',
        message: 'Property not found',
      });
    }

    const service = await this.prisma.client.service.create({
      data: {
        ...validated,
        ...this.providerFields(validated),
        tenantId,
      },
      include: {
        property: { select: { id: true, title: true } },
      },
    });

    this.logger.log(
      `Service created: serviceId=${service.id} type=${service.serviceType} propertyId=${validated.propertyId} tenantId=${tenantId}`,
    );

    return service;
  }

  // ─── Update ─────────────────────────────────────────

  async update(id: string, data: unknown) {
    const validated: any = parseOrThrow(UpdateServiceSchema, data, 'Invalid service data');

    const existing = await this.prisma.client.service.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'SERVICE_NOT_FOUND',
        message: 'Service not found',
      });
    }

    const updated = await this.prisma.client.service.update({
      where: { id },
      data: { ...validated, ...this.providerFields(validated, existing) },
      include: {
        property: { select: { id: true, title: true } },
      },
    });

    this.logger.log(
      `Service updated: serviceId=${id} propertyId=${existing.propertyId} tenantId=${existing.tenantId}`,
    );

    return updated;
  }

  /**
   * Con proveedor del catálogo (ADR-0018) el identificador de cuenta se guarda
   * normalizado, que es con lo que el circuito de boletas busca el servicio. Si cambia
   * el proveedor o la cuenta, se valida con lo que ya había en el otro campo.
   */
  private providerFields(
    input: { providerKey?: string | null; accountNumber?: string | null; serviceType?: string },
    current?: { providerKey: string | null; accountNumber: string | null; serviceType: string },
  ): { accountNumber?: string | null } {
    const result = resolveProviderFields(input, current);
    if (!result.ok) throw new BadRequestException({ error: result.code, message: result.message });
    return result.accountNumber === undefined ? {} : { accountNumber: result.accountNumber };
  }

  // ─── Soft Delete ────────────────────────────────────

  async softDelete(id: string) {
    const existing = await this.prisma.client.service.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'SERVICE_NOT_FOUND',
        message: 'Service not found',
      });
    }

    const deleted = await this.prisma.client.service.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(
      `Service soft-deleted: serviceId=${id} propertyId=${existing.propertyId} tenantId=${existing.tenantId}`,
    );

    return deleted;
  }

  // ─── Register Payment ──────────────────────────────

  async registerPayment(serviceId: string, data: unknown) {
    const validated: any = parseOrThrow(CreateServicePaymentSchema, data, 'Invalid payment data');

    // Check service exists
    const service = await this.prisma.client.service.findFirst({
      where: { id: serviceId },
    });

    if (!service) {
      throw new NotFoundException({
        error: 'SERVICE_NOT_FOUND',
        message: 'Service not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;

    const payment = await this.prisma.client.servicePayment.create({
      data: {
        serviceId,
        tenantId,
        amount: validated.amount,
        paymentDate: new Date(validated.paymentDate),
        period: new Date(validated.period),
        notes: validated.notes,
      },
    });

    this.logger.log(
      `Service payment registered: paymentId=${payment.id} serviceId=${serviceId} amount=${validated.amount} tenantId=${tenantId}`,
    );

    return payment;
  }
}
