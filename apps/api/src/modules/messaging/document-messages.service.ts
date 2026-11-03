import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  OwnerStatementStatus,
  SendDocumentSchema,
  formatMoneyAR,
  formatPeriodAR,
  type MessageTemplateKey,
  type OutboxItem,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { OutboxService } from '../../common/messaging/outbox.service';
import type { MessageVars } from '../../common/messaging/message-templates';
import { parseOrThrow } from '../../common/validation/zod';
import { getParty } from '../contracts/contract-parties';
import { receiptLabel } from '../cash/receipts.service';
import { installmentLabel } from '../fees/fee-labels';
import { toItem } from './outbox-admin.service';

const PERSON = { select: { id: true, firstName: true, lastName: true, email: true, phone: true } } as const;

interface Recipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

interface Prepared {
  templateKey: MessageTemplateKey;
  recipient: Recipient;
  vars: MessageVars;
  relatedType: string;
}

/**
 * "Enviar por mail / WhatsApp" desde la pantalla de un documento (ADR-0013):
 * arma las variables del mensaje con el documento como está y lo encola con
 * una clave por documento y canal. Pedirlo dos veces devuelve el mismo
 * mensaje; para mandarlo de nuevo se reintenta desde la bandeja de salida.
 */
@Injectable()
export class DocumentMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly outbox: OutboxService,
  ) {}

  async send(data: unknown): Promise<OutboxItem> {
    const input = parseOrThrow(SendDocumentSchema, data, 'Invalid send request');
    const agency = await this.agencyName();
    const prepared =
      input.kind === 'Receipt' ? await this.receipt(input.id, agency) : await this.ownerStatement(input.id, agency);

    const queued = await this.outbox.enqueue(this.prisma.client, {
      channel: input.channel,
      templateKey: prepared.templateKey,
      vars: prepared.vars,
      personId: prepared.recipient.id,
      relatedType: prepared.relatedType,
      relatedId: input.id,
      idempotencyKey: `${prepared.relatedType}:${input.id}:${input.channel}`,
      createdByUserId: this.tenantContext.getUserId() ?? null,
    });
    const row = await this.prisma.client.messageOutbox.findFirst({
      where: { id: queued.id },
      include: { person: { select: { firstName: true, lastName: true } } },
    });
    return toItem(row);
  }

  /** Recibo de cobro: va al inquilino del contrato o a quien pagó el honorario. */
  private async receipt(id: string, agency: string): Promise<Prepared> {
    const r: any = await this.prisma.client.receipt.findFirst({
      where: { id },
      include: {
        payment: {
          include: {
            account: { select: { name: true } },
            liquidacion: {
              select: { period: true, contract: { select: { persons: { include: { person: PERSON } } } } },
            },
          },
        },
        feeInstallment: { select: { n: true, fee: { select: { kind: true, installments: true, payer: PERSON } } } },
      },
    });
    if (!r) throw new NotFoundException({ error: 'RECEIPT_NOT_FOUND', message: 'Receipt not found' });
    const liquidacion = r.payment?.liquidacion;
    const fee = r.feeInstallment?.fee;
    const recipient: Recipient | undefined = fee?.payer ?? (liquidacion ? getParty<any>(liquidacion.contract, 'Inquilino')?.person : undefined);
    if (!recipient) throw noRecipient('Receipt');
    return {
      templateKey: 'receipt',
      recipient,
      relatedType: 'Receipt',
      vars: {
        name: recipient.firstName,
        number: receiptLabel(r.series, r.number, r.payment?.account?.name),
        amount: `${r.currency} ${formatMoneyAR(r.amount.toString())}`,
        concept: fee
          ? installmentLabel(fee, r.feeInstallment.n)
          : `alquiler de ${liquidacion ? formatPeriodAR(liquidacion.period) : ''}`.trim(),
        agency,
      },
    };
  }

  /** Estado de cuenta del locador: solo uno emitido (un borrador todavía cambia). */
  private async ownerStatement(id: string, agency: string): Promise<Prepared> {
    const s: any = await this.prisma.client.ownerStatement.findFirst({ where: { id }, include: { person: PERSON } });
    if (!s) throw new NotFoundException({ error: 'OWNER_STATEMENT_NOT_FOUND', message: 'Owner statement not found' });
    if (s.status !== OwnerStatementStatus.Emitido && s.status !== OwnerStatementStatus.Enviado) {
      throw new BadRequestException({
        error: 'OWNER_STATEMENT_NOT_ISSUED',
        message: 'Only an issued statement can be sent',
        status: s.status,
      });
    }
    return {
      templateKey: 'owner_statement',
      recipient: s.person,
      relatedType: 'OwnerStatement',
      vars: {
        name: s.person.firstName,
        period: formatPeriodAR(s.period),
        closing: `${s.currency} ${formatMoneyAR(s.closing.toString())}`,
        agency,
      },
    };
  }

  private async agencyName(): Promise<string> {
    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: this.tenantContext.getTenantId()! },
      select: { name: true },
    });
    return tenant?.name ?? 'Inmobiliaria';
  }
}

function noRecipient(kind: string): BadRequestException {
  return new BadRequestException({
    error: 'NO_RECIPIENT',
    message: `The ${kind} has no person to send it to`,
  });
}
