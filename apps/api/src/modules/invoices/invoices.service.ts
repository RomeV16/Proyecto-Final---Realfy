import {
  Injectable,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  ComprobanteFilterSchema,
  ComprobanteType,
  ComprobanteStatus,
  FiscalCondition,
} from '@realfy/shared';
import { ArcaService } from './arca/arca.service';
import type { ArcaEmitPayload } from './arca/arca.service';
import type {
  EmitInvoiceDto,
  EmitNotaCreditoDto,
} from '@realfy/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

function mapCbteTipoToEnum(cbteTipo: number): ComprobanteType {
  const map: Record<number, ComprobanteType> = {
    1: ComprobanteType.FacturaA,
    2: ComprobanteType.NotaDebitoA,
    3: ComprobanteType.NotaCreditoA,
    6: ComprobanteType.FacturaB,
    7: ComprobanteType.NotaDebitoB,
    8: ComprobanteType.NotaCreditoB,
    11: ComprobanteType.FacturaC,
    12: ComprobanteType.NotaDebitoC,
    13: ComprobanteType.NotaCreditoC,
  };
  return map[cbteTipo] ?? ComprobanteType.FacturaB;
}

// ─── Preview result ───────────────────────────────────────────────────────────

export interface PreviewEmitResult {
  nextNumero: number;
  payload: ArcaEmitPayload;
  warnings: string[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly arcaService: ArcaService,
  ) {}

  // ─── Resolve issuer and punto de venta ────────────────────────────────────

  /**
   * Resolve the ArcaIssuer to use for emission.
   * If `issuerId` is provided, use it. Otherwise, find the self-issuer for the tenant.
   */
  private async resolveIssuerContext(tenantId: string, issuerId?: string) {
    if (issuerId) {
      const issuer = await this.prisma.client.arcaIssuer.findFirst({
        where: { id: issuerId, tenantId },
      });
      if (!issuer) {
        throw new NotFoundException({ error: 'ISSUER_NOT_FOUND', message: `ArcaIssuer ${issuerId} not found` });
      }
      return issuer;
    }

    // Fall back to self-issuer
    const selfIssuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { tenantId, isSelf: true, isActive: true },
    });

    if (selfIssuer) return selfIssuer;

    throw new BadRequestException({
      error: 'ARCA_NOT_CONFIGURED',
      message: 'No ArcaIssuer configured for this tenant. Create an issuer or pass issuerId.',
    });
  }

  /**
   * Resolve the punto de venta: explicit param → first active PdV for issuer.
   */
  private async resolvePuntoDeVenta(issuerId: string, explicit?: number): Promise<number> {
    if (explicit !== undefined) return explicit;

    const pdv = await this.prisma.client.arcaPuntoDeVenta.findFirst({
      where: { issuerId, bloqueado: false },
      orderBy: { number: 'asc' },
    });

    if (!pdv) {
      throw new BadRequestException({
        error: 'NO_PUNTO_DE_VENTA',
        message: 'No PuntoDeVenta configured for this issuer. Run syncPuntosDeVenta first.',
      });
    }
    return pdv.number;
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async findAll(query: unknown) {
    let filters: any;
    try {
      filters = ComprobanteFilterSchema.parse(query);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid filter parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const where: any = {};
    if (filters.paymentId) where.paymentId = filters.paymentId;
    if (filters.type) where.type = filters.type;

    const skip = (filters.page - 1) * filters.limit;

    const [items, total] = await Promise.all([
      this.prisma.client.comprobante.findMany({
        where,
        include: { payment: true, originalComprobante: true, creditNotes: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: filters.limit,
      }),
      this.prisma.client.comprobante.count({ where }),
    ]);

    return {
      items,
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  // ─── Detail ───────────────────────────────────────────────────────────────

  async findOne(id: string) {
    const comprobante = await this.prisma.client.comprobante.findFirst({
      where: { id },
      include: { payment: true, originalComprobante: true, creditNotes: true },
    });

    if (!comprobante) {
      throw new NotFoundException({ error: 'COMPROBANTE_NOT_FOUND', message: 'Comprobante not found' });
    }

    return comprobante;
  }

  // ─── previewEmitFromDto ───────────────────────────────────────────────────

  /**
   * Build the WSFE payload and get next numero from the EmitInvoiceDto.
   * No AFIP round-trip for CAE.
   */
  async previewEmitFromDto(dto: EmitInvoiceDto): Promise<PreviewEmitResult> {
    const tenantId = this.tenantContext.getTenantId()!;
    const warnings: string[] = [];

    const issuer = await this.resolveIssuerContext(tenantId, dto.issuerId);
    if (issuer.delegationStatus === 'Pending') {
      warnings.push('Issuer delegation is Pending — emission may fail');
    }

    const puntoDeVenta = await this.resolvePuntoDeVenta(issuer.id, dto.ptoVta);
    const nextNumero = await this.arcaService
      .getLastVoucher(tenantId, issuer.id, puntoDeVenta, dto.cbteTipo)
      .then((n) => n + 1);

    const ivaArray = (dto.iva ?? []).map((i) => ({
      Id: i.id,
      BaseImp: parseFloat(i.baseImp),
      Importe: parseFloat(i.importe),
    }));

    const payload: ArcaEmitPayload = {
      puntoDeVenta,
      cbteTipo: dto.cbteTipo,
      letra: this.resolveletra(dto.cbteTipo),
      amount: dto.impTotal,
      ivaRate: 21,
      concepto: dto.concepto,
      docTipo: dto.receptor.docTipo,
      docNro: dto.receptor.docNro,
      receptorFiscalCondition: dto.receptor.fiscalCondition,
      condicionIVAReceptorId: dto.receptor.condicionIVAReceptorId,
      description: dto.description,
      monId: dto.monId,
      monCotiz: parseFloat(dto.monCotiz),
      ivaArray: ivaArray.length > 0 ? ivaArray : undefined,
      cbtesAsoc: dto.cbtesAsoc?.map((c) => ({ tipo: c.tipo, ptoVta: c.ptoVta, nro: c.nro })),
    };

    if (dto.concepto !== 1 && dto.fchServDesde && dto.fchServHasta && dto.fchVtoPago) {
      payload.fchServDesde = new Date(dto.fchServDesde);
      payload.fchServHasta = new Date(dto.fchServHasta);
      payload.fchVtoPago = new Date(dto.fchVtoPago);
    }

    return { nextNumero, payload, warnings };
  }

  // ─── emitFromDto ──────────────────────────────────────────────────────────

  /**
   * Emit from an EmitInvoiceDto. Returns { comprobante, isIdempotentReplay }.
   */
  async emitFromDto(dto: EmitInvoiceDto): Promise<{ comprobante: any; isIdempotentReplay: boolean }> {
    const tenantId = this.tenantContext.getTenantId()!;

    // Idempotency
    if (dto.clientRequestId) {
      const existing = await this.prisma.client.comprobante.findFirst({
        where: { tenantId, clientRequestId: dto.clientRequestId },
        include: { payment: true, originalComprobante: true, creditNotes: true },
      });
      if (existing) return { comprobante: existing, isIdempotentReplay: true };
    }

    const issuer = await this.resolveIssuerContext(tenantId, dto.issuerId);
    const puntoDeVenta = await this.resolvePuntoDeVenta(issuer.id, dto.ptoVta);

    const ivaArray = (dto.iva ?? []).map((i) => ({
      Id: i.id,
      BaseImp: parseFloat(i.baseImp),
      Importe: parseFloat(i.importe),
    }));

    const emitPayload: ArcaEmitPayload = {
      puntoDeVenta,
      cbteTipo: dto.cbteTipo,
      letra: this.resolveletra(dto.cbteTipo),
      amount: dto.impTotal,
      ivaRate: 21,
      concepto: dto.concepto,
      docTipo: dto.receptor.docTipo,
      docNro: dto.receptor.docNro,
      receptorFiscalCondition: dto.receptor.fiscalCondition,
      condicionIVAReceptorId: dto.receptor.condicionIVAReceptorId,
      description: dto.description,
      monId: dto.monId,
      monCotiz: parseFloat(dto.monCotiz),
      ivaArray: ivaArray.length > 0 ? ivaArray : undefined,
      cbtesAsoc: dto.cbtesAsoc?.map((c) => ({ tipo: c.tipo, ptoVta: c.ptoVta, nro: c.nro })),
    };

    if (dto.concepto !== 1 && dto.fchServDesde && dto.fchServHasta && dto.fchVtoPago) {
      emitPayload.fchServDesde = new Date(dto.fchServDesde);
      emitPayload.fchServHasta = new Date(dto.fchServHasta);
      emitPayload.fchVtoPago = new Date(dto.fchVtoPago);
    }

    let result: any;
    try {
      result = await this.arcaService.emit(tenantId, issuer.id, emitPayload);
    } catch (err: any) {
      const afipCode = err?.code ?? err?.errorCode ?? 'AFIP_UNKNOWN';
      throw new UnprocessableEntityException({
        errorCode: afipCode,
        message: err?.message ?? 'AFIP emission failed',
        detail: err?.detail ?? null,
      });
    }

    const comprobanteData: any = {
      tenantId,
      issuerId: issuer.id,
      paymentId: dto.paymentId ?? null,
      clientRequestId: dto.clientRequestId ?? null,
      type: mapCbteTipoToEnum(dto.cbteTipo),
      status: ComprobanteStatus.Emitido,
      cbteTipo: dto.cbteTipo,
      puntoDeVenta,
      numero: result.numero,
      concepto: dto.concepto,
      docTipo: dto.receptor.docTipo,
      docNro: dto.receptor.docNro,
      receptorName: dto.receptor.businessName,
      receptorFiscalCondition: dto.receptor.fiscalCondition,
      condicionIVAReceptorId: dto.receptor.condicionIVAReceptorId,
      impTotal: dto.impTotal,
      impNeto: dto.impNeto,
      impIva: dto.impIVA,
      impExento: '0.00',
      impTotConc: dto.impTotConc ?? '0',
      impOpEx: dto.impOpEx ?? '0',
      impTrib: dto.impTrib ?? '0',
      monId: dto.monId ?? 'PES',
      monCotiz: parseFloat(dto.monCotiz ?? '1'),
      currency: 'ARS',
      cae: result.cae,
      caeFchVto: new Date(result.caeFchVto),
      emittedAt: new Date(),
      ivaArray: emitPayload.ivaArray ?? null,
      cbtesAsoc: dto.cbtesAsoc ?? null,
    };
    const comprobante = await this.prisma.client.comprobante.create({ data: comprobanteData });

    return { comprobante, isIdempotentReplay: false };
  }

  // ─── emitNotaCreditoFromDto ───────────────────────────────────────────────

  async emitNotaCreditoFromDto(dto: EmitNotaCreditoDto): Promise<{ comprobante: any; isIdempotentReplay: boolean }> {
    const tenantId = this.tenantContext.getTenantId()!;

    if (dto.clientRequestId) {
      const existing = await this.prisma.client.comprobante.findFirst({
        where: { tenantId, clientRequestId: dto.clientRequestId },
        include: { payment: true, originalComprobante: true, creditNotes: true },
      });
      if (existing) return { comprobante: existing, isIdempotentReplay: true };
    }

    const issuer = await this.resolveIssuerContext(tenantId, dto.issuerId);
    const puntoDeVenta = await this.resolvePuntoDeVenta(issuer.id, dto.ptoVta);

    const ivaArray = (dto.iva ?? []).map((i) => ({
      Id: i.id,
      BaseImp: parseFloat(i.baseImp),
      Importe: parseFloat(i.importe),
    }));

    const emitPayload: ArcaEmitPayload = {
      puntoDeVenta,
      cbteTipo: dto.cbteTipo,
      letra: this.resolveletra(dto.cbteTipo),
      amount: dto.impTotal,
      ivaRate: 21,
      concepto: dto.concepto,
      docTipo: dto.receptor.docTipo,
      docNro: dto.receptor.docNro,
      receptorFiscalCondition: dto.receptor.fiscalCondition,
      condicionIVAReceptorId: dto.receptor.condicionIVAReceptorId,
      description: dto.description,
      monId: dto.monId,
      monCotiz: parseFloat(dto.monCotiz),
      ivaArray: ivaArray.length > 0 ? ivaArray : undefined,
      cbtesAsoc: dto.cbtesAsoc.map((c) => ({ tipo: c.tipo, ptoVta: c.ptoVta, nro: c.nro })),
    };

    if (dto.concepto !== 1 && dto.fchServDesde && dto.fchServHasta && dto.fchVtoPago) {
      emitPayload.fchServDesde = new Date(dto.fchServDesde);
      emitPayload.fchServHasta = new Date(dto.fchServHasta);
      emitPayload.fchVtoPago = new Date(dto.fchVtoPago);
    }

    let result: any;
    try {
      result = await this.arcaService.emitNotaCredito(tenantId, issuer.id, emitPayload);
    } catch (err: any) {
      const afipCode = err?.code ?? err?.errorCode ?? 'AFIP_UNKNOWN';
      throw new UnprocessableEntityException({
        errorCode: afipCode,
        message: err?.message ?? 'AFIP NC emission failed',
        detail: err?.detail ?? null,
      });
    }

    const ncData: any = {
      tenantId,
      issuerId: issuer.id,
      paymentId: dto.paymentId ?? null,
      clientRequestId: dto.clientRequestId ?? null,
      type: mapCbteTipoToEnum(dto.cbteTipo),
      status: ComprobanteStatus.Emitido,
      cbteTipo: dto.cbteTipo,
      puntoDeVenta,
      numero: result.numero,
      concepto: dto.concepto,
      docTipo: dto.receptor.docTipo,
      docNro: dto.receptor.docNro,
      receptorName: dto.receptor.businessName,
      receptorFiscalCondition: dto.receptor.fiscalCondition,
      condicionIVAReceptorId: dto.receptor.condicionIVAReceptorId,
      impTotal: dto.impTotal,
      impNeto: dto.impNeto,
      impIva: dto.impIVA,
      impExento: '0.00',
      impTotConc: dto.impTotConc ?? '0',
      impOpEx: dto.impOpEx ?? '0',
      impTrib: dto.impTrib ?? '0',
      monId: dto.monId ?? 'PES',
      monCotiz: parseFloat(dto.monCotiz ?? '1'),
      currency: 'ARS',
      cae: result.cae,
      caeFchVto: new Date(result.caeFchVto),
      emittedAt: new Date(),
      ivaArray: emitPayload.ivaArray ?? null,
      cbtesAsoc: dto.cbtesAsoc,
    };
    const comprobante = await this.prisma.client.comprobante.create({ data: ncData });

    return { comprobante, isIdempotentReplay: false };
  }

  // ─── voidComprobante ──────────────────────────────────────────────────────

  /**
   * Void a comprobante by emitting a nota de crédito for its full amount.
   */
  async voidComprobante(id: string, options: Record<string, any> = {}) {
    const tenantId = this.tenantContext.getTenantId()!;

    const original = await this.prisma.client.comprobante.findFirst({
      where: { id, tenantId },
    });

    if (!original) {
      throw new NotFoundException({ error: 'COMPROBANTE_NOT_FOUND', message: `Comprobante ${id} not found` });
    }

    const ncCbteTipo = this.resolveNcTipo(original.cbteTipo);
    const clientRequestId = options.clientRequestId ?? undefined;

    const dto: EmitNotaCreditoDto = {
      issuerId: original.issuerId!,
      ptoVta: original.puntoDeVenta,
      cbteTipo: ncCbteTipo,
      concepto: original.concepto as 1 | 2 | 3,
      cbteFch: new Date().toISOString().split('T')[0],
      receptor: {
        docTipo: original.docTipo,
        docNro: original.docNro,
        businessName: original.receptorName ?? '',
        fiscalCondition: original.receptorFiscalCondition as FiscalCondition,
        condicionIVAReceptorId: original.condicionIVAReceptorId ?? 5,
      },
      impTotal: original.impTotal.toString(),
      impNeto: original.impNeto.toString(),
      impTotConc: (original.impTotConc ?? '0').toString(),
      impOpEx: (original.impOpEx ?? '0').toString(),
      impTrib: (original.impTrib ?? '0').toString(),
      impIVA: (original.impIva ?? '0').toString(),
      monId: original.monId ?? 'PES',
      monCotiz: (original.monCotiz ?? 1).toString(),
      cbtesAsoc: [{ tipo: original.cbteTipo, ptoVta: original.puntoDeVenta, nro: original.numero }],
      clientRequestId,
      ...(original.concepto !== 1
        ? {
            fchServDesde: original.fchServDesde
              ? original.fchServDesde.toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
            fchServHasta: original.fchServHasta
              ? original.fchServHasta.toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
            fchVtoPago: original.fchVtoPago
              ? original.fchVtoPago.toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
          }
        : {}),
    };

    const { comprobante } = await this.emitNotaCreditoFromDto(dto);

    // Link originalComprobanteId
    await this.prisma.client.comprobante.update({
      where: { id: comprobante.id },
      data: { originalComprobanteId: original.id },
    });

    return comprobante;
  }

  // ─── findOneWithLogs ──────────────────────────────────────────────────────

  async findOneWithLogs(id: string) {
    const comprobante = await this.prisma.client.comprobante.findFirst({
      where: { id },
      include: { payment: true, originalComprobante: true, creditNotes: true },
    });

    if (!comprobante) {
      throw new NotFoundException({ error: 'COMPROBANTE_NOT_FOUND', message: 'Comprobante not found' });
    }

    // Tail of request logs
    const logs = await this.prisma.client.arcaRequestLog.findMany({
      where: { tenantId: comprobante.tenantId, comprobanteId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { ...comprobante, arcaRequestLogs: logs };
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private resolveletra(cbteTipo: number): any {
    const A_TIPOS = [1, 2, 3];
    const B_TIPOS = [6, 7, 8];
    const C_TIPOS = [11, 12, 13];
    if (A_TIPOS.includes(cbteTipo)) return 'A';
    if (B_TIPOS.includes(cbteTipo)) return 'B';
    if (C_TIPOS.includes(cbteTipo)) return 'C';
    return 'B';
  }

  private resolveNcTipo(cbteTipo: number): number {
    const ncMap: Record<number, number> = {
      1: 3,   // Factura A → NC A
      6: 8,   // Factura B → NC B
      11: 13, // Factura C → NC C
    };
    return ncMap[cbteTipo] ?? 8;
  }

}
