import { Injectable, Logger } from '@nestjs/common';
import {
  formatDateAR,
  formatPeriodAR,
  propertyLabel,
  type PropertyLabelInput,
} from '@realfy/shared';
import {
  PdfRendererService,
  dateCell,
  headerCell,
  moneyCell,
  pageFooter,
} from '../../common/pdf/pdf-renderer.service';

interface PdfLineItem {
  type: string;
  description: string;
  amount: string | number;
  meta?: { daysOverdue?: number } | null;
  beneficiary?: string | null;
  commissionable?: boolean | null;
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
  property?: PropertyLabelInput | null;
}

interface PdfLiquidacion {
  id: string;
  period: Date | string;
  subtotal: string | number;
  total: string | number;
  currency: string;
  dueDate: Date | string;
  kind?: string | null;
  isProvisional?: boolean | null;
  /** Número de recibo con ceros ("00000042"); null si todavía no se aprobó. */
  receiptNumber?: string | null;
  amountInWords?: string | null;
  /** "Cobrado por cuenta y orden de ..."; vacío si no hay locadores cargados. */
  onBehalfOf?: string | null;
}

/** Orden y título de los grupos de renglones según a quién le corresponden. */
const BENEFICIARY_GROUPS: { key: string; title: string }[] = [
  { key: 'Locador', title: 'A favor del locador' },
  { key: 'Ente', title: 'A favor de entes y proveedores' },
  { key: 'Inmobiliaria', title: 'A favor de la inmobiliaria' },
];

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private readonly renderer: PdfRendererService) {}

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
    const monthYear = formatPeriodAR(liquidacion.period);
    const propertyAddress = propertyLabel(contract?.property) || '—';

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
          text: liquidacion.receiptNumber ? `RECIBO Nº ${liquidacion.receiptNumber}` : 'LIQUIDACIÓN',
          style: 'title',
          alignment: 'center',
          margin: [0, 10, 0, 5],
        },
        ...(liquidacion.isProvisional || liquidacion.kind === 'PagoACuenta'
          ? [
              {
                text: 'PAGO A CUENTA: importe provisional, sujeto a corrección cuando se publique el índice oficial',
                bold: true,
                color: '#92400E',
                alignment: 'center',
                margin: [0, 0, 0, 5],
              },
            ]
          : []),
        // Period & property
        {
          columns: [
            { text: `Período: ${monthYear}`, width: '*' },
            {
              text: `Vencimiento: ${formatDateAR(liquidacion.dueDate)}`,
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
                headerCell('Tipo'),
                headerCell('Descripción'),
                headerCell('Monto', { alignment: 'right' }),
              ],
              ...groupedLines(lineItems).flatMap((group) => [
                ...(group.title ? [[{ text: group.title, colSpan: 3, bold: true, fillColor: '#F3F4F6' }, {}, {}]] : []),
                ...group.items.map((li) => {
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
                const amountCell: any = moneyCell(li.amount, { symbol: false });

                if (fillColor) {
                  typeCell.fillColor = fillColor;
                  descCell.fillColor = fillColor;
                  amountCell.fillColor = fillColor;
                }

                return [typeCell, descCell, amountCell];
              }),
              ]),
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
                    headerCell('Subtotal:'),
                    moneyCell(liquidacion.subtotal),
                  ],
                  [
                    headerCell('Total:'),
                    moneyCell(liquidacion.total, { bold: true }),
                  ],
                ],
              },
              layout: 'noBorders',
            },
          ],
          margin: [0, 0, 0, 15],
        },
        ...(liquidacion.amountInWords
          ? [{ text: `Son: ${liquidacion.amountInWords}.`, italics: true, margin: [0, 0, 0, 5] as [number, number, number, number] }]
          : []),
        ...(liquidacion.onBehalfOf
          ? [{ text: liquidacion.onBehalfOf, margin: [0, 0, 0, 10] as [number, number, number, number] }]
          : []),

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
                      headerCell('Método'),
                      headerCell('Referencia'),
                      headerCell('Fecha'),
                      headerCell('Monto', { alignment: 'right' }),
                    ],
                    ...payments.map((p) => [
                      p.method,
                      p.reference ?? '—',
                      dateCell(p.paidAt),
                      moneyCell(p.amount),
                    ]),
                  ],
                },
                margin: [0, 0, 0, 10] as [number, number, number, number],
              },
            ]
          : []),
      ],

      // Footer
      footer: pageFooter(tenant.cuit ? `CUIT: ${tenant.cuit}` : null),
    };

    try {
      return await this.renderer.render(docDefinition);
    } catch (error) {
      this.logger.error('PDF generation failed', {
        liquidacionId: liquidacion.id,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

/**
 * Agrupa los renglones por destino. Si todos van al locador (liquidación
 * simple) no se imprimen títulos de grupo, para que el recibo se vea como siempre.
 */
function groupedLines(lineItems: PdfLineItem[]): { title: string | null; items: PdfLineItem[] }[] {
  const keyOf = (li: PdfLineItem) => li.beneficiary ?? 'Locador';
  const onlyLessor = lineItems.every((li) => keyOf(li) === 'Locador');
  if (onlyLessor) return [{ title: null, items: lineItems }];
  return BENEFICIARY_GROUPS.map((g) => ({
    title: g.title,
    items: lineItems.filter((li) => keyOf(li) === g.key),
  })).filter((g) => g.items.length > 0);
}
