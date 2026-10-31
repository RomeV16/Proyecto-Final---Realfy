import { Injectable, Logger } from '@nestjs/common';
import {
  formatDateAR,
  formatPeriodShortAR,
  personName,
  propertyLabel,
  todayInAR,
} from '@realfy/shared';
import {
  PdfRendererService,
  headerCell,
  moneyCell,
  pageFooter,
} from '../../common/pdf/pdf-renderer.service';

interface PdfTenant {
  name: string;
  cuit?: string | null;
}

@Injectable()
export class RenditionPdfService {
  private readonly logger = new Logger(RenditionPdfService.name);

  constructor(private readonly renderer: PdfRendererService) {}

  /**
   * Generate a rendition PDF buffer with line-item breakdown and summary.
   */
  async generateRenditionPdf(
    rendicion: any,
    tenant: PdfTenant,
  ): Promise<Buffer> {
    const ownerName = personName(rendicion.owner) || '—';
    const propertyAddress = propertyLabel(rendicion.contract?.property) || '—';
    const contractRef = rendicion.contract
      ? `Contrato #${rendicion.contract.id.slice(0, 8)}`
      : '—';

    const lineItemRows = (rendicion.lineItems ?? []).map((li: any) => {
      const amt = Number(li.amount);
      const isPositive = li.type === 'Alquiler';
      return [
        li.type,
        li.description,
        moneyCell(Math.abs(amt), {
          prefix: isPositive ? '' : '- ',
          color: isPositive ? '#000000' : '#CC0000',
        }),
      ];
    });

    const docDefinition: any = {
      content: [
        // Header: tenant name + CUIT
        {
          text: tenant.name,
          style: 'header',
          alignment: 'center',
        },
        tenant.cuit
          ? {
              text: `CUIT: ${tenant.cuit}`,
              alignment: 'center',
              margin: [0, 0, 0, 10],
            }
          : { text: '', margin: [0, 0, 0, 10] },

        // Title
        {
          text: `RENDICIÓN DE ALQUILERES`,
          style: 'title',
          alignment: 'center',
          margin: [0, 10, 0, 5],
        },
        {
          text: formatPeriodShortAR(rendicion.period),
          alignment: 'center',
          fontSize: 12,
          margin: [0, 0, 0, 15],
        },

        // Owner info
        {
          text: 'Datos del propietario',
          style: 'subheader',
          margin: [0, 0, 0, 5],
        },
        { text: `Propietario: ${ownerName}`, margin: [0, 0, 0, 3] },
        { text: `Propiedad: ${propertyAddress}`, margin: [0, 0, 0, 3] },
        { text: contractRef, margin: [0, 0, 0, 15] },

        // Line items table
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto'],
            body: [
              [
                headerCell('Tipo'),
                headerCell('Descripción'),
                headerCell('Monto', { alignment: 'right' }),
              ],
              ...lineItemRows,
            ],
          },
          margin: [0, 0, 0, 15],
        },

        // Summary section
        {
          text: 'Resumen',
          style: 'subheader',
          margin: [0, 10, 0, 5],
        },
        {
          columns: [
            { text: '', width: '*' },
            {
              width: 'auto',
              table: {
                body: [
                  [
                    { text: 'Total cobrado:', bold: false },
                    moneyCell(rendicion.rentCollected),
                  ],
                  [
                    { text: 'Comisión:', bold: false },
                    moneyCell(rendicion.commissionAmount, { prefix: '- ', color: '#CC0000' }),
                  ],
                  [
                    { text: 'Honorarios admin:', bold: false },
                    moneyCell(rendicion.adminFeeAmount, { prefix: '- ', color: '#CC0000' }),
                  ],
                  [
                    { text: 'Deducciones:', bold: false },
                    moneyCell(rendicion.deductionTotal, { prefix: '- ', color: '#CC0000' }),
                  ],
                  [
                    { text: 'Depósito neto:', bold: true },
                    moneyCell(rendicion.netDeposit, { bold: true, fontSize: 12 }),
                  ],
                ],
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 0, 0, 15],
        },

        // Notes (if any)
        ...(rendicion.notes
          ? [
              {
                text: 'Notas',
                style: 'subheader',
                margin: [0, 10, 0, 5] as [number, number, number, number],
              },
              {
                text: rendicion.notes,
                margin: [0, 0, 0, 10] as [number, number, number, number],
              },
            ]
          : []),
      ],

      // Footer
      footer: pageFooter(`Generado: ${formatDateAR(todayInAR())}`),
    };

    try {
      return await this.renderer.render(docDefinition);
    } catch (error) {
      this.logger.error('Rendition PDF generation failed', {
        rendicionId: rendicion.id,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
