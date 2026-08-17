import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z, ZodTypeAny } from 'zod';
import { InvoicesService } from './invoices.service';
import { IssuersService } from './issuers.service';
import { CertificateService } from './certificate.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { ArcaService } from './arca/arca.service';
import { ArcaParamCacheService } from './arca/arca-param-cache.service';
import type { ParamType } from './arca/arca-param-cache.service';
import { Roles } from '../../common/auth/roles.decorator';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { UserRole } from '@realfy/shared';
import {
  EmitInvoiceDtoSchema,
  EmitNotaCreditoDtoSchema,
  IssuerCreateDtoSchema,
  IssuerUpdateDtoSchema,
  PuntoDeVentaCreateDtoSchema,
} from '@realfy/shared';

// Role shorthand constants
const MUTATE_ROLES = [UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones] as const;
const READ_ROLES = [UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones, UserRole.Ventas, UserRole.Soporte, UserRole.Lectura] as const;
const ADMIN_ROLES = [UserRole.Admin] as const;

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly issuersService: IssuersService,
    private readonly certificateService: CertificateService,
    private readonly fiscalPdfService: FiscalPdfService,
    private readonly arcaService: ArcaService,
    private readonly arcaParamCache: ArcaParamCacheService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Validate a request body against its schema, surfacing Zod's own issue list
   * so the client can point at the offending field.
   */
  private parse<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new UnprocessableEntityException({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: parsed.error.errors,
      });
    }
    return parsed.data;
  }

  // ─── Preview ───────────────────────────────────────────────────────────────

  /**
   * POST /invoices/preview
   * Build the WSFE payload and get next numero WITHOUT calling AFIP for a CAE.
   */
  @Roles(...MUTATE_ROLES)
  @Post('preview')
  async previewEmit(@Body() body: Record<string, unknown>) {
    return this.invoicesService.previewEmitFromDto(this.parse(EmitInvoiceDtoSchema, body));
  }

  // ─── Emit ──────────────────────────────────────────────────────────────────

  /**
   * POST /invoices/emit
   * Emit a comprobante (factura). Idempotent via clientRequestId.
   */
  @Roles(...MUTATE_ROLES)
  @Post('emit')
  async emitInvoice(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const { comprobante, isIdempotentReplay } = await this.invoicesService.emitFromDto(
      this.parse(EmitInvoiceDtoSchema, body),
    );

    if (isIdempotentReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }

    return comprobante;
  }

  /**
   * POST /invoices/emit-nc
   * Emit a nota de crédito. Requires cbtesAsoc.
   */
  @Roles(...MUTATE_ROLES)
  @Post('emit-nc')
  async emitNotaCredito(@Body() body: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const { comprobante, isIdempotentReplay } = await this.invoicesService.emitNotaCreditoFromDto(
      this.parse(EmitNotaCreditoDtoSchema, body),
    );

    if (isIdempotentReplay) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }

    return comprobante;
  }

  // ─── List & Detail ─────────────────────────────────────────────────────────

  /**
   * GET /invoices
   * List comprobantes with optional filters + pagination.
   */
  @Roles(...READ_ROLES)
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    return this.invoicesService.findAll(query);
  }

  // ─── Certificate routes (Admin only) ──────────────────────────────────────

  /**
   * GET /invoices/certificate
   * Returns cert metadata — NO private key material.
   */
  @Roles(...ADMIN_ROLES)
  @Get('certificate')
  async getCertificate() {
    return this.certificateService.getCertificateMetadata();
  }

  /**
   * POST /invoices/certificate
   * Upload PEM cert + key. Parses X.509, encrypts, stores.
   */
  @Roles(...ADMIN_ROLES)
  @Post('certificate')
  async uploadCertificate(@Body() body: Record<string, any>) {
    if (!body.certPem || !body.keyPem) {
      throw new UnprocessableEntityException({
        error: 'VALIDATION_ERROR',
        message: 'certPem and keyPem are required',
      });
    }

    return this.certificateService.uploadCertificate({
      certPem: body.certPem,
      keyPem: body.keyPem,
      isProduction: body.isProduction === true,
    });
  }

  /**
   * DELETE /invoices/certificate
   * Refuses if active issuers unless ?force=true.
   */
  @Roles(...ADMIN_ROLES)
  @Delete('certificate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCertificate(@Query('force') force?: string) {
    await this.certificateService.deleteCertificate(force === 'true');
  }

  // ─── Healthcheck ───────────────────────────────────────────────────────────

  /**
   * GET /invoices/healthcheck
   */
  @Roles(...READ_ROLES)
  @Get('healthcheck')
  async healthcheck() {
    const tenantId = this.tenantContext.getTenantId() ?? '';
    const arcaStatus = await this.arcaService.healthcheck(tenantId);
    const certMeta = await this.certificateService.getCertificateMetadata();

    return {
      ...arcaStatus,
      certificate: certMeta
        ? {
            commonName: certMeta.commonName,
            notAfter: certMeta.notAfter,
            daysUntilExpiry: certMeta.daysUntilExpiry,
          }
        : null,
    };
  }

  // ─── Param cache ───────────────────────────────────────────────────────────

  /**
   * GET /invoices/param-cache/:type
   * Proxies ARCA param cache. type ∈ tiposCbte|tiposDoc|tiposIva|condicionIvaReceptor.
   * Optionally accepts ?issuerId= to use a specific issuer for auth; otherwise picks the
   * first active self-issuer for the tenant.
   */
  @Roles(...READ_ROLES)
  @Get('param-cache/:type')
  async getParamCache(
    @Param('type') type: string,
    @Query('issuerId') issuerId?: string,
  ) {
    const PARAM_TYPE_MAP: Record<string, ParamType> = {
      tiposCbte: 'voucherTypes',
      tiposDoc: 'documentTypes',
      tiposIva: 'aliquotTypes',
      condicionIvaReceptor: 'condicionIvaReceptor',
    };

    const allowed = Object.keys(PARAM_TYPE_MAP);
    if (!allowed.includes(type)) {
      throw new UnprocessableEntityException({
        error: 'INVALID_PARAM_TYPE',
        message: `type must be one of: ${allowed.join(', ')}`,
      });
    }

    const tenantId = this.tenantContext.getTenantId() ?? '';
    const paramType = PARAM_TYPE_MAP[type];

    // Resolve issuer: explicit or first active issuer
    let resolvedIssuerId = issuerId;
    let resolvedCuit: string | undefined;

    if (!resolvedIssuerId) {
      const issuers = await this.issuersService.listIssuers();
      const active = (issuers as any[]).find((i: any) => i.isActive);
      if (active) {
        resolvedIssuerId = active.id;
        resolvedCuit = active.cuit;
      }
    } else {
      const issuers = await this.issuersService.listIssuers();
      const found = (issuers as any[]).find((i: any) => i.id === resolvedIssuerId);
      resolvedCuit = found?.cuit;
    }

    if (!resolvedIssuerId || !resolvedCuit) {
      throw new UnprocessableEntityException({
        error: 'NO_ACTIVE_ISSUER',
        message: 'No active issuer found for this tenant. Create an issuer first.',
      });
    }

    const data = await this.arcaParamCache.get(
      paramType,
      tenantId,
      resolvedIssuerId,
      resolvedCuit,
    );

    return { type, issuerId: resolvedIssuerId, data };
  }

  // ─── Padrón ────────────────────────────────────────────────────────────────

  /**
   * GET /invoices/padron/:cuit
   * AFIP Padrón A5 lookup. Returns null when the CUIT is not in the padrón.
   */
  @Roles(...READ_ROLES)
  @Get('padron/:cuit')
  async padronLookup(
    @Param('cuit') cuit: string,
    @Query('issuerId') issuerId?: string,
  ) {
    if (!issuerId) {
      throw new UnprocessableEntityException({
        error: 'MISSING_ISSUER_ID',
        message: 'issuerId query param is required for padrón lookup',
      });
    }
    const tenantId = this.tenantContext.getTenantId() ?? '';
    return this.arcaService.padronLookup(tenantId, issuerId, cuit);
  }

  // ─── Issuers ───────────────────────────────────────────────────────────────

  /**
   * GET /invoices/issuers
   * List issuers for tenant.
   */
  @Roles(...READ_ROLES)
  @Get('issuers')
  async listIssuers() {
    return this.issuersService.listIssuers();
  }

  /**
   * POST /invoices/issuers
   * Create issuer. Validates CUIT checksum.
   */
  @Roles(...MUTATE_ROLES)
  @Post('issuers')
  async createIssuer(@Body() body: Record<string, unknown>) {
    return this.issuersService.createIssuer(this.parse(IssuerCreateDtoSchema, body));
  }

  /**
   * PATCH /invoices/issuers/:id
   * Partial update issuer.
   */
  @Roles(...MUTATE_ROLES)
  @Patch('issuers/:id')
  async updateIssuer(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.issuersService.updateIssuer(id, this.parse(IssuerUpdateDtoSchema, body));
  }

  /**
   * DELETE /invoices/issuers/:id
   * Soft-delete via isActive=false. Blocked if comprobantes exist.
   */
  @Roles(...MUTATE_ROLES)
  @Delete('issuers/:id')
  async deleteIssuer(@Param('id') id: string) {
    return this.issuersService.deleteIssuer(id);
  }

  /**
   * POST /invoices/issuers/:id/verify-delegation
   * Calls ArcaService.verifyDelegation.
   */
  @Roles(...MUTATE_ROLES)
  @Post('issuers/:id/verify-delegation')
  async verifyDelegation(@Param('id') id: string) {
    const tenantId = this.tenantContext.getTenantId() ?? '';
    return this.arcaService.verifyDelegation(tenantId, id);
  }

  /**
   * POST /invoices/issuers/:id/sync-pdv
   * Calls ArcaService.syncPuntosDeVenta.
   */
  @Roles(...MUTATE_ROLES)
  @Post('issuers/:id/sync-pdv')
  async syncPdv(@Param('id') id: string) {
    const tenantId = this.tenantContext.getTenantId() ?? '';
    return this.arcaService.syncPuntosDeVenta(tenantId, id);
  }

  /**
   * GET /invoices/issuers/:id/pdv
   * List PdV for issuer.
   */
  @Roles(...READ_ROLES)
  @Get('issuers/:id/pdv')
  async listPdv(@Param('id') id: string) {
    return this.issuersService.listPdv(id);
  }

  /**
   * POST /invoices/issuers/:id/pdv
   * Manually add PdV (when AFIP sync fails or for testing).
   */
  @Roles(...MUTATE_ROLES)
  @Post('issuers/:id/pdv')
  async createPdv(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.issuersService.createPdv(id, this.parse(PuntoDeVentaCreateDtoSchema, body));
  }

  // ─── PdV standalone delete ─────────────────────────────────────────────────

  /**
   * DELETE /invoices/pdv/:id
   * Remove PdV by its own ID.
   */
  @Roles(...MUTATE_ROLES)
  @Delete('pdv/:id')
  async deletePdv(@Param('id') id: string) {
    return this.issuersService.deletePdv(id);
  }

  // ─── Detail, PDF, Void ────────────────────────────────────────────────────

  /**
   * POST /invoices/:id/void
   * Void a comprobante via NC emission (convenience wrapper).
   */
  @Roles(...MUTATE_ROLES)
  @Post(':id/void')
  async voidComprobante(@Param('id') id: string, @Body() body: Record<string, any>) {
    return this.invoicesService.voidComprobante(id, body);
  }

  /**
   * GET /invoices/:id/pdf
   * Streams fiscal PDF.
   */
  @Roles(...READ_ROLES)
  @Get(':id/pdf')
  async getPdf(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.fiscalPdfService.generatePdfForComprobante(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  /**
   * GET /invoices/:id
   * Comprobante detail including ArcaRequestLog tail.
   */
  @Roles(...READ_ROLES)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.invoicesService.findOneWithLogs(id);
  }

}
