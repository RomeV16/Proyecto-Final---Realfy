import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  EmitComprobanteSchema,
  EmitNotaCreditoSchema,
  ComprobanteFilterSchema,
  ComprobanteType,
  ComprobanteStatus,
  FiscalCondition,
  PersonRole,
  resolveComprobanteType,
} from '@realfy/shared';
import type { ComprobanteResolution } from '@realfy/shared';
import { ArcaService } from './arca/arca.service';
import type { ArcaEmitPayload } from './arca/arca.service';
import type {
  EmitInvoiceDto,
  EmitNotaCreditoDto,
} from '@realfy/shared';
import Decimal from 'decimal.js';

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

function resolveDocTipo(fc: FiscalCondition): number {
  switch (fc) {
    case FiscalCondition.ResponsableInscripto:
    case FiscalCondition.Monotributista:
    case FiscalCondition.Exento:
      return 80;
    case FiscalCondition.ConsumidorFinal:
      return 99;
    case FiscalCondition.NoResponsable:
      return 96;
    default:
      return 99;
  }
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

/**
 * Compute IVA breakdown (Decimal arithmetic, no Number() coercion).
 */
function computeIva(
  letra: string,
  amount: Decimal,
  ivaRate: Decimal,
): { impNeto: Decimal; impIva: Decimal; ivaArray: Array<{ Id: number; BaseImp: number; Importe: number }> | undefined } {
  if (letra === 'C') {
    return {
      impNeto: amount,
      impIva: new Decimal(0),
      ivaArray: undefined,
    };
  }

  const ivaRateToId: Record<number, number> = {
    0: 3,
    2.5: 9,
    5: 8,
    10.5: 4,
    21: 5,
    27: 6,
  };

  const impNeto = amount.div(ivaRate.div(100).plus(1)).toDecimalPlaces(2);
  const impIva = amount.minus(impNeto).toDecimalPlaces(2);
  const ivaId = ivaRateToId[ivaRate.toNumber()] ?? 5;

  return {
    impNeto,
    impIva,
    ivaArray: [{ Id: ivaId, BaseImp: impNeto.toNumber(), Importe: impIva.toNumber() }],
  };
}

// ─── Extended emit input (superset of the Zod schema) ────────────────────────

export interface EmitComprobanteInput {
  paymentId: string;
  issuerId?: string;
  clientRequestId?: string;
  amount: string;
  description: string;
  ivaRate: number;
  concepto?: number;
  puntoDeVenta?: number;
  monId?: string;
  monCotiz?: number;
  fchServDesde?: Date;
  fchServHasta?: Date;
  fchVtoPago?: Date;
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
  private readonly logger = new Logger(InvoicesService.name);

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

  // ─── Emit Comprobante (Factura) ───────────────────────────────────────────

  async emitComprobante(data: unknown) {
    let validated: EmitComprobanteInput;
    try {
      validated = EmitComprobanteSchema.parse(data) as EmitComprobanteInput;
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid comprobante emission parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // ── Idempotency check ──────────────────────────────────────────────────
    if (validated.clientRequestId) {
      const existing = await this.prisma.client.comprobante.findFirst({
        where: { tenantId, clientRequestId: validated.clientRequestId },
        include: { payment: true, originalComprobante: true, creditNotes: true },
      });
      if (existing) {
        this.logger.log('Idempotent: returning existing comprobante', {
          tenantId,
          clientRequestId: validated.clientRequestId,
          comprobanteId: existing.id,
        });
        return existing;
      }
    }

    // ── Load payment ──────────────────────────────────────────────────────
    const payment = await this.prisma.client.payment.findFirst({
      where: { id: validated.paymentId },
      include: {
        liquidacion: {
          include: {
            contract: {
              include: {
                persons: { include: { person: true } },
              },
            },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException({ error: 'PAYMENT_NOT_FOUND', message: 'Payment not found' });
    }

    const contract = payment.liquidacion?.contract;
    if (!contract) {
      throw new BadRequestException({
        error: 'NO_CONTRACT',
        message: 'Payment has no associated contract via liquidación.',
      });
    }

    const inquilinoCP = (contract.persons ?? []).find(
      (cp: any) => cp.role === PersonRole.Inquilino,
    );
    if (!inquilinoCP?.person) {
      throw new BadRequestException({
        error: 'NO_INQUILINO',
        message: 'Contract has no Inquilino person assigned.',
      });
    }

    const receptor = inquilinoCP.person;
    const receptorFC = (receptor.fiscalCondition as FiscalCondition) ?? FiscalCondition.ConsumidorFinal;

    // ── Resolve issuer & PdV ──────────────────────────────────────────────
    const issuer = await this.resolveIssuerContext(tenantId, validated.issuerId);
    const puntoDeVenta = await this.resolvePuntoDeVenta(issuer.id, validated.puntoDeVenta);
    const emisorFC = issuer.fiscalCondition as FiscalCondition;

    let resolution: ComprobanteResolution;
    try {
      resolution = resolveComprobanteType(emisorFC, receptorFC);
    } catch (err: any) {
      throw new BadRequestException({ error: 'COMPROBANTE_RESOLUTION_ERROR', message: err.message });
    }

    // ── Compute amounts ───────────────────────────────────────────────────
    const amount = new Decimal(validated.amount);
    const ivaRate = new Decimal(validated.ivaRate);
    const { impNeto, impIva, ivaArray } = computeIva(resolution.letra, amount, ivaRate);

    const docTipo = resolveDocTipo(receptorFC);
    const docNro = docTipo === 99 ? '0' : (receptor.cuit ?? '0').replace(/-/g, '');

    // ── Build payload ─────────────────────────────────────────────────────
    const emitPayload: ArcaEmitPayload = {
      puntoDeVenta,
      cbteTipo: resolution.cbteTipo,
      letra: resolution.letra,
      amount: validated.amount,
      ivaRate: validated.ivaRate,
      concepto: validated.concepto ?? 2,
      docTipo,
      docNro,
      receptorFiscalCondition: receptorFC,
      monId: validated.monId,
      monCotiz: validated.monCotiz,
      fchServDesde: validated.fchServDesde,
      fchServHasta: validated.fchServHasta,
      fchVtoPago: validated.fchVtoPago,
      ivaArray,
    };

    // ── Call ARCA ─────────────────────────────────────────────────────────
    const result = await this.arcaService.emit(tenantId, issuer.id, emitPayload);

    // ── Persist Comprobante ───────────────────────────────────────────────
    const comprobante = await this.prisma.client.comprobante.create({
      data: {
        tenantId,
        paymentId: validated.paymentId,
        issuerId: issuer.id,
        clientRequestId: validated.clientRequestId ?? null,
        type: mapCbteTipoToEnum(resolution.cbteTipo),
        status: ComprobanteStatus.Emitido,
        cbteTipo: resolution.cbteTipo,
        puntoDeVenta,
        numero: result.numero,
        concepto: emitPayload.concepto,
        docTipo,
        docNro,
        receptorName: `${receptor.firstName} ${receptor.lastName}`,
        receptorFiscalCondition: receptorFC,
        condicionIVAReceptorId: FISCAL_CONDITION_TO_ARCA[receptorFC] ?? null,
        impTotal: amount.toFixed(2),
        impNeto: impNeto.toFixed(2),
        impIva: impIva.toFixed(2),
        impExento: '0.00',
        impTotConc: '0.00',
        impOpEx: '0.00',
        impTrib: '0.00',
        monId: validated.monId ?? 'PES',
        monCotiz: validated.monCotiz ?? 1,
        currency: payment.currency as any,
        cae: result.cae,
        caeFchVto: new Date(result.caeFchVto),
        emittedAt: new Date(),
        fchServDesde: validated.fchServDesde ?? null,
        fchServHasta: validated.fchServHasta ?? null,
        fchVtoPago: validated.fchVtoPago ?? null,
        ivaArray: ivaArray ? (ivaArray as any) : undefined,
      },
    });

    this.logger.log('Comprobante emitted', {
      tenantId,
      comprobanteId: comprobante.id,
      type: comprobante.type,
      issuerId: issuer.id,
      cae: result.cae,
    });

    return comprobante;
  }

  // ─── Emit Nota de Crédito ─────────────────────────────────────────────────

  async emitNotaCredito(data: unknown) {
    let validated: { comprobanteId: string; amount: string; description: string; issuerId?: string; clientRequestId?: string };
    try {
      validated = EmitNotaCreditoSchema.parse(data) as any;
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid nota de crédito parameters',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    // ── Idempotency check ──────────────────────────────────────────────────
    if (validated.clientRequestId) {
      const existing = await this.prisma.client.comprobante.findFirst({
        where: { tenantId, clientRequestId: validated.clientRequestId },
        include: { payment: true, originalComprobante: true, creditNotes: true },
      });
      if (existing) return existing;
    }

    // ── Load original comprobante ─────────────────────────────────────────
    const original = await this.prisma.client.comprobante.findFirst({
      where: { id: validated.comprobanteId },
      include: {
        payment: {
          include: {
            liquidacion: {
              include: {
                contract: { include: { persons: { include: { person: true } } } },
              },
            },
          },
        },
      },
    });

    if (!original) {
      throw new NotFoundException({ error: 'COMPROBANTE_NOT_FOUND', message: 'Original comprobante not found' });
    }

    // ── Resolve issuer ────────────────────────────────────────────────────
    const issuerId = validated.issuerId ?? original.issuerId ?? undefined;
    const issuer = await this.resolveIssuerContext(tenantId, issuerId);
    const puntoDeVenta = await this.resolvePuntoDeVenta(issuer.id, original.puntoDeVenta);
    const emisorFC = issuer.fiscalCondition as FiscalCondition;
    const receptorFC = original.receptorFiscalCondition as FiscalCondition;

    let resolution: ComprobanteResolution;
    try {
      resolution = resolveComprobanteType(emisorFC, receptorFC);
    } catch (err: any) {
      throw new BadRequestException({ error: 'COMPROBANTE_RESOLUTION_ERROR', message: err.message });
    }

    // ── Compute amounts ───────────────────────────────────────────────────
    const amount = new Decimal(validated.amount);
    const ivaRate = new Decimal(21);
    const { impNeto, impIva, ivaArray } = computeIva(resolution.letra, amount, ivaRate);

    // ── Build NC payload ──────────────────────────────────────────────────
    const emitPayload: ArcaEmitPayload = {
      puntoDeVenta,
      cbteTipo: resolution.ncTipo,
      letra: resolution.letra,
      amount: validated.amount,
      ivaRate: 21,
      concepto: 2,
      docTipo: original.docTipo,
      docNro: original.docNro,
      receptorFiscalCondition: receptorFC,
      ivaArray,
      cbtesAsoc: [
        { tipo: original.cbteTipo, ptoVta: original.puntoDeVenta, nro: original.numero },
      ],
    };

    const result = await this.arcaService.emitNotaCredito(tenantId, issuer.id, emitPayload);

    // ── Persist NC ────────────────────────────────────────────────────────
    const comprobante = await this.prisma.client.comprobante.create({
      data: {
        tenantId,
        paymentId: original.paymentId,
        issuerId: issuer.id,
        clientRequestId: validated.clientRequestId ?? null,
        type: mapCbteTipoToEnum(resolution.ncTipo),
        status: ComprobanteStatus.Emitido,
        cbteTipo: resolution.ncTipo,
        puntoDeVenta,
        numero: result.numero,
        concepto: 2,
        docTipo: original.docTipo,
        docNro: original.docNro,
        receptorName: original.receptorName,
        receptorFiscalCondition: receptorFC,
        condicionIVAReceptorId: FISCAL_CONDITION_TO_ARCA[receptorFC] ?? null,
        impTotal: amount.toFixed(2),
        impNeto: impNeto.toFixed(2),
        impIva: impIva.toFixed(2),
        impExento: '0.00',
        impTotConc: '0.00',
        impOpEx: '0.00',
        impTrib: '0.00',
        monId: 'PES',
        monCotiz: 1,
        currency: original.currency as any,
        cae: result.cae,
        caeFchVto: new Date(result.caeFchVto),
        emittedAt: new Date(),
        originalComprobanteId: original.id,
        cbtesAsoc: emitPayload.cbtesAsoc as any,
        ivaArray: ivaArray ? (ivaArray as any) : undefined,
      },
    });

    this.logger.log('Nota de Crédito emitted', {
      tenantId,
      comprobanteId: comprobante.id,
      originalComprobanteId: original.id,
      issuerId: issuer.id,
      cae: result.cae,
    });

    return comprobante;
  }

  // ─── Preview Emit ─────────────────────────────────────────────────────────

  /**
   * Build the WSFE payload and get the next number WITHOUT calling AFIP for a CAE.
   * Used by POST /invoices/preview.
   */
  async previewEmit(
    tenantId: string,
    issuerId: string,
    input: {
      paymentId: string;
      amount: string;
      ivaRate: number;
      concepto?: number;
      puntoDeVenta?: number;
    },
  ): Promise<PreviewEmitResult> {
    const warnings: string[] = [];

    const payment = await this.prisma.client.payment.findFirst({
      where: { id: input.paymentId, tenantId },
      include: {
        liquidacion: {
          include: {
            contract: { include: { persons: { include: { person: true } } } },
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException({ error: 'PAYMENT_NOT_FOUND', message: 'Payment not found' });
    }

    const contract = payment.liquidacion?.contract;
    const inquilinoCP = (contract?.persons ?? []).find(
      (cp: any) => cp.role === PersonRole.Inquilino,
    );

    if (!inquilinoCP?.person) {
      warnings.push('No Inquilino found on contract — using ConsumidorFinal as default');
    }

    const receptorFC =
      (inquilinoCP?.person?.fiscalCondition as FiscalCondition) ?? FiscalCondition.ConsumidorFinal;

    const issuer = await this.resolveIssuerContext(tenantId, issuerId);
    if (issuer.delegationStatus === 'Pending') {
      warnings.push(`Issuer delegation is Pending — emission may fail`);
    }

    const emisorFC = issuer.fiscalCondition as FiscalCondition;
    let resolution: ComprobanteResolution;
    try {
      resolution = resolveComprobanteType(emisorFC, receptorFC);
    } catch (err: any) {
      throw new BadRequestException({ error: 'COMPROBANTE_RESOLUTION_ERROR', message: err.message });
    }

    const puntoDeVenta = await this.resolvePuntoDeVenta(issuer.id, input.puntoDeVenta);
    const nextNumero = await this.arcaService.getLastVoucher(
      tenantId,
      issuer.id,
      puntoDeVenta,
      resolution.cbteTipo,
    ).then((n) => n + 1);

    const amount = new Decimal(input.amount);
    const ivaRate = new Decimal(input.ivaRate);
    const { ivaArray } = computeIva(resolution.letra, amount, ivaRate);

    const docTipo = resolveDocTipo(receptorFC);
    const receptor = inquilinoCP?.person;
    const docNro = docTipo === 99 ? '0' : (receptor?.cuit ?? '0').replace(/-/g, '');

    const payload: ArcaEmitPayload = {
      puntoDeVenta,
      cbteTipo: resolution.cbteTipo,
      letra: resolution.letra,
      amount: input.amount,
      ivaRate: input.ivaRate,
      concepto: input.concepto ?? 2,
      docTipo,
      docNro,
      receptorFiscalCondition: receptorFC,
      ivaArray,
    };

    return { nextNumero, payload, warnings };
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

// ─── Constant re-used in invoices.service.ts ─────────────────────────────────

const FISCAL_CONDITION_TO_ARCA: Record<FiscalCondition, number> = {
  [FiscalCondition.ResponsableInscripto]: 1,
  [FiscalCondition.Exento]: 4,
  [FiscalCondition.ConsumidorFinal]: 5,
  [FiscalCondition.Monotributista]: 6,
  [FiscalCondition.NoResponsable]: 7,
};
