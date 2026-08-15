import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { FiscalCondition } from '@realfy/shared';
import type {
  IssuerCreateDto,
  IssuerUpdateDto,
  PuntoDeVentaCreateDto,
} from '@realfy/shared';

// ─── CUIT checksum validation ─────────────────────────────────────────────────

/**
 * Validate CUIT/CUIL digit checksum per AFIP spec.
 * Accepts formats: "20301234564" or "20-30123456-4".
 */
function validateCuitChecksum(cuit: string): boolean {
  const digits = cuit.replace(/-/g, '');
  if (!/^\d{11}$/.test(digits)) return false;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  const remainder = sum % 11;
  const check = remainder < 2 ? remainder : 11 - remainder;
  return check === parseInt(digits[10], 10);
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class IssuersService {
  private readonly logger = new Logger(IssuersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Issuers ──────────────────────────────────────────────────────────────

  async listIssuers() {
    const tenantId = this.tenantContext.getTenantId()!;

    return this.prisma.client.arcaIssuer.findMany({
      where: { tenantId, isActive: true },
      include: { puntosDeVenta: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createIssuer(data: IssuerCreateDto) {
    const tenantId = this.tenantContext.getTenantId()!;

    // Validate CUIT checksum
    if (!validateCuitChecksum(data.cuit)) {
      throw new BadRequestException({
        error: 'INVALID_CUIT',
        message: `CUIT ${data.cuit} failed checksum validation`,
      });
    }

    // Unique CUIT per tenant
    const existing = await this.prisma.client.arcaIssuer.findFirst({
      where: { tenantId, cuit: data.cuit },
    });
    if (existing) {
      throw new ConflictException({
        error: 'ISSUER_CUIT_DUPLICATE',
        message: `An issuer with CUIT ${data.cuit} already exists for this tenant`,
      });
    }

    // Auto-flag isSelf if CUIT matches tenant.cuit
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });
    const isSelf = tenant ? (tenant as any).cuit === data.cuit : false;

    const issuer = await this.prisma.client.arcaIssuer.create({
      data: {
        tenantId,
        cuit: data.cuit,
        businessName: data.businessName,
        fiscalCondition: data.fiscalCondition as FiscalCondition,
        ingresosBrutos: data.ingresosBrutos ?? null,
        activityStartDate: data.activityStartDate ?? null,
        businessAddress: data.businessAddress ?? null,
        isSelf,
      },
      include: { puntosDeVenta: true },
    });

    this.logger.log('ArcaIssuer created', { tenantId, issuerId: issuer.id, cuit: issuer.cuit, isSelf });

    return issuer;
  }

  async updateIssuer(id: string, data: IssuerUpdateDto) {
    const tenantId = this.tenantContext.getTenantId()!;

    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id, tenantId },
    });
    if (!issuer) {
      throw new NotFoundException({ error: 'ISSUER_NOT_FOUND', message: `Issuer ${id} not found` });
    }

    return this.prisma.client.arcaIssuer.update({
      where: { id },
      data: {
        ...(data.cuit !== undefined ? { cuit: data.cuit } : {}),
        ...(data.businessName !== undefined ? { businessName: data.businessName } : {}),
        ...(data.fiscalCondition !== undefined ? { fiscalCondition: data.fiscalCondition as FiscalCondition } : {}),
        ...(data.ingresosBrutos !== undefined ? { ingresosBrutos: data.ingresosBrutos } : {}),
        ...(data.activityStartDate !== undefined ? { activityStartDate: data.activityStartDate } : {}),
        ...(data.businessAddress !== undefined ? { businessAddress: data.businessAddress } : {}),
      },
      include: { puntosDeVenta: true },
    });
  }

  async deleteIssuer(id: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id, tenantId },
    });
    if (!issuer) {
      throw new NotFoundException({ error: 'ISSUER_NOT_FOUND', message: `Issuer ${id} not found` });
    }

    // Block soft-delete if comprobantes exist
    const comprobanteCount = await this.prisma.client.comprobante.count({
      where: { issuerId: id },
    });
    if (comprobanteCount > 0) {
      throw new BadRequestException({
        error: 'ISSUER_HAS_COMPROBANTES',
        message: `Cannot delete issuer ${id}: ${comprobanteCount} comprobantes reference it`,
      });
    }

    return this.prisma.client.arcaIssuer.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─── Puntos de Venta ─────────────────────────────────────────────────────

  async listPdv(issuerId: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id: issuerId, tenantId },
    });
    if (!issuer) {
      throw new NotFoundException({ error: 'ISSUER_NOT_FOUND', message: `Issuer ${issuerId} not found` });
    }

    return this.prisma.client.arcaPuntoDeVenta.findMany({
      where: { issuerId, tenantId },
      orderBy: { number: 'asc' },
    });
  }

  async createPdv(issuerId: string, data: PuntoDeVentaCreateDto) {
    const tenantId = this.tenantContext.getTenantId()!;

    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id: issuerId, tenantId },
    });
    if (!issuer) {
      throw new NotFoundException({ error: 'ISSUER_NOT_FOUND', message: `Issuer ${issuerId} not found` });
    }

    return this.prisma.client.arcaPuntoDeVenta.upsert({
      where: { issuerId_number: { issuerId, number: data.number } },
      create: {
        tenantId,
        issuerId,
        number: data.number,
        nombre: data.nombre ?? null,
        tipo: data.tipo ?? null,
      },
      update: {
        nombre: data.nombre ?? null,
        tipo: data.tipo ?? null,
      },
    });
  }

  async deletePdv(pdvId: string) {
    const tenantId = this.tenantContext.getTenantId()!;

    const pdv = await this.prisma.client.arcaPuntoDeVenta.findFirst({
      where: { id: pdvId, tenantId },
    });
    if (!pdv) {
      throw new NotFoundException({ error: 'PDV_NOT_FOUND', message: `PuntoDeVenta ${pdvId} not found` });
    }

    return this.prisma.client.arcaPuntoDeVenta.delete({ where: { id: pdvId } });
  }
}
