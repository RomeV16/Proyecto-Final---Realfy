import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FiscalCondition,
  LessorInvoiceWhen,
  LessorInvoiceJobFilterSchema,
  LessorInvoicingOverrideSchema,
  LessorIssuerCreateSchema,
  OwnerStatementStatus,
  SCOPE_ENTRY_TYPES,
  canIssueFiscalInvoice,
  lessorInvoiceAmount,
  personName,
  resolveComprobanteType,
  resolveInvoicingSettings,
  splitVatIncluded,
  todayInAR,
} from '@realfy/shared';
import type { EmitInvoiceDto, InvoicingSettings, LessorInvoicingOverride } from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { FISCAL_CONDITION_TO_ARCA } from './arca/arca.service';
import { InvoicesService } from './invoices.service';
import { IssuersService } from './issuers.service';
import { creditNoteRequestId, invoiceRequestId } from './lessor-invoice-queue';
import type { LessorInvoiceSourceType } from './lessor-invoice-queue';

type Db = any;

/** Intentos automáticos de un trabajo fallido antes de dejarlo para una persona. */
export const MAX_AUTO_ATTEMPTS = 5;
/** Cuánto hacia atrás mira la facturación automática, como tope, para no facturar historia vieja. */
const AUTO_LOOKBACK_DAYS = 60;
const BATCH = 50;

/** Alícuota de IVA de ARCA (Id) por porcentaje. */
const VAT_ID: Record<number, number> = { 0: 3, 2.5: 9, 5: 8, 10.5: 4, 21: 5, 27: 6 };

const AUTO_WHEN: string[] = [LessorInvoiceWhen.AlPagar, LessorInvoiceWhen.AlEmitirEstado];

export interface JobResult {
  jobId: string;
  personId: string;
  sourceType: string;
  sourceId: string;
  kind: string;
  status: string;
  comprobanteIds: string[];
  error?: string;
}

/** Lo que se guarda en `arca_issuers.invoicingSettings`: lo que definió el locador y desde cuándo factura solo. */
interface StoredSettings extends LessorInvoicingOverride {
  autoSince?: string;
}

const conflict = (error: string, message: string) => new ConflictException({ error, message });
const badRequest = (error: string, message: string) => new BadRequestException({ error, message });
const notFound = (error: string, message: string) => new NotFoundException({ error, message });

/** Un error de ARCA llega como excepción con `errorCode`; el resto, con su mensaje. */
function describeError(err: unknown): string {
  const e = err as any;
  const body = typeof e?.getResponse === 'function' ? e.getResponse() : null;
  const code = body?.errorCode ?? body?.error ?? e?.code ?? null;
  const message = body?.message ?? e?.message ?? 'Unknown error';
  return `${code ? `${code}: ` : ''}${Array.isArray(message) ? message.join('; ') : message}`.slice(0, 500);
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Facturación por cuenta del locador (ADR-0017): la inmobiliaria emite, con la delegación ARCA
 * del locador, la factura del alquiler a nombre de él. Una cola (`LessorInvoiceJob`) por origen
 * (cobro o estado de cuenta), locador y tipo guarda el trabajo: un fallo de ARCA no rompe el cobro
 * ni el estado, y emitir dos veces el mismo trabajo no factura dos veces.
 */
@Injectable()
export class LessorInvoicingService {
  private readonly logger = new Logger(LessorInvoicingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly invoices: InvoicesService,
    private readonly issuers: IssuersService,
    private readonly operationalDefaults: OperationalDefaultsService,
    private readonly audit: AuditService,
  ) {}

  private get tenantId(): string {
    return this.tenantContext.getTenantId()!;
  }

  // ─── Emisor delegado y configuración del locador ──────────────────────────

  /** Estado de la facturación de un locador: su emisor delegado, lo que definió y lo que rige. */
  async getSettings(personId: string) {
    const person = await this.requirePerson(personId);
    const issuer = await this.findIssuer(personId);
    const agency = (await this.operationalDefaults.get(this.tenantId)).invoicing;
    const stored = this.storedOf(issuer);
    return {
      person: { id: person.id, name: personName(person), cuit: person.cuit, fiscalCondition: person.fiscalCondition },
      issuer: issuer
        ? {
            id: issuer.id,
            cuit: issuer.cuit,
            businessName: issuer.businessName,
            fiscalCondition: issuer.fiscalCondition,
            delegationStatus: issuer.delegationStatus,
            delegationVerifiedAt: issuer.delegationVerifiedAt,
            delegationLastError: issuer.delegationLastError,
            isActive: issuer.isActive,
            puntosDeVenta: issuer.puntosDeVenta ?? [],
          }
        : null,
      override: stored ? this.publicOverride(stored) : null,
      autoSince: stored?.autoSince ?? null,
      agencyDefaults: agency,
      effective: resolveInvoicingSettings(agency, stored),
    };
  }

  /** Alta (o reactivación) del emisor delegado de un locador con los datos de la persona. */
  async createIssuer(personId: string, body: unknown) {
    const data = parseOrThrow(LessorIssuerCreateSchema, body ?? {}, 'Invalid issuer data');
    const person = await this.requirePerson(personId);
    if (!person.cuit) throw badRequest('PERSON_CUIT_REQUIRED', 'The lessor needs a CUIT to invoice on their behalf');
    if (!person.fiscalCondition) {
      throw badRequest('PERSON_FISCAL_CONDITION_REQUIRED', 'The lessor needs a tax condition to invoice on their behalf');
    }
    if (!canIssueFiscalInvoice(person.fiscalCondition as FiscalCondition)) {
      throw badRequest('FISCAL_CONDITION_CANNOT_INVOICE', `A ${person.fiscalCondition} cannot issue invoices`);
    }
    const existing = await this.findIssuer(personId, false);
    if (existing?.isActive) throw conflict('LESSOR_ISSUER_EXISTS', 'The lessor already has a delegated issuer');
    const issuerData = {
      cuit: person.cuit,
      businessName: personName(person),
      fiscalCondition: person.fiscalCondition as FiscalCondition,
      ...data,
    };
    if (existing) {
      return this.prisma.client.arcaIssuer.update({
        where: { id: existing.id },
        data: { ...issuerData, isActive: true, delegationStatus: 'Pending', delegationLastError: null },
        include: { puntosDeVenta: true },
      });
    }
    return this.issuers.createIssuer(issuerData, personId);
  }

  /** Guarda lo que define el locador (cada campo vacío vuelve al valor de la inmobiliaria). */
  async saveSettings(personId: string, body: unknown) {
    const input = parseOrThrow(LessorInvoicingOverrideSchema, body ?? {}, 'Invalid invoicing settings');
    await this.requirePerson(personId);
    const issuer = await this.findIssuer(personId);
    if (!issuer) throw conflict('LESSOR_ISSUER_REQUIRED', 'Create the delegated issuer of the lessor first');
    const agency = (await this.operationalDefaults.get(this.tenantId)).invoicing;
    const before = this.storedOf(issuer);
    const next: StoredSettings = {};
    if (input.scope) next.scope = input.scope;
    if (input.when) next.when = input.when;
    if (input.vatPct !== undefined && input.vatPct !== null) next.vatPct = input.vatPct;
    const wasAuto = AUTO_WHEN.includes(resolveInvoicingSettings(agency, before).when);
    const isAuto = AUTO_WHEN.includes(resolveInvoicingSettings(agency, next).when);
    // Desde cuándo factura solo: no se factura lo anterior a activarlo.
    if (isAuto) next.autoSince = wasAuto && before?.autoSince ? before.autoSince : new Date().toISOString();
    await this.prisma.client.arcaIssuer.update({
      where: { id: issuer.id },
      data: { invoicingSettings: Object.keys(next).length > 0 ? (next as any) : null },
    });
    await this.audit.record(this.prisma.client, {
      action: 'UPDATE',
      entity: 'ArcaIssuer',
      entityId: issuer.id,
      before: before ?? null,
      after: next,
      metadata: { operation: 'lessor-invoicing-settings', personId },
    });
    return this.getSettings(personId);
  }

  // ─── Emisión manual ───────────────────────────────────────────────────────

  /** Factura un cobro por cuenta de cada locador con emisor delegado (o del indicado). */
  async invoicePayment(paymentId: string, body: { personId?: string } = {}) {
    const payment = await this.prisma.client.payment.findFirst({ where: { id: paymentId }, select: { id: true } });
    if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    return this.invoiceSource('Payment', paymentId, body.personId);
  }

  /** Factura un estado de cuenta emitido por cuenta de su locador. */
  async invoiceStatement(statementId: string) {
    const statement = await this.prisma.client.ownerStatement.findFirst({
      where: { id: statementId },
      select: { id: true, personId: true, status: true },
    });
    if (!statement) throw notFound('STATEMENT_NOT_FOUND', 'Owner statement not found');
    if (statement.status !== OwnerStatementStatus.Emitido && statement.status !== OwnerStatementStatus.Enviado) {
      throw conflict('STATEMENT_NOT_ISSUED', 'Only an issued statement can be invoiced');
    }
    return this.invoiceSource('OwnerStatement', statementId, statement.personId);
  }

  /** Comprobantes y trabajos de un cobro o de un estado de cuenta. */
  async listForSource(sourceType: LessorInvoiceSourceType, sourceId: string) {
    const [comprobantes, jobs] = await Promise.all([
      this.prisma.client.comprobante.findMany({
        where: sourceType === 'Payment' ? { paymentId: sourceId } : { ownerStatementId: sourceId },
        include: { issuer: { select: { id: true, cuit: true, businessName: true, personId: true } }, creditNotes: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.client.lessorInvoiceJob.findMany({
        where: { tenantId: this.tenantId, sourceType, sourceId },
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);
    return { comprobantes, jobs };
  }

  private async invoiceSource(sourceType: LessorInvoiceSourceType, sourceId: string, personId?: string) {
    const agency = (await this.operationalDefaults.get(this.tenantId)).invoicing;
    const lessorIds = personId ? [personId] : await this.lessorsOf(sourceType, sourceId);
    const results: JobResult[] = [];
    for (const id of lessorIds) {
      const issuer = await this.findIssuer(id);
      if (!issuer) {
        if (personId) throw conflict('LESSOR_ISSUER_REQUIRED', 'The lessor has no delegated issuer');
        continue;
      }
      const settings = resolveInvoicingSettings(agency, this.storedOf(issuer));
      // Con una de las dos vías automáticas, la otra no factura: evita facturar dos veces lo mismo.
      const other =
        sourceType === 'Payment' ? LessorInvoiceWhen.AlEmitirEstado : LessorInvoiceWhen.AlPagar;
      if (settings.when === other) {
        throw conflict(
          'INVOICING_TRIGGER_MISMATCH',
          `This lessor is invoiced ${settings.when === LessorInvoiceWhen.AlPagar ? 'on payment' : 'on statement issue'}`,
        );
      }
      const job = await this.ensureJob(sourceType, sourceId, id, 'Factura', false);
      results.push(await this.process(job.id, true));
    }
    const failed = results.find((r) => r.status === 'Fallido');
    if (failed) {
      throw new UnprocessableEntityException({
        error: 'LESSOR_INVOICE_FAILED',
        message: failed.error,
        results,
      });
    }
    return { results };
  }

  // ─── Cola ─────────────────────────────────────────────────────────────────

  /** Trabajos de la cola (pendientes y fallidos por defecto). */
  async listJobs(query: unknown) {
    const filters = parseOrThrow(LessorInvoiceJobFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = { tenantId: this.tenantId };
    if (filters.status) where.status = filters.status;
    else where.status = { in: ['Pendiente', 'Fallido'] };
    if (filters.personId) where.personId = filters.personId;
    const [items, total] = await Promise.all([
      this.prisma.client.lessorInvoiceJob.findMany({
        where,
        include: { person: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.lessorInvoiceJob.count({ where }),
    ]);
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /**
   * Pone en cola lo que la configuración de cada locador manda facturar solo y emite lo pendiente.
   * Lo corre el proceso programado y `POST /invoices/pending/run`. `retryAll` también reintenta
   * los que ya agotaron los intentos automáticos.
   */
  async runPending(options: { retryAll?: boolean; personId?: string } = {}) {
    const enqueued = await this.enqueueAuto();
    const statuses = ['Pendiente', 'Fallido'];
    const where: Record<string, unknown> = {
      tenantId: this.tenantId,
      status: { in: statuses },
      ...(options.retryAll ? {} : { attempts: { lt: MAX_AUTO_ATTEMPTS } }),
      ...(options.personId ? { personId: options.personId } : {}),
    };
    const jobs = await this.prisma.client.lessorInvoiceJob.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: BATCH,
    });
    const results: JobResult[] = [];
    for (const job of jobs) {
      try {
        results.push(await this.process(job.id, false));
      } catch (err) {
        // Un trabajo que desapareció o falló fuera de la emisión no corta a los demás.
        this.logger.warn(`Lessor invoice job ${job.id} skipped: ${describeError(err)}`);
      }
    }
    return {
      enqueued,
      processed: results.length,
      emitted: results.filter((r) => r.status === 'Emitido').length,
      skipped: results.filter((r) => r.status === 'Omitido').length,
      failed: results.filter((r) => r.status === 'Fallido').length,
      results,
    };
  }

  /** Deja en cola los cobros y estados nuevos de los locadores con facturación automática. */
  async enqueueAuto(): Promise<number> {
    const tenantId = this.tenantId;
    const agency = (await this.operationalDefaults.get(tenantId)).invoicing;
    const issuers = await this.prisma.client.arcaIssuer.findMany({
      where: { tenantId, personId: { not: null }, isActive: true, delegationStatus: 'Active' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const floor = Date.now() - AUTO_LOOKBACK_DAYS * 86_400_000;
    let created = 0;
    for (const issuer of issuers) {
      const stored = this.storedOf(issuer);
      const settings = resolveInvoicingSettings(agency, stored);
      if (!AUTO_WHEN.includes(settings.when)) continue;
      const since = new Date(Math.max(floor, new Date(stored?.autoSince ?? issuer.createdAt).getTime()));
      const personId = issuer.personId!;
      let sources: string[] = [];
      let sourceType: LessorInvoiceSourceType;
      if (settings.when === LessorInvoiceWhen.AlPagar) {
        sourceType = 'Payment';
        const rows = await this.prisma.client.ownerLedgerEntry.findMany({
          where: {
            tenantId,
            personId,
            sourceType: 'Payment',
            type: { in: [...SCOPE_ENTRY_TYPES[settings.scope]] as any },
            createdAt: { gte: since },
          },
          select: { sourceId: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 500,
        });
        sources = [...new Set<string>(rows.map((r: { sourceId: string }) => r.sourceId))];
      } else {
        sourceType = 'OwnerStatement';
        const rows = await this.prisma.client.ownerStatement.findMany({
          where: { tenantId, personId, status: { in: ['Emitido', 'Enviado'] }, issuedAt: { gte: since } },
          select: { id: true },
          orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
          take: 500,
        });
        sources = rows.map((r: { id: string }) => r.id);
      }
      if (sources.length === 0) continue;
      const result = await this.prisma.client.lessorInvoiceJob.createMany({
        data: sources.map((sourceId) => ({ tenantId, personId, sourceType, sourceId, kind: 'Factura' as const, auto: true })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    return created;
  }

  // ─── Procesamiento de un trabajo ──────────────────────────────────────────

  private async ensureJob(
    sourceType: LessorInvoiceSourceType,
    sourceId: string,
    personId: string,
    kind: 'Factura' | 'NotaCredito',
    auto: boolean,
  ) {
    const tenantId = this.tenantId;
    const where = { tenantId_sourceType_sourceId_personId_kind: { tenantId, sourceType, sourceId, personId, kind } };
    const found = await this.prisma.client.lessorInvoiceJob.findUnique({ where });
    if (found) return found;
    try {
      return await this.prisma.client.lessorInvoiceJob.create({
        data: { tenantId, sourceType, sourceId, personId, kind, auto },
      });
    } catch (err) {
      // Otro pedido lo creó en el mismo instante.
      const again = await this.prisma.client.lessorInvoiceJob.findUnique({ where });
      if (again) return again;
      throw err;
    }
  }

  /**
   * Emite un trabajo. Lo reclama de a uno (si otro proceso lo tomó antes, no hace nada) y deja el
   * resultado en el trabajo: `Emitido`, `Omitido` (nada para facturar) o `Fallido` con el motivo.
   */
  async process(jobId: string, includeDone: boolean): Promise<JobResult> {
    const job = await this.prisma.client.lessorInvoiceJob.findFirst({ where: { id: jobId } });
    if (!job) throw notFound('JOB_NOT_FOUND', 'Invoice job not found');
    if (job.status === 'Emitido' || job.status === 'Omitido') {
      return this.resultOf(job, includeDone ? await this.comprobantesOf(job) : []);
    }
    const claim = await this.prisma.client.lessorInvoiceJob.updateMany({
      where: { id: job.id, updatedAt: job.updatedAt, status: { in: ['Pendiente', 'Fallido'] } },
      data: { attempts: { increment: 1 }, lastAttemptAt: new Date() },
    });
    if (claim.count === 0) return this.resultOf(job, []);
    let outcome: { status: 'Emitido' | 'Omitido'; ids: string[]; note?: string };
    try {
      outcome = job.kind === 'Factura' ? await this.emitInvoices(job) : await this.emitCreditNotes(job);
    } catch (err) {
      const error = describeError(err);
      this.logger.warn(`Lessor invoice job ${job.id} failed: ${error}`);
      const failed = await this.prisma.client.lessorInvoiceJob.update({
        where: { id: job.id },
        data: { status: 'Fallido', lastError: error },
      });
      return { ...this.resultOf(failed, []), error };
    }
    const done = await this.prisma.client.lessorInvoiceJob.update({
      where: { id: job.id },
      data: { status: outcome.status, comprobanteId: outcome.ids[0] ?? null, lastError: outcome.note ?? null },
    });
    if (outcome.ids.length > 0) {
      await this.audit.record(this.prisma.client, {
        action: 'CREATE',
        entity: 'Comprobante',
        entityId: outcome.ids[0],
        after: { jobId: job.id, comprobanteIds: outcome.ids },
        metadata: {
          operation: job.kind === 'Factura' ? 'lessor-invoice-emit' : 'lessor-credit-note-emit',
          personId: job.personId,
          sourceType: job.sourceType,
          sourceId: job.sourceId,
          auto: job.auto,
        },
      });
    }
    return this.resultOf(done, outcome.ids);
  }

  private resultOf(job: any, comprobanteIds: string[]): JobResult {
    return {
      jobId: job.id,
      personId: job.personId,
      sourceType: job.sourceType,
      sourceId: job.sourceId,
      kind: job.kind,
      status: job.status,
      comprobanteIds,
      ...(job.lastError && job.status !== 'Emitido' ? { error: job.lastError } : {}),
    };
  }

  private async comprobantesOf(job: any): Promise<string[]> {
    const rows = await this.prisma.client.comprobante.findMany({
      where: {
        issuer: { personId: job.personId },
        ...(job.sourceType === 'Payment' ? { paymentId: job.sourceId } : { ownerStatementId: job.sourceId }),
        type: { in: job.kind === 'Factura' ? FACTURA_TYPES : NC_TYPES },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r: { id: string }) => r.id);
  }

  /** Las facturas del locador por un origen: una por contrato, con el importe exacto de su parte. */
  private async emitInvoices(job: any): Promise<{ status: 'Emitido' | 'Omitido'; ids: string[]; note?: string }> {
    const tenantId = this.tenantId;
    const issuer = await this.findIssuer(job.personId);
    if (!issuer) throw conflict('LESSOR_ISSUER_REQUIRED', 'The lessor has no delegated issuer');
    const agency = (await this.operationalDefaults.get(tenantId)).invoicing;
    const settings = resolveInvoicingSettings(agency, this.storedOf(issuer));
    const source = await this.loadSource(job);
    const entries = await this.prisma.client.ownerLedgerEntry.findMany({
      where: {
        tenantId,
        personId: job.personId,
        type: { in: [...SCOPE_ENTRY_TYPES[settings.scope]] as any },
        ...(job.sourceType === 'Payment'
          ? { sourceType: 'Payment', sourceId: job.sourceId }
          : { statementId: job.sourceId }),
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const byContract = new Map<string, any[]>();
    for (const entry of entries) {
      const key = entry.contractId ?? '';
      byContract.set(key, [...(byContract.get(key) ?? []), entry]);
    }
    const ids: string[] = [];
    const puntoDeVenta = await this.invoices.resolvePuntoDeVenta(issuer.id);
    for (const [contractId, group] of [...byContract.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const total = lessorInvoiceAmount(group, settings.scope);
      if (!total.isPositive()) continue;
      if (!contractId) throw badRequest('NO_CONTRACT', 'The amount to invoice has no contract (no recipient)');
      const currency = group[0].currency;
      if (currency !== 'ARS') {
        throw badRequest('CURRENCY_NOT_SUPPORTED', `Invoicing in ${currency} needs an exchange rate and is not supported yet`);
      }
      const dto = await this.buildInvoice({ issuer, settings, job, contractId, total, source, puntoDeVenta });
      const { comprobante } = await this.invoices.emitFromDto(dto);
      ids.push(comprobante.id);
    }
    if (ids.length === 0) return { status: 'Omitido', ids, note: 'NOTHING_TO_INVOICE' };
    return { status: 'Emitido', ids };
  }

  private async buildInvoice(args: {
    issuer: any;
    settings: InvoicingSettings;
    job: any;
    contractId: string;
    total: any;
    source: { period: Date };
    puntoDeVenta: number;
  }): Promise<EmitInvoiceDto> {
    const { issuer, settings, job, contractId, total, source, puntoDeVenta } = args;
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      include: { persons: { include: { person: true } }, property: { select: { title: true } } },
    });
    if (!contract) throw notFound('CONTRACT_NOT_FOUND', 'Contract not found');
    const tenantParty = (contract.persons ?? [])
      .filter((p: any) => p.role === 'Inquilino')
      .sort((a: any, b: any) => a.id.localeCompare(b.id))[0];
    if (!tenantParty) throw badRequest('TENANT_PARTY_REQUIRED', 'The contract has no tenant to invoice');
    const receptor = tenantParty.person;
    const receptorCondition = (receptor.fiscalCondition ?? FiscalCondition.ConsumidorFinal) as FiscalCondition;
    let resolution;
    try {
      resolution = resolveComprobanteType(issuer.fiscalCondition as FiscalCondition, receptorCondition);
    } catch (err) {
      throw badRequest('FISCAL_CONDITION_CANNOT_INVOICE', (err as Error).message);
    }
    const { neto, iva, vatPct } = splitVatIncluded(total, settings.vatPct, resolution.letra);
    const cuit = receptor.cuit?.replace(/\D/g, '');
    const dni = receptor.dni?.replace(/\D/g, '');
    const doc = cuit ? { docTipo: 80, docNro: cuit } : dni ? { docTipo: 96, docNro: dni } : { docTipo: 99, docNro: '0' };
    // Una factura A o B a un consumidor sin documento no es válida: se exige CUIT del receptor.
    if (resolution.letra === 'A' && doc.docTipo !== 80) {
      throw badRequest('RECEPTOR_CUIT_REQUIRED', 'An A invoice needs the CUIT of the tenant');
    }
    const first = new Date(Date.UTC(source.period.getUTCFullYear(), source.period.getUTCMonth(), 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const today = isoDay(todayInAR());
    const label = contract.property?.title ? ` - ${contract.property.title}` : '';
    return {
      issuerId: issuer.id,
      ptoVta: puntoDeVenta,
      cbteTipo: resolution.cbteTipo,
      concepto: 2,
      cbteFch: today,
      receptor: {
        ...doc,
        businessName: personName(receptor) || 'Consumidor Final',
        fiscalCondition: receptorCondition,
        condicionIVAReceptorId: FISCAL_CONDITION_TO_ARCA[receptorCondition] ?? 5,
      },
      impTotal: total.toFixed(2),
      impTotConc: '0',
      impNeto: neto.toFixed(2),
      impOpEx: '0',
      impTrib: '0',
      impIVA: iva.toFixed(2),
      monId: 'PES',
      monCotiz: '1',
      iva:
        resolution.letra === 'C'
          ? undefined
          : [{ id: VAT_ID[vatPct] ?? 3, baseImp: neto.toFixed(2), importe: iva.toFixed(2) }],
      fchServDesde: isoDay(first),
      fchServHasta: isoDay(last),
      fchVtoPago: today,
      ...(job.sourceType === 'Payment' ? { paymentId: job.sourceId } : { ownerStatementId: job.sourceId }),
      description: `Alquiler ${isoDay(first).slice(0, 7)}${label}`.slice(0, 500),
      clientRequestId: invoiceRequestId(job.sourceType, job.sourceId, job.personId, contractId),
    };
  }

  /** Notas de crédito de las facturas del origen que no tienen una. */
  private async emitCreditNotes(job: any): Promise<{ status: 'Emitido' | 'Omitido'; ids: string[]; note?: string }> {
    const originals = await this.prisma.client.comprobante.findMany({
      where: {
        issuer: { personId: job.personId },
        ...(job.sourceType === 'Payment' ? { paymentId: job.sourceId } : { ownerStatementId: job.sourceId }),
        type: { in: FACTURA_TYPES },
      },
      include: { creditNotes: { select: { id: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const ids: string[] = [];
    for (const original of originals) {
      if (original.creditNotes.length > 0) {
        ids.push(original.creditNotes[0].id);
        continue;
      }
      const nc = await this.invoices.voidComprobante(original.id, { clientRequestId: creditNoteRequestId(original.id) });
      ids.push(nc.id);
    }
    if (ids.length === 0) return { status: 'Omitido', ids, note: 'NOTHING_TO_CREDIT' };
    return { status: 'Emitido', ids };
  }

  // ─── Lecturas internas ────────────────────────────────────────────────────

  private async loadSource(job: any): Promise<{ period: Date }> {
    if (job.sourceType === 'Payment') {
      const payment = await this.prisma.client.payment.findFirst({
        where: { id: job.sourceId },
        include: { liquidacion: { select: { period: true } } },
      });
      if (!payment) throw notFound('PAYMENT_NOT_FOUND', 'Payment not found');
      return { period: payment.liquidacion.period };
    }
    const statement = await this.prisma.client.ownerStatement.findFirst({ where: { id: job.sourceId } });
    if (!statement) throw notFound('STATEMENT_NOT_FOUND', 'Owner statement not found');
    if (statement.status !== OwnerStatementStatus.Emitido && statement.status !== OwnerStatementStatus.Enviado) {
      throw conflict('STATEMENT_NOT_ISSUED', 'Only an issued statement can be invoiced');
    }
    return { period: statement.period };
  }

  /** Locadores con asientos de un cobro (los que se facturan por su cuenta). */
  private async lessorsOf(sourceType: LessorInvoiceSourceType, sourceId: string): Promise<string[]> {
    if (sourceType === 'OwnerStatement') {
      const statement = await this.prisma.client.ownerStatement.findFirst({ where: { id: sourceId }, select: { personId: true } });
      return statement ? [statement.personId] : [];
    }
    const rows = await this.prisma.client.ownerLedgerEntry.findMany({
      where: { tenantId: this.tenantId, sourceType: 'Payment', sourceId },
      select: { personId: true },
      orderBy: { personId: 'asc' },
    });
    return [...new Set<string>(rows.map((r: { personId: string }) => r.personId))];
  }

  private async requirePerson(personId: string) {
    const person = await this.prisma.client.person.findFirst({ where: { id: personId, tenantId: this.tenantId } });
    if (!person) throw notFound('PERSON_NOT_FOUND', 'Person not found');
    return person;
  }

  private async findIssuer(personId: string, activeOnly = true) {
    return this.prisma.client.arcaIssuer.findFirst({
      where: { tenantId: this.tenantId, personId, ...(activeOnly ? { isActive: true } : {}) },
      include: { puntosDeVenta: { orderBy: { number: 'asc' } } },
    });
  }

  private storedOf(issuer: { invoicingSettings: unknown } | null): StoredSettings | null {
    const raw = issuer?.invoicingSettings;
    if (!raw || typeof raw !== 'object') return null;
    return raw as StoredSettings;
  }

  private publicOverride(stored: StoredSettings): LessorInvoicingOverride {
    const { scope, when, vatPct } = stored;
    return { scope, when, vatPct };
  }
}

const FACTURA_TYPES: any[] = ['FacturaA', 'FacturaB', 'FacturaC'];
const NC_TYPES: any[] = ['NotaCreditoA', 'NotaCreditoB', 'NotaCreditoC'];
