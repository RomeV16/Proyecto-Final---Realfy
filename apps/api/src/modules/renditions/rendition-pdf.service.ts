import { Injectable, Logger } from '@nestjs/common';

// pdfmake Node.js usage: dynamic require for CommonJS module

const PdfPrinter = require('pdfmake/src/printer');

const FONTS = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

interface PdfTenant {
  name: string;
  cuit?: string | null;
}

@Injectable()
export class RenditionPdfService {
  private readonly logger = new Logger(RenditionPdfService.name);

  /**
   * Generate a rendition PDF buffer with line-item breakdown and summary.
   */
  async generateRenditionPdf(
    rendicion: any,
    tenant: PdfTenant,
  ): Promise<Buffer> {
    const period = new Date(rendicion.period);
    const monthYear = period.toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    });
    const monthNum = String(period.getMonth() + 1).padStart(2, '0');
    const yearNum = period.getFullYear();

    const ownerName = rendicion.owner
      ? `${rendicion.owner.firstName} ${rendicion.owner.lastName}`
      : '—';
    const propertyAddress =
      rendicion.contract?.property?.address ??
      rendicion.contract?.property?.name ??
      '—';
    const contractRef = rendicion.contract
      ? `Contrato #${rendicion.contract.id.slice(0, 8)}`
      : '—';

    const lineItemRows = (rendicion.lineItems ?? []).map((li: any) => {
      const amt = Number(li.amount);
      const isPositive = li.type === 'Alquiler';
      return [
        li.type,
        li.description,
        {
          text: `${isPositive ? '' : '-'} $ ${this.formatAmount(Math.abs(amt))}`,
          alignment: 'right',
          color: isPositive ? '#000000' : '#CC0000',
        },
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
          text: `${monthNum}/${yearNum}`,
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
                { text: 'Tipo', bold: true },
                { text: 'Descripción', bold: true },
                { text: 'Monto', bold: true, alignment: 'right' },
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
                    {
                      text: `$ ${this.formatAmount(rendicion.rentCollected)}`,
                      alignment: 'right',
                    },
                  ],
                  [
                    { text: 'Comisión:', bold: false },
                    {
                      text: `- $ ${this.formatAmount(rendicion.commissionAmount)}`,
                      alignment: 'right',
                      color: '#CC0000',
                    },
                  ],
                  [
                    { text: 'Honorarios admin:', bold: false },
                    {
                      text: `- $ ${this.formatAmount(rendicion.adminFeeAmount)}`,
                      alignment: 'right',
                      color: '#CC0000',
                    },
                  ],
                  [
                    { text: 'Deducciones:', bold: false },
                    {
                      text: `- $ ${this.formatAmount(rendicion.deductionTotal)}`,
                      alignment: 'right',
                      color: '#CC0000',
                    },
                  ],
                  [
                    { text: 'Depósito neto:', bold: true },
                    {
                      text: `$ ${this.formatAmount(rendicion.netDeposit)}`,
                      alignment: 'right',
                      bold: true,
                      fontSize: 12,
                    },
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
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          {
            text: `Generado: ${new Date().toLocaleDateString('es-AR')}`,
            fontSize: 8,
            margin: [40, 0, 0, 0],
          },
          {
            text: `Pág. ${currentPage}/${pageCount}`,
            fontSize: 8,
            alignment: 'right',
            margin: [0, 0, 40, 0],
          },
        ],
      }),

      styles: {
        header: { fontSize: 18, bold: true },
        title: { fontSize: 14, bold: true },
        subheader: { fontSize: 12, bold: true },
      },
      defaultStyle: {
        fontSize: 10,
      },
    };

    try {
      const printer = new PdfPrinter(FONTS);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      const chunks: Buffer[] = [];
      return new Promise<Buffer>((resolve, reject) => {
        pdfDoc.on('data', (chunk: Buffer) => chunks.push(chunk));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', (err: Error) => reject(err));
        pdfDoc.end();
      });
    } catch (error) {
      this.logger.error('Rendition PDF generation failed', {
        rendicionId: rendicion.id,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private formatAmount(amount: string | number | any): string {
    return Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
