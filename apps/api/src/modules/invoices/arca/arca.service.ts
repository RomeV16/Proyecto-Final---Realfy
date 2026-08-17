import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ArcaClientFactory } from './arca-client.factory';
import { ArcaTaManager } from './arca-ta.manager';
import { ArcaParamCacheService } from './arca-param-cache.service';
import { ArcaRequestLogService } from './arca-request-log.service';
import { PadronA5Service } from './padron-a5.service';
import {
  FiscalCondition,
  getIvaTreatment,
} from '@realfy/shared';
import type { ComprobanteLetra } from '@realfy/shared';
import Decimal from 'decimal.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArcaEmitPayload {
  /** Which punto de venta to use */
  puntoDeVenta: number;
  cbteTipo: number;
  letra: ComprobanteLetra;
  /** Total amount (string to preserve Decimal precision) */
  amount: string;
  ivaRate: number;
  concepto: number;
  docTipo: number;
  docNro: string;
  receptorFiscalCondition: FiscalCondition;
  condicionIVAReceptorId?: number;
  description?: string;
  /** Service period */
  fchServDesde?: Date;
  fchServHasta?: Date;
  fchVtoPago?: Date;
  /** Foreign currency */
  monId?: string;
  monCotiz?: number;
  /** Structured IVA / tributos / opcionales */
  ivaArray?: Array<{ Id: number; BaseImp: number; Importe: number }>;
  tributos?: Array<Record<string, unknown>>;
  opcionales?: Array<Record<string, unknown>>;
  /** NC/ND associated comprobantes */
  cbtesAsoc?: Array<{ tipo: number; ptoVta: number; nro: number }>;
  /** Period association */
  periodoAsocDesde?: Date;
  periodoAsocHasta?: Date;
}

export interface ArcaEmitResult {
  cae: string;
  caeFchVto: string; // yyyy-mm-dd
  numero: number;
  raw: Record<string, unknown>;
}

// ─── IVA condition mapping ─────────────────────────────────────────────────────

const FISCAL_CONDITION_TO_ARCA: Record<FiscalCondition, number> = {
  [FiscalCondition.ResponsableInscripto]: 1,
  [FiscalCondition.Exento]: 4,
  [FiscalCondition.ConsumidorFinal]: 5,
  [FiscalCondition.Monotributista]: 6,
  [FiscalCondition.NoResponsable]: 7,
};

const IVA_RATE_TO_ID: Record<number, number> = {
  0: 3,
  2.5: 9,
  5: 8,
  10.5: 4,
  21: 5,
  27: 6,
};

// ─── Date helper ──────────────────────────────────────────────────────────────

function toAfipDate(d: Date): number {
  return parseInt(
    d.toISOString().split('T')[0].replace(/-/g, ''),
    10,
  );
}

function todayAfipDate(): number {
  const d = new Date();
  // Use UTC-3 (Buenos Aires) offset
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return toAfipDate(ar);
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ArcaService {
  private readonly logger = new Logger(ArcaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clientFactory: ArcaClientFactory,
    private readonly taManager: ArcaTaManager,
    private readonly paramCache: ArcaParamCacheService,
    private readonly requestLog: ArcaRequestLogService,
    private readonly padronA5: PadronA5Service,
  ) {}

  // ─── Resolve issuer ─────────────────────────────────────────────────────────

  private async resolveIssuer(tenantId: string, issuerId: string) {
    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id: issuerId, tenantId },
    });

    if (!issuer) {
      throw new NotFoundException(`ArcaIssuer ${issuerId} not found for tenant ${tenantId}`);
    }

    if (!issuer.isActive) {
      throw new BadRequestException({
        error: 'ISSUER_INACTIVE',
        message: `ArcaIssuer ${issuerId} is inactive`,
      });
    }

    if (issuer.delegationStatus === 'Revoked') {
      throw new BadRequestException({
        error: 'DELEGATION_REVOKED',
        message: `Delegation for issuer ${issuerId} (CUIT ${issuer.cuit}) has been revoked`,
      });
    }

    if (issuer.delegationStatus === 'Pending') {
      this.logger.warn('Issuer delegation is Pending — proceeding but may fail', {
        tenantId,
        issuerId,
        cuit: issuer.cuit,
      });
    }

    return issuer;
  }

  // ─── Build WSFE payload ─────────────────────────────────────────────────────

  private buildVoucherData(
    issuerCuit: string,
    puntoDeVenta: number,
    payload: ArcaEmitPayload,
    nextNumber: number,
  ): Record<string, unknown> {
    const amount = new Decimal(payload.amount);
    const ivaTreatment = getIvaTreatment(payload.letra);

    const today = todayAfipDate();
    const fchServDesde = payload.fchServDesde ? toAfipDate(payload.fchServDesde) : today;
    const fchServHasta = payload.fchServHasta ? toAfipDate(payload.fchServHasta) : today;
    const fchVtoPago = payload.fchVtoPago ? toAfipDate(payload.fchVtoPago) : today;

    const condicionIvaReceptor =
      payload.condicionIVAReceptorId ??
      (FISCAL_CONDITION_TO_ARCA[payload.receptorFiscalCondition] ?? 5);

    let impNeto: Decimal;
    let impIva: Decimal;
    let ivaArray: Array<{ Id: number; BaseImp: number; Importe: number }> | undefined;

    if (payload.ivaArray && payload.ivaArray.length > 0) {
      // Caller supplied full IVA breakdown
      ivaArray = payload.ivaArray;
      impIva = ivaArray.reduce((acc, i) => acc.plus(new Decimal(i.Importe)), new Decimal(0));
      impNeto = ivaArray.reduce((acc, i) => acc.plus(new Decimal(i.BaseImp)), new Decimal(0));
    } else if (ivaTreatment === 'none') {
      impNeto = amount;
      impIva = new Decimal(0);
    } else {
      const ivaRate = new Decimal(payload.ivaRate);
      impNeto = amount.div(ivaRate.div(100).plus(1)).toDecimalPlaces(2);
      impIva = amount.minus(impNeto).toDecimalPlaces(2);
      const ivaId = IVA_RATE_TO_ID[payload.ivaRate] ?? 5;
      ivaArray = [{ Id: ivaId, BaseImp: impNeto.toNumber(), Importe: impIva.toNumber() }];
    }

    const docNroNumeric =
      payload.docTipo === 99 ? 0 : parseInt(String(payload.docNro).replace(/-/g, ''), 10) || 0;

    const data: Record<string, unknown> = {
      CantReg: 1,
      PtoVta: puntoDeVenta,
      CbteTipo: payload.cbteTipo,
      Concepto: payload.concepto,
      DocTipo: payload.docTipo,
      DocNro: docNroNumeric,
      CbteDesde: nextNumber,
      CbteHasta: nextNumber,
      CbteFch: today,
      ImpTotal: amount.toNumber(),
      ImpTotConc: 0,
      ImpNeto: impNeto.toNumber(),
      ImpOpEx: 0,
      ImpIVA: impIva.toNumber(),
      ImpTrib: 0,
      MonId: payload.monId ?? 'PES',
      MonCotiz: payload.monCotiz ?? 1,
      CondicionIVAReceptorId: condicionIvaReceptor,
    };

    // Service dates (concepto 2 or 3)
    if (payload.concepto === 2 || payload.concepto === 3) {
      data.FchServDesde = fchServDesde;
      data.FchServHasta = fchServHasta;
      data.FchVtoPago = fchVtoPago;
    }

    if (ivaArray && ivaArray.length > 0) {
      data.Iva = ivaArray;
    }

    if (payload.tributos && payload.tributos.length > 0) {
      data.Tributos = payload.tributos;
    }

    if (payload.opcionales && payload.opcionales.length > 0) {
      data.Opcionales = payload.opcionales;
    }

    if (payload.cbtesAsoc && payload.cbtesAsoc.length > 0) {
      data.CbtesAsoc = payload.cbtesAsoc.map((c) => ({
        Tipo: c.tipo,
        PtoVta: c.ptoVta,
        Nro: c.nro,
      }));
    }

    return data;
  }

  // ─── emit ───────────────────────────────────────────────────────────────────

  async emit(
    tenantId: string,
    issuerId: string,
    payload: ArcaEmitPayload,
  ): Promise<ArcaEmitResult> {
    const issuer = await this.resolveIssuer(tenantId, issuerId);

    await this.taManager.ensureTA(tenantId, issuerId, 'system:emit');

    const { afip } = await this.clientFactory.getClient(tenantId, issuerId, 'system:emit');
    const eb = afip.ElectronicBilling;

    // Get last voucher
    const lastVoucher = await this.requestLog.wrap(
      {
        tenantId,
        issuerId,
        operation: 'getLastVoucher',
        issuerCuit: issuer.cuit,
        requestPayload: { puntoDeVenta: payload.puntoDeVenta, cbteTipo: payload.cbteTipo },
      },
      () => eb.getLastVoucher(payload.puntoDeVenta, payload.cbteTipo),
    );

    const nextNumber = (lastVoucher as number) + 1;
    const voucherData = this.buildVoucherData(issuer.cuit, payload.puntoDeVenta, payload, nextNumber);

    const result = await this.requestLog.wrap(
      {
        tenantId,
        issuerId,
        operation: 'emit',
        issuerCuit: issuer.cuit,
        requestPayload: voucherData as Record<string, unknown>,
      },
      () => eb.createVoucher(voucherData),
    );

    const typed = result as { CAE: string; CAEFchVto: string };

    return {
      cae: typed.CAE,
      caeFchVto: typed.CAEFchVto,
      numero: nextNumber,
      raw: result as Record<string, unknown>,
    };
  }

  // ─── emitNotaCredito ─────────────────────────────────────────────────────────

  async emitNotaCredito(
    tenantId: string,
    issuerId: string,
    payload: ArcaEmitPayload,
  ): Promise<ArcaEmitResult> {
    // NC is structurally the same — cbtesAsoc must be populated by caller
    return this.emit(tenantId, issuerId, payload);
  }

  // ─── getLastVoucher ──────────────────────────────────────────────────────────

  async getLastVoucher(
    tenantId: string,
    issuerId: string,
    ptoVta: number,
    cbteTipo: number,
  ): Promise<number> {
    const issuer = await this.resolveIssuer(tenantId, issuerId);

    await this.taManager.ensureTA(tenantId, issuerId, 'system:getLastVoucher');

    const { afip } = await this.clientFactory.getClient(tenantId, issuerId, 'system:getLastVoucher');

    return this.requestLog.wrap(
      {
        tenantId,
        issuerId,
        operation: 'getLastVoucher',
        issuerCuit: issuer.cuit,
        requestPayload: { ptoVta, cbteTipo },
      },
      () => afip.ElectronicBilling.getLastVoucher(ptoVta, cbteTipo),
    );
  }

  // ─── syncPuntosDeVenta ───────────────────────────────────────────────────────

  async syncPuntosDeVenta(tenantId: string, issuerId: string): Promise<any[]> {
    const issuer = await this.resolveIssuer(tenantId, issuerId);

    await this.taManager.ensureTA(tenantId, issuerId, 'system:syncPdV');

    const salesPoints = await this.requestLog.wrap(
      {
        tenantId,
        issuerId,
        operation: 'syncPdV',
        issuerCuit: issuer.cuit,
      },
      () =>
        this.paramCache.get(
          'salesPoints',
          tenantId,
          issuerId,
          issuer.cuit,
          true, // force refresh
        ),
    );

    const points = Array.isArray(salesPoints) ? salesPoints : [salesPoints].filter(Boolean);

    // Upsert ArcaPuntoDeVenta rows
    const upserted: any[] = [];
    for (const sp of points) {
      const number = sp.Nro ?? sp.nro ?? sp.number;
      if (number === undefined) continue;

      const row = await this.prisma.client.arcaPuntoDeVenta.upsert({
        where: { issuerId_number: { issuerId, number } },
        create: {
          tenantId,
          issuerId,
          number,
          nombre: sp.EmisionTipo ?? sp.nombre ?? null,
          tipo: sp.EmisionTipo ?? sp.tipo ?? null,
          bloqueado: sp.Bloqueado === 'S' || sp.bloqueado === true,
          lastSyncAt: new Date(),
        },
        update: {
          nombre: sp.EmisionTipo ?? sp.nombre ?? null,
          tipo: sp.EmisionTipo ?? sp.tipo ?? null,
          bloqueado: sp.Bloqueado === 'S' || sp.bloqueado === true,
          lastSyncAt: new Date(),
        },
      });
      upserted.push(row);
    }

    this.logger.log('PuntosDeVenta synced', { tenantId, issuerId, count: upserted.length });
    return upserted;
  }

  // ─── verifyDelegation ────────────────────────────────────────────────────────

  async verifyDelegation(
    tenantId: string,
    issuerId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    // Don't call resolveIssuer here — it would block Revoked issuers from being re-verified
    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { id: issuerId, tenantId },
    });

    if (!issuer) {
      throw new NotFoundException(`ArcaIssuer ${issuerId} not found`);
    }

    let ok = false;
    let errorMsg: string | undefined;

    try {
      await this.taManager.ensureTA(tenantId, issuerId, 'system:verifyDelegation');

      await this.requestLog.wrap(
        {
          tenantId,
          issuerId,
          operation: 'verifyDelegation',
          issuerCuit: issuer.cuit,
        },
        () =>
          this.paramCache.get(
            'salesPoints',
            tenantId,
            issuerId,
            issuer.cuit,
            true,
          ),
      );
      ok = true;
    } catch (err: any) {
      errorMsg = err?.message ?? String(err);
      const isAuthError =
        errorMsg != null && /auth|unauthorized|delegat|permission|coe\./i.test(errorMsg);

      await this.prisma.client.arcaIssuer.update({
        where: { id: issuerId },
        data: {
          delegationStatus: isAuthError ? 'Revoked' : issuer.delegationStatus,
          delegationLastError: errorMsg,
        },
      });

      return { ok: false, error: errorMsg };
    }

    await this.prisma.client.arcaIssuer.update({
      where: { id: issuerId },
      data: {
        delegationStatus: 'Active',
        delegationVerifiedAt: new Date(),
        delegationLastError: null,
      },
    });

    return { ok: true };
  }

  // ─── padronLookup ────────────────────────────────────────────────────────────

  /**
   * Padrón A5 lookup — queries AFIP's ws_sr_padron_a5 service via our own
   * WSAA + SOAP client. Returns businessName, fiscalCondition, and optional address.
   */
  async padronLookup(
    tenantId: string,
    issuerId: string,
    cuit: string,
  ): Promise<{ businessName: string; fiscalCondition: string; address?: string } | null> {
    return this.padronA5.lookup(tenantId, issuerId, cuit);
  }

  // ─── healthcheck ─────────────────────────────────────────────────────────────

  async healthcheck(
    tenantId: string,
  ): Promise<{ afipUp: boolean; taValid: boolean }> {
    // Find any active issuer for this tenant
    const issuer = await this.prisma.client.arcaIssuer.findFirst({
      where: { tenantId, isActive: true },
    });

    if (!issuer) {
      return { afipUp: false, taValid: false };
    }

    try {
      await this.taManager.ensureTA(tenantId, issuer.id, 'system:healthcheck');

      const { afip } = await this.clientFactory.getClient(
        tenantId,
        issuer.id,
        'system:healthcheck',
      );

      const status = await afip.ElectronicBilling.getServerStatus();
      const afipUp =
        status?.AppServer === 'OK' || status?.AuthServer === 'OK' || !!status;

      return { afipUp, taValid: true };
    } catch {
      return { afipUp: false, taValid: false };
    }
  }
}
