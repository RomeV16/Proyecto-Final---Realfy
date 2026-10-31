import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { buildXlsx } from '../../common/export/tabular';
import Decimal from 'decimal.js';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { ArcaService } from './arca/arca.service';
import { NotificationsService } from '../notifications/notifications.service';
import { S3Service } from '../../common/media/s3.service';
import { AR_TIME_ZONE, formatDateAR, monthStartUTC, periodKey, todayInAR } from '@realfy/shared';
import { findStaff } from '../../common/auth/find-staff';
import { ADMIN_ONLY, MANAGEMENT_ROLES } from '../../common/auth/role-groups';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CertExpiryMeta {
  lastWarnedAt?: string; // ISO date string (date-only, YYYY-MM-DD)
  lastWarnLevel?: 'low' | 'high' | 'expired';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return today as a YYYY-MM-DD string (Buenos Aires time). */
function todayArgentina(): string {
  return new Date()
    .toLocaleDateString('en-CA', { timeZone: AR_TIME_ZONE });
}

/** Days between two dates (positive = future). */
function daysUntil(target: Date): number {
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/** Pause execution for ms milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class FiscalScheduler extends CronBaseService {
  protected readonly logger = new Logger(FiscalScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly arcaService: ArcaService,
    private readonly notifications: NotificationsService,
    private readonly s3: S3Service,
    private readonly tenantCron: TenantCron,
  ) {
    super();
  }

  // ─── A. Certificate expiry check — daily 08:00 ART ──────────────────────────

  @Cron('0 8 * * *', {
    name: 'fiscal-cert-expiry',
    timeZone: AR_TIME_ZONE,
  })
  async handleCertExpiryCheck(): Promise<void> {
    await this.runGuarded(async () => { await this.checkCertificateExpiry(); }, 'fiscal-cert-expiry');
  }

  async checkCertificateExpiry(): Promise<{ checked: number; notified: number }> {
    const start = Date.now();
    this.logger.log('checkCertificateExpiry started');

    const today = todayArgentina();
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // All active certs that expire within 30 days OR are already expired
    let checked = 0;
    let notified = 0;

    await this.tenantCron.forEachActiveTenant('fiscal-cert-expiry', async (tenantId) => {
      const certs = await this.prisma.client.arcaCertificate.findMany({
        where: {
          isActive: true,
          notAfter: { lte: in30 },
        },
      });
      checked += certs.length;

      for (const cert of certs) {
        try {
          const days = daysUntil(cert.notAfter);

          // ── Determine warn level ──────────────────────────────────────────────
          let warnLevel: 'low' | 'high' | 'expired';
          if (days < 0) {
            warnLevel = 'expired';
          } else if (days <= 7) {
            warnLevel = 'high';
          } else {
            warnLevel = 'low';
          }

          // ── Idempotency: skip if already warned today at same or higher level ─
          // We use ArcaRequestLog with operation='cert_expiry_warn' as dedup log.
          const alreadyWarned = await this.prisma.client.arcaRequestLog.findFirst({
            where: {
              issuerId: null,
              operation: 'cert_expiry_warn',
              errorCode: warnLevel,
              // createdAt >= start of today (UTC date covers ART morning run)
              createdAt: { gte: todayInAR() },
            },
          });

          if (alreadyWarned) {
            this.logger.debug(
              `cert_expiry_warn already sent today for tenantId=${tenantId} level=${warnLevel}`,
            );
            continue;
          }

          // ── If expired, flip isActive=false ──────────────────────────────────
          if (warnLevel === 'expired') {
            await this.prisma.client.arcaCertificate.update({
              where: { id: cert.id },
              data: { isActive: false },
            });
            this.logger.warn(
              `ArcaCertificate expired — deactivated tenantId=${tenantId} certId=${cert.id}`,
            );
          }

          // ── Build notification content ────────────────────────────────────────
          const title =
            warnLevel === 'expired'
              ? `Certificado AFIP vencido — acción requerida`
              : warnLevel === 'high'
              ? `Certificado AFIP vence en ${days} días — urgente`
              : `Certificado AFIP vence en ${days} días`;

          const message =
            warnLevel === 'expired'
              ? `El certificado digital AFIP del tenant ha vencido el ${cert.notAfter.toLocaleDateString('es-AR')}. Se desactivó automáticamente. Renuévelo para continuar facturando.`
              : `El certificado digital AFIP vence el ${cert.notAfter.toLocaleDateString('es-AR')} (${days} días restantes). Por favor renuévelo a la brevedad.`;

          // ── Notify Admin users ────────────────────────────────────────────────
          const admins = await findStaff(this.prisma, tenantId, ADMIN_ONLY, { id: true });

          for (const admin of admins) {
            await this.notifications.createNotification({
              tenantId,
              userId: admin.id,
              type: 'FiscalCertExpiry',
              title,
              message,
              entityType: 'ArcaCertificate',
              entityId: cert.id,
            });
            notified++;
          }

          // ── Record dedup log entry ────────────────────────────────────────────
          await this.prisma.client.arcaRequestLog.create({
            data: {
              tenantId,
              issuerId: null,
              operation: 'cert_expiry_warn',
              issuerCuit: null,
              latencyMs: 0,
              success: true,
              errorCode: warnLevel, // reuse errorCode as level tag (not an error)
              errorMessage: `days=${days} level=${warnLevel} today=${today}`,
            },
          });
        } catch (err) {
          this.logger.error(
            `checkCertificateExpiry failed for certId=${cert.id}: ${(err as Error).message}`,
            (err as Error).stack,
          );
        }
      }
    });

    this.logger.log(
      `checkCertificateExpiry done in ${Date.now() - start}ms — checked=${checked}, notified=${notified}`,
    );
    return { checked, notified };
  }

  // ─── B. Delegation healthcheck — daily 09:00 ART ────────────────────────────

  @Cron('0 9 * * *', {
    name: 'fiscal-delegation-healthcheck',
    timeZone: AR_TIME_ZONE,
  })
  async handleDelegationHealthcheck(): Promise<void> {
    await this.runGuarded(
      async () => { await this.healthcheckDelegations(); },
      'fiscal-delegation-healthcheck',
    );
  }

  async healthcheckDelegations(): Promise<{ checked: number; revoked: number; refreshed: number }> {
    const start = Date.now();
    this.logger.log('healthcheckDelegations started');

    let checked = 0;
    let revoked = 0;
    let refreshed = 0;

    await this.tenantCron.forEachActiveTenant('fiscal-delegation-healthcheck', async (tenantId) => {
      const issuers = await this.prisma.client.arcaIssuer.findMany({
        where: {
          isActive: true,
          delegationStatus: { not: 'Revoked' },
        },
        select: {
          id: true,
          tenantId: true,
          cuit: true,
          businessName: true,
          delegationStatus: true,
        },
      });

      for (const issuer of issuers) {
        // Rate-limit: 1 call/sec to not hammer AFIP
        if (checked > 0) await sleep(1000);
        checked++;

        try {
          const result = await this.arcaService.verifyDelegation(
            tenantId,
            issuer.id,
          );

          if (!result.ok) {
            // verifyDelegation already flips to Revoked internally for auth errors.
            // Check if it was actually revoked by re-reading status.
            const updated = await this.prisma.client.arcaIssuer.findUnique({
              where: { id: issuer.id },
              select: { delegationStatus: true },
            });

            if (updated?.delegationStatus === 'Revoked') {
              revoked++;
              this.logger.warn(
                `Delegation revoked for issuerId=${issuer.id} tenantId=${tenantId} cuit=${issuer.cuit}`,
              );

              // Notify tenant admins
              const admins = await findStaff(this.prisma, tenantId, ADMIN_ONLY, { id: true });

              for (const admin of admins) {
                await this.notifications.createNotification({
                  tenantId,
                  userId: admin.id,
                  type: 'FiscalDelegationRevoked',
                  title: `Delegación AFIP revocada — ${issuer.businessName}`,
                  message: `La delegación de facturación electrónica para el emisor ${issuer.businessName} (CUIT ${issuer.cuit}) fue revocada por AFIP. Revise las configuraciones en el portal de AFIP.`,
                  entityType: 'ArcaIssuer',
                  entityId: issuer.id,
                });
              }
            } else {
              // Transient failure — log and leave current status
              this.logger.warn(
                `Transient delegation check failure for issuerId=${issuer.id}: ${result.error}`,
              );
            }
          } else {
            refreshed++;
            this.logger.debug(
              `Delegation OK for issuerId=${issuer.id} tenantId=${tenantId}`,
            );
          }
        } catch (err) {
          // Transient error (network, 5xx) — log and leave
          this.logger.error(
            `healthcheckDelegations failed for issuerId=${issuer.id}: ${(err as Error).message}`,
          );
        }
      }
    });

    this.logger.log(
      `healthcheckDelegations done in ${Date.now() - start}ms — checked=${checked}, revoked=${revoked}, refreshed=${refreshed}`,
    );
    return { checked, revoked, refreshed };
  }

  // ─── C. Libro IVA Ventas — monthly, 1st day 05:00 ART ───────────────────────

  @Cron('0 5 1 * *', {
    name: 'fiscal-libro-iva-ventas',
    timeZone: AR_TIME_ZONE,
  })
  async handleLibroIvaVentas(): Promise<void> {
    await this.runGuarded(async () => { await this.generateLibroIvaVentas(); }, 'fiscal-libro-iva-ventas');
  }

  async generateLibroIvaVentas(): Promise<{ processed: number; skipped: number }> {
    const start = Date.now();
    this.logger.log('generateLibroIvaVentas started');

    // Previous month range
    const today = todayInAR();
    const prevMonthStart = monthStartUTC(today.getUTCFullYear(), today.getUTCMonth());
    const prevMonthEnd = new Date(
      monthStartUTC(today.getUTCFullYear(), today.getUTCMonth() + 1).getTime() - 1,
    );
    const periodLabel = periodKey(prevMonthStart); // e.g. "2026-03"

    let processed = 0;
    let skipped = 0;

    await this.tenantCron.forEachActiveTenant('fiscal-libro-iva-ventas', async (tenantId, tenant) => {
      const comprobantes = await this.prisma.client.comprobante.findMany({
        where: {
          status: 'Emitido',
          createdAt: { gte: prevMonthStart, lte: prevMonthEnd },
        },
        include: {
          issuer: {
            select: {
              cuit: true,
              businessName: true,
            },
          },
          payment: {
            select: { id: true },
          },
        },
        orderBy: [{ cbteTipo: 'asc' }, { numero: 'asc' }],
      });

      if (comprobantes.length === 0) {
        skipped++;
        return;
      }

      // ── Build Excel per RG 1415/2003 format ──────────────────────────────
      const buffer = await this.buildLibroIvaExcel(comprobantes, periodLabel, tenant.name);

      // ── Upload to S3 ──────────────────────────────────────────────────────
      const s3Key = `fiscal/${tenantId}/libro-iva-ventas/${periodLabel}.xlsx`;
      await this.s3.upload(s3Key, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const fileUrl = this.s3.getObjectUrl(s3Key);

      // ── Record in LibroIvaExport ──────────────────────────────────────────
      await this.prisma.client.libroIvaExport.create({
        data: {
          tenantId,
          period: periodLabel,
          rowCount: comprobantes.length,
          s3Key,
          fileUrl,
          generatedAt: new Date(),
        },
      });

      // ── Notify tenant admins ──────────────────────────────────────────────
      const admins = await findStaff(this.prisma, tenantId, MANAGEMENT_ROLES, { id: true });

      for (const admin of admins) {
        await this.notifications.createNotification({
          tenantId,
          userId: admin.id,
          type: 'LibroIvaGenerated',
          title: `Libro IVA Ventas generado — ${periodLabel}`,
          message: `El Libro IVA Ventas del período ${periodLabel} fue generado con ${comprobantes.length} comprobantes. Descargue el archivo en: ${fileUrl}`,
          entityType: 'LibroIvaExport',
          entityId: periodLabel,
        });
      }

      processed++;
      this.logger.log(
        `LibroIVA generated for tenantId=${tenantId} period=${periodLabel} rows=${comprobantes.length}`,
      );
    });

    this.logger.log(
      `generateLibroIvaVentas done in ${Date.now() - start}ms — processed=${processed}, skipped=${skipped}`,
    );
    return { processed, skipped };
  }

  /**
   * Build the Libro IVA Ventas Excel buffer per RG 1415/2003.
   * Columns: Fecha, Tipo, PtoVta, Número, DocTipo, DocNro, RazónSocial,
   *          ImpTotal, ImpNoGravado, ImpNeto, AlícuotaIVA, IVA, ImpTrib,
   *          CAE, Moneda, TipoCambio
   */
  private async buildLibroIvaExcel(
    comprobantes: any[],
    period: string,
    tenantName: string,
  ): Promise<Buffer> {
    const columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Tipo Cbte', key: 'tipo', width: 12, numeric: true },
      { header: 'Pto. Vta.', key: 'ptoVta', width: 10, numeric: true },
      { header: 'Número', key: 'numero', width: 12, numeric: true },
      { header: 'Doc. Tipo', key: 'docTipo', width: 10, numeric: true },
      { header: 'Doc. Nro.', key: 'docNro', width: 16 },
      { header: 'Razón Social', key: 'razonSocial', width: 35 },
      { header: 'Imp. Total', key: 'impTotal', width: 14, numeric: true },
      { header: 'Imp. No Gravado', key: 'impNoGravado', width: 16, numeric: true },
      { header: 'Imp. Neto', key: 'impNeto', width: 14, numeric: true },
      { header: 'Alíc. IVA', key: 'alicuotaIva', width: 12, numeric: true },
      { header: 'IVA', key: 'iva', width: 12, numeric: true },
      { header: 'Imp. Trib.', key: 'impTrib', width: 12, numeric: true },
      { header: 'CAE', key: 'cae', width: 16 },
      { header: 'Moneda', key: 'moneda', width: 8 },
      { header: 'Tipo Cambio', key: 'tipoCambio', width: 12, numeric: true },
    ];

    const rows = comprobantes.map((comp) => {
      const impTotal = new Decimal(comp.impTotal?.toString() ?? '0');
      const impNeto = new Decimal(comp.impNeto?.toString() ?? '0');
      const impIva = new Decimal(comp.impIva?.toString() ?? '0');
      const impTrib = new Decimal(comp.impTrib?.toString() ?? '0');
      // impExento maps to RG 1415/2003 "Imp. No Gravado" column
      const impNoGravado = new Decimal(comp.impExento?.toString() ?? '0');
      const monCotiz = new Decimal(comp.monCotiz?.toString() ?? '1');

      // Derive alícuota IVA from ivaArray if available, else from rate
      let alicuota = new Decimal(0);
      if (comp.ivaArray && Array.isArray(comp.ivaArray) && comp.ivaArray.length > 0) {
        const ivaEntry = comp.ivaArray[0];
        if (ivaEntry?.BaseImp && ivaEntry.BaseImp > 0) {
          alicuota = new Decimal(ivaEntry.Importe).div(new Decimal(ivaEntry.BaseImp)).mul(100).toDecimalPlaces(2);
        }
      }

      return {
        fecha: comp.createdAt ? formatDateAR(comp.createdAt) : '',
        tipo: comp.cbteTipo,
        ptoVta: comp.puntoDeVenta,
        numero: comp.numero,
        docTipo: comp.docTipo,
        docNro: comp.docNro ?? '',
        razonSocial: comp.issuer?.businessName ?? '',
        impTotal: impTotal.toDecimalPlaces(2).toNumber(),
        impNoGravado: impNoGravado.toDecimalPlaces(2).toNumber(),
        impNeto: impNeto.toDecimalPlaces(2).toNumber(),
        alicuotaIva: alicuota.toNumber(),
        iva: impIva.toDecimalPlaces(2).toNumber(),
        impTrib: impTrib.toDecimalPlaces(2).toNumber(),
        cae: comp.cae ?? '',
        moneda: comp.monId ?? 'PES',
        tipoCambio: monCotiz.toDecimalPlaces(4).toNumber(),
      };
    });

    const total = {
      values: {
        fecha: 'TOTAL',
        impTotal: comprobantes.reduce(
          (acc, c) => acc.plus(new Decimal(c.impTotal?.toString() ?? '0')), new Decimal(0),
        ).toDecimalPlaces(2).toNumber(),
        impNeto: comprobantes.reduce(
          (acc, c) => acc.plus(new Decimal(c.impNeto?.toString() ?? '0')), new Decimal(0),
        ).toDecimalPlaces(2).toNumber(),
        iva: comprobantes.reduce(
          (acc, c) => acc.plus(new Decimal(c.impIva?.toString() ?? '0')), new Decimal(0),
        ).toDecimalPlaces(2).toNumber(),
      },
    };

    return buildXlsx([{ name: `Libro IVA Ventas ${period}`, columns, rows, total }]);
  }
}
