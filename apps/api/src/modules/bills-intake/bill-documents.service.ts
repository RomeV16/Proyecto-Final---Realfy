import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AcceptBillDocumentSchema,
  BillDocumentFilterSchema,
  BillDocumentStatus,
  RejectBillDocumentSchema,
  type ParsedBillLine,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { ServiceBillsService } from '../services/service-bills.service';
import { BillDocumentStorage } from './bill-document-storage.service';
import { BillIntakeService, toBillInput } from './bill-intake.service';

type Db = any;

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });
const badRequest = (error: string, message: string) => new BadRequestException({ error, message });

/** Lo que el circuito guardó de la lectura de un documento. */
interface StoredBillData {
  lines?: ParsedBillLine[];
}

const LIST_SELECT = {
  id: true,
  channel: true,
  origin: true,
  fileName: true,
  sizeBytes: true,
  providerKey: true,
  accountNumber: true,
  confidence: true,
  status: true,
  reason: true,
  serviceId: true,
  createdAt: true,
  processedAt: true,
  reviewedAt: true,
  reviewedById: true,
  service: { select: { id: true, serviceType: true, providerName: true, propertyId: true } },
  _count: { select: { bills: true } },
} as const;

/** Documentos de boletas: la cola de revisión y su historia (ADR-0018). */
@Injectable()
export class BillDocumentsService {
  private readonly logger = new Logger(BillDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly storage: BillDocumentStorage,
    private readonly intake: BillIntakeService,
    private readonly bills: ServiceBillsService,
  ) {}

  async list(query: unknown) {
    const filters = parseOrThrow(BillDocumentFilterSchema, query, 'Invalid filter parameters');
    const where = {
      ...(filters.status && { status: filters.status }),
      ...(filters.channel && { channel: filters.channel }),
      ...(filters.providerKey && { providerKey: filters.providerKey }),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.billDocument.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.billDocument.count({ where }),
    ]);
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  /** El documento con lo que se leyó de él y las boletas que dio de alta. */
  async get(id: string) {
    const { storageKey, ...document } = await this.require(id);
    return { ...document, hasFile: storageKey !== null };
  }

  /** Enlace temporal al PDF original. */
  async fileUrl(id: string) {
    const document = await this.require(id);
    if (!document.storageKey) throw notFound('DOCUMENT_FILE_NOT_FOUND', 'The document has no file');
    return { url: await this.storage.urlFor(document.storageKey), expiresInSeconds: 600 };
  }

  /**
   * Acepta un documento en revisión: da de alta lo leído, con las correcciones que
   * haga falta, y lo deja `Procesada`. Las correcciones de período, cuota, importe o
   * vencimiento valen para un documento de una sola boleta. No pisa una boleta
   * existente con otro importe: 409 `BILL_ALREADY_EXISTS`.
   */
  async accept(id: string, body: unknown) {
    const input = parseOrThrow(AcceptBillDocumentSchema, body, 'Invalid acceptance data');
    const document = await this.require(id);
    if (document.status !== BillDocumentStatus.RequiereRevision) {
      throw conflict('DOCUMENT_NOT_REVIEWABLE', 'Only a document pending review can be accepted');
    }

    const lines = this.linesToAccept(document.data as StoredBillData | null, input);
    const serviceId = input.serviceId ?? document.serviceId;
    if (!serviceId) throw badRequest('SERVICE_REQUIRED', 'Choose the service the bill belongs to');
    if (lines.some((line) => !(Number(line.amount) > 0))) throw badRequest('INVALID_AMOUNT', 'The amount must be greater than zero');

    const userId = this.tenantContext.getUserId() ?? null;
    await this.prisma.client.$transaction(async (tx: Db) => {
      let created = 0;
      for (const line of lines) {
        const existing = await this.intake.findExisting(serviceId, line, tx);
        if (!existing) {
          await this.bills.createAutomatic(tx, { serviceId, documentId: id, ...toBillInput(line) });
          created++;
        } else if (Number(existing.amount.toString()) !== Number(line.amount)) {
          throw conflict('BILL_ALREADY_EXISTS', 'A bill with another amount is already loaded for that service, period and installment');
        }
      }
      const now = new Date();
      await tx.billDocument.update({
        where: { id },
        data: {
          status: created > 0 ? BillDocumentStatus.Procesada : BillDocumentStatus.Duplicada,
          reason: null,
          serviceId,
          reviewedById: userId,
          reviewedAt: now,
          processedAt: now,
        },
      });
    });
    return this.get(id);
  }

  /** Descarta un documento en revisión (o recién recibido) con el motivo. */
  async reject(id: string, body: unknown) {
    const input = parseOrThrow(RejectBillDocumentSchema, body, 'Invalid rejection data');
    const document = await this.require(id);
    if (document.status !== BillDocumentStatus.RequiereRevision && document.status !== BillDocumentStatus.Recibida) {
      throw conflict('DOCUMENT_NOT_REVIEWABLE', 'Only a document pending review can be rejected');
    }
    const now = new Date();
    await this.prisma.client.billDocument.update({
      where: { id },
      data: {
        status: BillDocumentStatus.Rechazada,
        reason: input.reason,
        reviewedById: this.tenantContext.getUserId() ?? null,
        reviewedAt: now,
        processedAt: now,
      },
    });
    this.logger.log(`Bill document rejected: documentId=${id}`);
    return this.get(id);
  }

  /** Las boletas que se dan de alta: lo leído con las correcciones aplicadas. */
  private linesToAccept(
    stored: StoredBillData | null,
    input: { period?: string; installmentLabel?: string; amount?: string; dueDate?: string | null },
  ): ParsedBillLine[] {
    const lines = stored?.lines ?? [];
    const corrects =
      input.period !== undefined || input.installmentLabel !== undefined || input.amount !== undefined || input.dueDate !== undefined;
    if (lines.length > 1 && corrects) {
      throw badRequest('CORRECTIONS_NEED_SINGLE_BILL', 'Corrections apply to a document with a single bill');
    }
    if (lines.length === 0 && (!input.period || !input.amount)) {
      throw badRequest('NOTHING_TO_ACCEPT', 'The document has no bill to accept: period and amount are required');
    }
    const base: ParsedBillLine = lines[0] ?? {
      period: '',
      installmentLabel: null,
      amount: '',
      nominalAmount: null,
      dueDate: null,
      secondDueDate: null,
      secondAmount: null,
      paymentCode: null,
      consumption: null,
    };
    if (!corrects) return lines;
    return [
      {
        ...base,
        period: input.period ? `${input.period.slice(0, 7)}-01` : base.period,
        installmentLabel: input.installmentLabel ?? base.installmentLabel,
        amount: input.amount ?? base.amount,
        dueDate: input.dueDate !== undefined ? input.dueDate : base.dueDate,
      },
    ];
  }

  private async require(id: string) {
    const document = await this.prisma.client.billDocument.findFirst({
      where: { id },
      include: {
        bills: { select: { id: true, serviceId: true, period: true, installmentLabel: true, amount: true, dueDate: true, status: true } },
        service: { select: { id: true, serviceType: true, providerName: true, propertyId: true } },
      },
    });
    if (!document) throw notFound('DOCUMENT_NOT_FOUND', 'Document not found');
    return document;
  }
}
