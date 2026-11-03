import { Injectable } from '@nestjs/common';
import { MESSAGE_TEMPLATES, type MessageAttachmentKind, type MessageTemplateKey } from '@realfy/shared';
import { ReceiptsService } from '../cash/receipts.service';
import { LiquidacionesService } from '../liquidaciones/liquidaciones.service';
import { OwnerStatementsService } from '../owner-accounts/owner-statements.service';
import type { MessageAttachment } from './providers/message-provider';

const PDF = 'application/pdf';

/**
 * Genera el PDF que acompaña un mensaje en el momento de despacharlo, a partir
 * de `relatedType`/`relatedId`. La bandeja de salida no guarda archivos: el
 * documento sale tal como está al despachar (un recibo o un estado emitido no
 * cambian). Corre dentro del contexto de la inmobiliaria del mensaje.
 */
@Injectable()
export class MessageAttachmentsService {
  constructor(
    private readonly receipts: ReceiptsService,
    private readonly ownerStatements: OwnerStatementsService,
    private readonly liquidaciones: LiquidacionesService,
  ) {}

  /** Tipo de documento que lleva la plantilla, si lleva. */
  kindFor(templateKey: string): MessageAttachmentKind | undefined {
    return MESSAGE_TEMPLATES[templateKey as MessageTemplateKey]?.attachment;
  }

  async resolve(kind: MessageAttachmentKind, id: string): Promise<MessageAttachment> {
    switch (kind) {
      case 'Receipt': {
        const { buffer, filename } = await this.receipts.pdf(id);
        return { filename, content: buffer, mimeType: PDF };
      }
      case 'OwnerStatement': {
        const { buffer, filename } = await this.ownerStatements.pdf(id);
        return { filename, content: buffer, mimeType: PDF };
      }
      case 'Liquidacion': {
        const buffer = await this.liquidaciones.generatePdf(id);
        return { filename: `liquidacion-${id}.pdf`, content: buffer, mimeType: PDF };
      }
    }
  }
}
