import { Injectable } from '@nestjs/common';
import {
  PAYMENT_RECEIPT_SERIES,
  PaymentReceiver,
  ReceiptFilterSchema,
  amountInWords,
  formatDateAR,
  formatMoneyAR,
  formatPeriodAR,
  formatReceiptNumber,
  isLessorActiveAt,
  onBehalfOfText,
  personName,
  propertyLabel,
} from '@realfy/shared';
import { PdfRendererService, pageFooter } from '../../common/pdf/pdf-renderer.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { getParty } from '../contracts/contract-parties';
import { dayStart, notFound } from './cash.errors';
import { installmentLabel } from '../fees/fee-labels';

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;

const RECEIPT_INCLUDE = {
  payment: {
    include: {
      account: { select: { id: true, name: true, kind: true } },
      receivedByUser: { select: { id: true, firstName: true, lastName: true } },
      liquidacion: {
        select: {
          id: true,
          period: true,
          contractId: true,
          contract: {
            select: {
              id: true,
              property: true,
              persons: { include: { person: PERSON } },
              lessors: { include: { person: PERSON } },
            },
          },
        },
      },
    },
  },
  feeInstallment: {
    select: {
      n: true,
      fee: {
        select: {
          kind: true,
          installments: true,
          contractId: true,
          payer: PERSON,
          contract: { select: { property: true } },
          property: true,
        },
      },
    },
  },
} as const;

const METHOD_LABEL: Record<string, string> = {
  Transferencia: 'Transferencia',
  Efectivo: 'Efectivo',
  MercadoPago: 'Mercado Pago',
  Cheque: 'Cheque',
  AplicacionDeposito: 'Aplicación del depósito',
};

/**
 * Número que se imprime: la serie única muestra solo el número; una serie por
 * moneda o por cuenta lo antepone (la moneda, o el nombre de la cuenta).
 */
export function receiptLabel(series: string, number: number, accountName?: string | null): string {
  const n = formatReceiptNumber(number);
  if (series === PAYMENT_RECEIPT_SERIES) return n;
  const suffix = series.slice(PAYMENT_RECEIPT_SERIES.length + 1);
  return `${/^[A-Z]{3}$/.test(suffix) ? suffix : (accountName ?? suffix)}-${n}`;
}

/**
 * Un cobro con la etiqueta de su recibo (`receipt.label`), la misma que se
 * imprime y que devuelve la lista de recibos.
 */
export function withReceiptLabel<P extends { receipt?: any; account?: { name?: string | null } | null }>(payment: P): P {
  if (!payment?.receipt) return payment;
  const { series, number } = payment.receipt;
  return { ...payment, receipt: { ...payment.receipt, label: receiptLabel(series, number, payment.account?.name) } };
}

/** Recibos de cobro (ADR-0012): lista para reimprimir y PDF con el número del recibo. */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly renderer: PdfRendererService,
  ) {}

  async list(query: unknown) {
    const filters = parseOrThrow(ReceiptFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, any> = {};
    if (filters.from || filters.to) {
      where.issuedAt = {
        ...(filters.from ? { gte: dayStart(filters.from) } : {}),
        ...(filters.to ? { lt: new Date(dayStart(filters.to).getTime() + 86_400_000) } : {}),
      };
    }
    if (filters.contractId) {
      where.OR = [
        { payment: { liquidacion: { contractId: filters.contractId } } },
        { feeInstallment: { fee: { contractId: filters.contractId } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.receipt.findMany({
        where,
        include: RECEIPT_INCLUDE,
        orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.receipt.count({ where }),
    ]);
    const items = rows.map((r: any) => this.summary(r));
    return { items, total, page: filters.page, limit: filters.limit, totalPages: Math.ceil(total / filters.limit) };
  }

  async pdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const receipt: any = await this.prisma.client.receipt.findFirst({ where: { id }, include: RECEIPT_INCLUDE });
    if (!receipt) throw notFound('RECEIPT_NOT_FOUND', 'Receipt not found');
    const tenant: any = await this.prisma.client.tenant.findFirst({ where: { id: this.tenantContext.getTenantId()! } });
    const s = this.summary(receipt);
    const payment = receipt.payment;
    const contract = payment?.liquidacion?.contract;
    const lessorNames = (contract?.lessors ?? [])
      .filter((l: any) => isLessorActiveAt(l, payment.liquidacion.period))
      .map((l: any) => personName(l.person));
    const row = (label: string, value: string) => [{ text: label, bold: true }, { text: value }];

    const buffer = await this.renderer.render({
      content: [
        { text: tenant?.name ?? 'Inmobiliaria', style: 'header', alignment: 'center' },
        tenant?.cuit ? { text: `CUIT: ${tenant.cuit}`, alignment: 'center' } : { text: '' },
        { text: `RECIBO DE COBRO Nº ${s.number}`, style: 'title', alignment: 'center', margin: [0, 15, 0, 15] },
        {
          table: {
            widths: ['auto', '*'],
            body: [
              row('Fecha', formatDateAR(receipt.issuedAt)),
              row('Recibimos de', s.tenantName ?? '—'),
              row('La suma de', `${receipt.currency} ${formatMoneyAR(receipt.amount.toString())}`),
              row('Son', amountInWords(receipt.amount.toString(), receipt.currency)),
              row('En concepto de', this.concept(receipt)),
              row('Medio de pago', METHOD_LABEL[payment?.method] ?? payment?.method ?? '—'),
              row(
                'Recibido por',
                payment?.receivedBy === PaymentReceiver.Locador
                  ? 'El locador, directamente'
                  : [payment?.account?.name, s.receivedByName].filter(Boolean).join(' — ') || 'La inmobiliaria',
              ),
              ...(payment?.reference ? [row('Referencia', payment.reference)] : []),
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 15],
        },
        ...(lessorNames.length ? [{ text: onBehalfOfText(lessorNames), margin: [0, 0, 0, 5] }] : []),
        ...(payment?.inCustody
          ? [{ text: 'La parte de los locadores queda en custodia de la inmobiliaria hasta su entrega.', italics: true }]
          : []),
      ],
      footer: pageFooter(tenant?.cuit ? `CUIT: ${tenant.cuit}` : null),
    });
    return { buffer, filename: `recibo-${s.number}.pdf` };
  }

  /** Concepto impreso: el alquiler del mes o la cuota de honorarios. */
  private concept(receipt: any): string {
    const feeInstallment = receipt.feeInstallment;
    if (feeInstallment) {
      const fee = feeInstallment.fee;
      return `${installmentLabel(fee, feeInstallment.n)} — ${propertyLabel(fee.contract?.property ?? fee.property) || '—'}`;
    }
    const payment = receipt.payment;
    return `Alquiler ${payment ? formatPeriodAR(payment.liquidacion.period) : ''} — ${propertyLabel(payment?.liquidacion?.contract?.property) || '—'}`;
  }

  private summary(r: any) {
    const payment = r.payment;
    const contract = payment?.liquidacion?.contract;
    const tenantParty = contract ? getParty<any>(contract, 'Inquilino') : undefined;
    const fee = r.feeInstallment?.fee;
    return {
      id: r.id,
      series: r.series,
      number: receiptLabel(r.series, r.number, payment?.account?.name),
      issuedAt: r.issuedAt,
      amount: r.amount,
      currency: r.currency,
      paymentId: payment?.id ?? null,
      liquidacionId: payment?.liquidacion?.id ?? null,
      contractId: payment?.liquidacion?.contractId ?? fee?.contractId ?? null,
      period: payment?.liquidacion?.period ?? null,
      property: contract?.property
        ? propertyLabel(contract.property)
        : propertyLabel(fee?.contract?.property ?? fee?.property) || null,
      tenantName: tenantParty?.person ? personName(tenantParty.person) : fee?.payer ? personName(fee.payer) : null,
      concept: fee ? installmentLabel(fee, r.feeInstallment.n) : null,
      method: payment?.method ?? null,
      receivedBy: payment?.receivedBy ?? null,
      inCustody: payment?.inCustody ?? false,
      receivedByName: payment?.receivedByUser ? personName(payment.receivedByUser) : null,
    };
  }
}
