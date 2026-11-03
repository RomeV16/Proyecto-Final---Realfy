import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BILL_AUTO_CONFIDENCE,
  BillChannel,
  BillDocumentStatus,
  type BillReviewReason,
  type FetchedBillData,
  type ParsedBillLine,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ServiceBillsService, defaultInstallmentLabel, parsePeriod } from '../services/service-bills.service';
import { BillDocumentStorage } from './bill-document-storage.service';
import { PdfTextService } from './pdf-text.service';
import { readBill } from './providers';

type Db = any;

/** Meses hacia atrás y hacia adelante respecto de hoy en que una boleta sigue siendo plausible. */
const PERIOD_WINDOW_MONTHS = 3;
/** Meses después del período en que el vencimiento deja de ser coherente. */
const MAX_DUE_MONTHS_AFTER_PERIOD = 6;

export interface IntakeInput {
  channel: BillChannel;
  /** Remitente del mail, nombre del archivo subido o clave del conector. */
  origin: string | null;
  fileName: string | null;
  content: Buffer;
}

export interface IntakeResult {
  document: { id: string; status: BillDocumentStatus; reason: string | null; billIds: string[] };
  /** El mismo contenido ya estaba guardado: no se procesó de nuevo. */
  duplicate: boolean;
}

/** Lo que decidió el circuito sobre un documento ya leído. */
interface Decision {
  status: BillDocumentStatus;
  reason: BillReviewReason | null;
  serviceId: string | null;
  /** Boletas nuevas a dar de alta (sólo con `Procesada`). */
  lines: ParsedBillLine[];
  /** Boletas que ya estaban cargadas con el mismo importe. */
  existingBillIds: string[];
}

const monthIndex = (period: string) => Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1;

const sha256Of = (content: Buffer | string) => createHash('sha256').update(content).digest('hex');

/**
 * Circuito único de las boletas (ADR-0018): documento, texto, proveedor por firmas,
 * lectura, servicio de la inmobiliaria, validaciones y alta. Toda boleta termina en
 * `ServiceBill` por el mismo servicio que la carga manual, así que el traslado al inquilino
 * (`ServiceBillAllocation`) sale igual. Si algo no cierra, el documento queda en revisión
 * con el motivo; nunca se pisa una boleta existente con otro importe.
 */
@Injectable()
export class BillIntakeService {
  private readonly logger = new Logger(BillIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: BillDocumentStorage,
    private readonly pdfText: PdfTextService,
    private readonly bills: ServiceBillsService,
  ) {}

  /** Un PDF entra al circuito. Idempotente por contenido: el mismo PDF devuelve el documento ya guardado. */
  async intake(input: IntakeInput, now: Date = new Date()): Promise<IntakeResult> {
    const tenantId = this.tenantContext.getTenantId()!;
    const sha256 = sha256Of(input.content);
    const existing = await this.prisma.client.billDocument.findFirst({ where: { sha256 }, include: { bills: { select: { id: true } } } });
    if (existing) return this.result(existing, true);

    const storageKey = this.storage.keyFor(tenantId, sha256);
    await this.storage.put(storageKey, input.content);

    let document: any;
    try {
      document = await this.prisma.client.billDocument.create({
        data: {
          tenantId,
          channel: input.channel,
          origin: input.origin,
          fileName: input.fileName,
          storageKey,
          sizeBytes: input.content.length,
          sha256,
          createdById: this.tenantContext.getUserId() ?? null,
        },
      });
    } catch (error) {
      // Dos pedidos con el mismo PDF a la vez: gana el primero.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.client.billDocument.findFirst({ where: { sha256 }, include: { bills: { select: { id: true } } } });
        if (winner) return this.result(winner, true);
      }
      throw error;
    }
    return this.process(document, input.content, now);
  }

  /** Un mensaje sin PDF adjunto: queda para revisión (idempotente por el identificador del mensaje). */
  async intakeWithoutAttachment(
    input: { channel: BillChannel; origin: string; messageKey: string; subject: string | null },
  ): Promise<IntakeResult> {
    const tenantId = this.tenantContext.getTenantId()!;
    const sha256 = sha256Of(`message:${input.messageKey}`);
    const existing = await this.prisma.client.billDocument.findFirst({ where: { sha256 }, include: { bills: { select: { id: true } } } });
    if (existing) return this.result(existing, true);
    try {
      const document = await this.prisma.client.billDocument.create({
        data: {
          tenantId,
          channel: input.channel,
          origin: input.origin,
          sha256,
          status: BillDocumentStatus.RequiereRevision,
          reason: 'NO_ATTACHMENT' satisfies BillReviewReason,
          data: { subject: input.subject } as Prisma.InputJsonValue,
        },
        include: { bills: { select: { id: true } } },
      });
      return this.result(document, false);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.client.billDocument.findFirst({ where: { sha256 }, include: { bills: { select: { id: true } } } });
        if (winner) return this.result(winner, true);
      }
      throw error;
    }
  }

  // ─── Procesar ───────────────────────────────────────

  private async process(document: any, content: Buffer, now: Date): Promise<IntakeResult> {
    let text: string;
    try {
      text = await this.pdfText.extract(content);
    } catch {
      return this.finish(document.id, { status: BillDocumentStatus.RequiereRevision, reason: 'UNREADABLE', serviceId: null, lines: [], existingBillIds: [] }, null);
    }
    if (text.trim() === '') {
      // Un escaneo es una imagen: sin texto no hay nada que leer (no se hace OCR).
      return this.finish(document.id, { status: BillDocumentStatus.RequiereRevision, reason: 'UNREADABLE', serviceId: null, lines: [], existingBillIds: [] }, null);
    }

    const read = readBill(text);
    try {
      const decision = await this.decide(read, now);
      return await this.finish(document.id, decision, read);
    } catch (error) {
      this.logger.error(`Bill document processing failed: documentId=${document.id} error=${(error as Error).message}`);
      // Una carrera con otra alta de la misma boleta o un fallo inesperado: una persona lo mira.
      const reason: BillReviewReason = isBillConflict(error) ? 'BILL_EXISTS_DIFFERENT_AMOUNT' : 'UNREADABLE';
      return this.finish(document.id, { status: BillDocumentStatus.RequiereRevision, reason, serviceId: null, lines: [], existingBillIds: [] }, read);
    }
  }

  private async decide(read: ReturnType<typeof readBill>, now: Date): Promise<Decision> {
    const review = (reason: BillReviewReason, serviceId: string | null = null): Decision => ({
      status: BillDocumentStatus.RequiereRevision,
      reason,
      serviceId,
      lines: [],
      existingBillIds: [],
    });
    const data = read.data;
    // Un documento que ningún proveedor reconoce nunca se da de alta solo; si la cuenta
    // coincide con un servicio, se le sugiere a quien revisa.
    if (!read.detected) {
      const suggested = data?.accountNumbers.length ? await this.matchService(null, data.accountNumbers) : null;
      return review('UNKNOWN_PROVIDER', suggested?.kind === 'one' ? suggested.serviceId : null);
    }
    if (!data || data.lines.length === 0) return review('UNREADABLE');
    if (data.accountNumbers.length === 0) return review('NO_ACCOUNT');

    const match = await this.matchService(read.providerKey, data.accountNumbers);
    if (match.kind === 'none') return review('NO_MATCHING_SERVICE');
    if (match.kind === 'many') return review('AMBIGUOUS_SERVICE');
    const serviceId = match.serviceId;
    if (data.confidence < BILL_AUTO_CONFIDENCE) return review('LOW_CONFIDENCE', serviceId);

    const problem = this.validate(data, now);
    if (problem) return review(problem, serviceId);

    const fresh: ParsedBillLine[] = [];
    const existingBillIds: string[] = [];
    for (const line of data.lines) {
      const existing = await this.findExisting(serviceId, line);
      if (!existing) fresh.push(line);
      else if (Number(existing.amount.toString()) === Number(line.amount)) existingBillIds.push(existing.id);
      else return review('BILL_EXISTS_DIFFERENT_AMOUNT', serviceId);
    }
    return {
      status: fresh.length === 0 ? BillDocumentStatus.Duplicada : BillDocumentStatus.Procesada,
      reason: null,
      serviceId,
      lines: fresh,
      existingBillIds,
    };
  }

  /** Reglas de plausibilidad: importe, período dentro de la ventana y vencimientos coherentes. */
  private validate(data: FetchedBillData, now: Date): BillReviewReason | null {
    const current = now.getUTCFullYear() * 12 + now.getUTCMonth();
    for (const line of data.lines) {
      if (!(Number(line.amount) > 0)) return 'INVALID_AMOUNT';
      if (Math.abs(monthIndex(line.period) - current) > PERIOD_WINDOW_MONTHS) return 'PERIOD_OUT_OF_RANGE';
      if (line.dueDate) {
        const dueMonth = monthIndex(line.dueDate);
        const periodMonth = monthIndex(line.period);
        if (dueMonth < periodMonth || dueMonth > periodMonth + MAX_DUE_MONTHS_AFTER_PERIOD) return 'DUE_DATE_INCONSISTENT';
        if (line.secondDueDate && line.secondDueDate < line.dueDate) return 'DUE_DATE_INCONSISTENT';
      }
    }
    return null;
  }

  /**
   * El servicio activo de la inmobiliaria con ese proveedor y esa cuenta. Sin proveedor
   * reconocido se busca por cuenta entre todos, sólo para sugerírselo a quien revisa.
   */
  async matchService(
    providerKey: string | null,
    accountNumbers: string[],
  ): Promise<{ kind: 'one'; serviceId: string } | { kind: 'many' } | { kind: 'none' }> {
    const services = await this.prisma.client.service.findMany({
      where: { isActive: true, accountNumber: { in: accountNumbers }, ...(providerKey ? { providerKey } : {}) },
      select: { id: true },
      take: 2,
    });
    if (services.length === 0) return { kind: 'none' };
    return services.length === 1 ? { kind: 'one', serviceId: services[0].id } : { kind: 'many' };
  }

  async findExisting(serviceId: string, line: ParsedBillLine, db: Db = this.prisma.client) {
    const period = parsePeriod(line.period);
    return db.serviceBill.findFirst({
      where: { serviceId, period, installmentLabel: line.installmentLabel ?? defaultInstallmentLabel(period) },
      select: { id: true, amount: true },
    });
  }

  /**
   * Da de alta las boletas y deja el documento en su estado final, todo en una transacción:
   * o quedan las boletas con su documento `Procesada` o no queda ninguna.
   */
  private async finish(documentId: string, decision: Decision, read: ReturnType<typeof readBill> | null): Promise<IntakeResult> {
    const data = read?.data ?? null;
    const billIds = await this.prisma.client.$transaction(async (tx: Db) => {
      const created: string[] = [];
      for (const line of decision.lines) {
        const bill = await this.bills.createAutomatic(tx, { serviceId: decision.serviceId!, documentId, ...toBillInput(line) });
        created.push(bill.id);
      }
      await tx.billDocument.update({
        where: { id: documentId },
        data: {
          status: decision.status,
          reason: decision.reason,
          serviceId: decision.serviceId,
          providerKey: read?.detected ? read.providerKey : null,
          accountNumber: data?.accountNumbers[0] ?? null,
          data: data ? (toStoredData(data) as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          confidence: data ? data.confidence : null,
          processedAt: decision.status === BillDocumentStatus.RequiereRevision ? null : new Date(),
        },
      });
      return created;
    });
    const document = await this.prisma.client.billDocument.findFirst({ where: { id: documentId }, include: { bills: { select: { id: true } } } });
    return { document: { id: documentId, status: decision.status, reason: decision.reason, billIds: document?.bills.map((b: { id: string }) => b.id) ?? billIds }, duplicate: false };
  }

  private result(document: any, duplicate: boolean): IntakeResult {
    return {
      document: {
        id: document.id,
        status: document.status,
        reason: document.reason,
        billIds: (document.bills ?? []).map((b: { id: string }) => b.id),
      },
      duplicate,
    };
  }
}

/** La boleta ya estaba cargada (otra alta se adelantó): índice único o conflicto del alta. */
function isBillConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2002';
  const response = (error as { getResponse?: () => { error?: string } }).getResponse?.();
  return response?.error === 'BILL_ALREADY_EXISTS';
}

/** La línea leída como la recibe el alta de boletas. */
export function toBillInput(line: ParsedBillLine) {
  return {
    period: line.period,
    installmentLabel: line.installmentLabel,
    amount: line.amount,
    nominalAmount: line.nominalAmount,
    dueDate: line.dueDate,
    consumption: line.consumption,
  };
}

/** Lo que se guarda de la lectura: sin nombres ni domicilios, sólo lo que alimenta la boleta. */
export function toStoredData(data: FetchedBillData) {
  return {
    providerKey: data.providerKey,
    accountNumbers: data.accountNumbers,
    issueDate: data.issueDate,
    lines: data.lines,
    warnings: data.warnings,
  };
}
