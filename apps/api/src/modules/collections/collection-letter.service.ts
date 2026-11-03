import { Injectable } from '@nestjs/common';
import { CollectionActionStatus } from '@realfy/shared';
import { PdfRendererService, pageFooter } from '../../common/pdf/pdf-renderer.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { CollectionsService } from './collections.service';

/**
 * PDF del borrador de la carta documento. Es un documento de trabajo: lleva la
 * marca de borrador mientras no se confirme su envío y recuerda que debe
 * revisarlo un profesional antes de mandarse por correo certificado. El sistema
 * no la envía ni la guarda: se genera de los campos editables cada vez.
 */
@Injectable()
export class CollectionLetterService {
  constructor(
    private readonly collections: CollectionsService,
    private readonly renderer: PdfRendererService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async pdf(caseId: string, actionId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { fields, status } = await this.collections.letterFor(caseId, actionId);
    const tenant = await this.prisma.baseClient.tenant.findFirst({
      where: { id: this.tenantContext.getTenantId()! },
      select: { name: true, cuit: true },
    });
    const draft = status === CollectionActionStatus.Preparada;

    const buffer = await this.renderer.render({
      ...(draft ? { watermark: { text: 'BORRADOR', color: '#9ca3af', opacity: 0.18, bold: true } } : {}),
      content: [
        { text: tenant?.name ?? 'Inmobiliaria', style: 'header', alignment: 'center' },
        tenant?.cuit ? { text: `CUIT: ${tenant.cuit}`, alignment: 'center' } : { text: '' },
        { text: 'INTIMACIÓN DE PAGO', style: 'title', alignment: 'center', margin: [0, 15, 0, 4] },
        {
          text: 'Borrador para revisión: no vale como intimación hasta que lo revise un profesional y se envíe por correo certificado.',
          alignment: 'center',
          italics: true,
          fontSize: 9,
          margin: [0, 0, 0, 14],
        },
        { text: `Fecha: ${fields.issuedOn}`, alignment: 'right', margin: [0, 0, 0, 10] },
        {
          text: `Destinatario: ${fields.recipientName || '—'}\nDomicilio: ${fields.recipientAddress || '—'}`,
          margin: [0, 0, 0, 10],
        },
        {
          text:
            `Por la presente se le comunica que, a la fecha, se encuentra impago el alquiler correspondiente a ${fields.periods || '—'} ` +
            `del inmueble ubicado en ${fields.propertyAddress || '—'}, por un importe total de ${fields.amount || '—'} ` +
            `al día ${fields.issuedOn}, que comprende el saldo adeudado y los punitorios previstos en el contrato.`,
          alignment: 'justify',
          margin: [0, 0, 0, 8],
        },
        {
          text:
            `Se lo intima a regularizar el pago en el plazo de ${fields.termDays} días corridos contados desde la recepción de esta comunicación. ` +
            'Si desea acordar una forma de pago, puede comunicarse con la inmobiliaria dentro de ese plazo.',
          alignment: 'justify',
          margin: [0, 0, 0, 8],
        },
        fields.extraText ? { text: fields.extraText, alignment: 'justify', margin: [0, 0, 0, 8] } : { text: '' },
        { text: '\n\n______________________\nFirma y aclaración', alignment: 'right', margin: [0, 30, 0, 0] },
      ],
      footer: pageFooter(tenant?.cuit ? `CUIT: ${tenant.cuit}` : null),
    });
    return { buffer, filename: `carta-documento-${actionId.slice(0, 8)}.pdf` };
  }
}
