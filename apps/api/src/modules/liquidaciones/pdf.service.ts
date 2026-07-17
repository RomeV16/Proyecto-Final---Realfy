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

interface PdfLineItem {
  type: string;
  description: string;
  amount: string | number;
  meta?: { daysOverdue?: number } | null;
}

interface PdfPayment {
  method: string;
  amount: string | number;
  paidAt: Date | string;
  reference?: string | null;
}

interface PdfTenant {
  name: string;
  cuit?: string | null;
  logoUrl?: string | null;
}

interface PdfContract {
  property?: { address?: string; name?: string } | null;
}

interface PdfLiquidacion {
  id: string;
  period: Date | string;
  subtotal: string | number;
  total: string | number;
  currency: string;
  dueDate: Date | string;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Generate a PDF receipt buffer for a liquidación.
   */
  async generateReceipt(
    liquidacion: PdfLiquidacion,
    tenant: PdfTenant,
    contract: PdfContract,
    lineItems: PdfLineItem[],
    payments: PdfPayment[],
  ): Promise<Buffer> {
    const period = new Date(liquidacion.period);
    const monthYear = period.toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    });
    const propertyAddress =
      contract?.property?.address ?? contract?.property?.name ?? '—';

    const docDefinition: any = {
      content: [
        // Header: tenant name
        {
          text: tenant.name,
          style: 'header',
          alignment: 'center',
        },
        tenant.cuit
          ? { text: `CUIT: ${tenant.cuit}`, alignment: 'center', margin: [0, 0, 0, 10] }
          : { text: '', margin: [0, 0, 0, 10] },
        {
          text: 'LIQUIDACIÓN',
          style: 'title',
          alignment: 'center',
          margin: [0, 10, 0, 5],
        },
        // Period & property
        {
          columns: [
            { text: `Período: ${monthYear}`, width: '*' },
            {
              text: `Vencimiento: ${new Date(liquidacion.dueDate).toLocaleDateString('es-AR')}`,
              width: 'auto',
            },
          ],
          margin: [0, 10, 0, 5],
        },
        { text: `Propiedad: ${propertyAddress}`, margin: [0, 0, 0, 10] },
        { text: `Moneda: ${liquidacion.currency}`, margin: [0, 0, 0, 10] },

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
              ...lineItems.map((li) => {
                const isMulta = li.type === 'Multa';
                const daysOverdue =
                  li.meta?.daysOverdue ??
                  (() => {
                    const match = li.description.match(/(\d+)\s*d[ií]as?\s+de\s+mora/i);
                    return match ? parseInt(match[1], 10) : null;
                  })();
                const descriptionText = isMulta && daysOverdue != null
                  ? `${li.description} — ${daysOverdue} días de mora`
                  : li.description;

                const fillColor = isMulta ? '#FEF2F2' : null;

                const typeCell: any = {
                  text: isMulta
                    ? [{ text: 'Multa', bold: true, color: '#991B1B' }]
                    : li.type,
                };
                const descCell: any = {
                  text: descriptionText,
                };
                const amountCell: any = {
                  text: this.formatAmount(li.amount),
                  alignment: 'right',
                };

                if (fillColor) {
                  typeCell.fillColor = fillColor;
                  descCell.fillColor = fillColor;
                  amountCell.fillColor = fillColor;
                }

                return [typeCell, descCell, amountCell];
              }),
            ],
          },
          margin: [0, 0, 0, 10],
        },

        // Totals
        {
          columns: [
            { text: '', width: '*' },
            {
              width: 'auto',
              table: {
                body: [
                  [
                    { text: 'Subtotal:', bold: true },
                    {
                      text: `$ ${this.formatAmount(liquidacion.subtotal)}`,
                      alignment: 'right',
                    },
                  ],
                  [
                    { text: 'Total:', bold: true },
                    {
                      text: `$ ${this.formatAmount(liquidacion.total)}`,
                      alignment: 'right',
                      bold: true,
                    },
                  ],
                ],
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 0, 0, 15],
        },

        // Payments section (if any)
        ...(payments.length > 0
          ? [
              { text: 'Pagos registrados', style: 'subheader', margin: [0, 10, 0, 5] as [number, number, number, number] },
              {
                table: {
                  headerRows: 1,
                  widths: ['auto', '*', 'auto', 'auto'],
                  body: [
                    [
                      { text: 'Método', bold: true },
                      { text: 'Referencia', bold: true },
                      { text: 'Fecha', bold: true },
                      { text: 'Monto', bold: true, alignment: 'right' },
                    ],
                    ...payments.map((p) => [
                      p.method,
                      p.reference ?? '—',
                      new Date(p.paidAt).toLocaleDateString('es-AR'),
                      {
                        text: `$ ${this.formatAmount(p.amount)}`,
                        alignment: 'right',
                      },
                    ]),
                  ],
                },
                margin: [0, 0, 0, 10] as [number, number, number, number],
              },
            ]
          : []),
      ],

      // Footer
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          tenant.cuit
            ? { text: `CUIT: ${tenant.cuit}`, fontSize: 8, margin: [40, 0, 0, 0] }
            : { text: '' },
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
      this.logger.error('PDF generation failed', {
        liquidacionId: liquidacion.id,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private formatAmount(amount: string | number): string {
    return Number(amount).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
