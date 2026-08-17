import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { FiscalCondition } from '@realfy/shared';

// pdfmake Node.js usage: dynamic require for CommonJS module
const PdfPrinter = require('pdfmake/src/printer');
const QRCode = require('qrcode');

const FONTS = {
  Roboto: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

// ─── Fiscal QR per RG 4892/2020 ─────────────────────────

/**
 * Parameters for the ARCA fiscal QR code per RG 4892/2020.
 */
export interface FiscalQrParams {
  /** Emission date YYYY-MM-DD */
  fecha: string;
  /** Emisor CUIT as number (no dashes) */
  cuit: number;
  /** Punto de venta */
  ptoVta: number;
  /** ARCA CbteTipo code */
  tipoCmp: number;
  /** Comprobante number */
  nroCmp: number;
  /** Total amount as float */
  importe: number;
  /** Currency code (PES, DOL, etc.) */
  moneda: string;
  /** Exchange rate */
  ctz: number;
  /** Receptor document type (80=CUIT, 96=DNI, 99=CF) */
  tipoDocRec: number;
  /** Receptor document number as number (no dashes) */
  nroDocRec: number;
  /** Authorization type: E = CAE, A = CAEA */
  tipoCodAut: string;
  /** CAE as number */
  codAut: number;
}

/**
 * Build the ARCA fiscal QR URL per RG 4892/2020.
 * Pure function — fully unit-testable.
 *
 * URL format: https://www.afip.gob.ar/fe/qr/?p={base64(JSON)}
 */
export function buildFiscalQrUrl(params: FiscalQrParams): string {
  const payload = {
    ver: 1,
    fecha: params.fecha,
    cuit: params.cuit,
    ptoVta: params.ptoVta,
    tipoCmp: params.tipoCmp,
    nroCmp: params.nroCmp,
    importe: params.importe,
    moneda: params.moneda,
    ctz: params.ctz,
    tipoDocRec: params.tipoDocRec,
    nroDocRec: params.nroDocRec,
    tipoCodAut: params.tipoCodAut,
    codAut: params.codAut,
  };

  const jsonStr = JSON.stringify(payload);
  const base64 = Buffer.from(jsonStr).toString('base64');
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}

/**
 * Strip dashes from a CUIT/DNI string and convert to number.
 */
export function cuitToNumber(cuit: string): number {
  return Number(cuit.replace(/-/g, ''));
}

// ─── Comprobante type labels ────────────────────────────

function getComprobanteTypeName(cbteTipo: number): string {
  const names: Record<number, string> = {
    1: 'Factura',
    2: 'Nota de Débito',
    3: 'Nota de Crédito',
    6: 'Factura',
    7: 'Nota de Débito',
    8: 'Nota de Crédito',
    11: 'Factura',
    12: 'Nota de Débito',
    13: 'Nota de Crédito',
  };
  return names[cbteTipo] ?? 'Comprobante';
}

function getComprobanteLetter(cbteTipo: number): string {
  if (cbteTipo >= 1 && cbteTipo <= 3) return 'A';
  if (cbteTipo >= 6 && cbteTipo <= 8) return 'B';
  if (cbteTipo >= 11 && cbteTipo <= 13) return 'C';
  return '?';
}

function formatPuntoDeVentaNumero(
  puntoDeVenta: number,
  numero: number,
): string {
  const pv = String(puntoDeVenta).padStart(4, '0');
  const num = String(numero).padStart(8, '0');
  return `${pv}-${num}`;
}

function formatAmount(amount: string | number | { toString(): string }): string {
  return Number(String(amount)).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('es-AR');
}

function getIsoDate(date: Date | string): string {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

const FISCAL_CONDITION_LABEL: Record<string, string> = {
  [FiscalCondition.ResponsableInscripto]: 'IVA Responsable Inscripto',
  [FiscalCondition.Monotributista]: 'Monotributista',
  [FiscalCondition.Exento]: 'IVA Exento',
  [FiscalCondition.ConsumidorFinal]: 'Consumidor Final',
  [FiscalCondition.NoResponsable]: 'No Responsable',
};

// ─── PDF Data Interfaces ────────────────────────────────

export interface ComprobantePdfData {
  id: string;
  cbteTipo: number;
  puntoDeVenta: number;
  numero: number;
  /** Accepts Prisma Decimal or string */
  impTotal: { toString(): string } | string;
  impNeto: { toString(): string } | string;
  impIva: { toString(): string } | string;
  impExento: { toString(): string } | string;
  currency: string;
  cae: string;
  caeFchVto: Date | string;
  emittedAt: Date | string;
  docTipo: number;
  docNro: string;
  receptorName: string;
  receptorFiscalCondition: string;
  /** Description from the emission — we reconstruct from payment if not stored */
  description?: string;
}

export interface TenantPdfData {
  name: string;
  cuit: string;
  address?: string | null;
  fiscalCondition: string;
}

// ─── Service ────────────────────────────────────────────

@Injectable()
export class FiscalPdfService {
  private readonly logger = new Logger(FiscalPdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Load comprobante + tenant data and generate the fiscal PDF.
   */
  async generatePdfForComprobante(comprobanteId: string): Promise<{
    buffer: Buffer;
    filename: string;
  }> {
    const tenantId = this.tenantContext.getTenantId()!;

    const comprobante = await this.prisma.client.comprobante.findFirst({
      where: { id: comprobanteId },
      include: {
        issuer: true,
        payment: {
          include: {
            liquidacion: {
              include: { contract: { include: { property: true } } },
            },
          },
        },
      },
    });

    if (!comprobante) {
      throw new NotFoundException({
        error: 'COMPROBANTE_NOT_FOUND',
        message: 'Comprobante not found',
      });
    }

    const tenant = await this.prisma.client.tenant.findFirst({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException({
        error: 'TENANT_NOT_FOUND',
        message: 'Tenant not found',
      });
    }

    // Issuer data (razón social, IIBB, domicilio) comes from the ArcaIssuer the
    // comprobante was emitted under, so a comprobante emitted on behalf of a
    // represented client prints that client's letterhead, not the agency's.
    const issuer = comprobante.issuer;

    // Build filename
    const letter = getComprobanteLetter(comprobante.cbteTipo);
    const formattedNum = formatPuntoDeVentaNumero(
      comprobante.puntoDeVenta,
      comprobante.numero,
    );
    const typeName = getComprobanteTypeName(comprobante.cbteTipo)
      .toLowerCase()
      .replace(/ /g, '-');
    const filename = `${typeName}-${letter}-${formattedNum}.pdf`;

    // Try AfipSDK PDF first (professional template)
    const accessToken = this.configService.get<string>('ARCA_ACCESS_TOKEN');
    if (accessToken) {
      try {
        const liquidacion = (comprobante as any).payment?.liquidacion;
        const property = liquidacion?.contract?.property;
        const buffer = await this.generateAfipSdkPdf(comprobante, tenant, issuer, accessToken, filename, liquidacion, property);
        return { buffer, filename };
      } catch (err) {
        this.logger.warn('AfipSDK PDF failed, falling back to pdfmake', { error: (err as Error).message });
      }
    }

    // Fallback: pdfmake
    const tenantData: TenantPdfData = {
      name: tenant.name,
      cuit: tenant.cuit,
      address: (tenant as any).address ?? null,
      fiscalCondition: issuer?.fiscalCondition ?? 'ResponsableInscripto',
    };

    const comprobanteData: ComprobantePdfData = {
      id: comprobante.id,
      cbteTipo: comprobante.cbteTipo,
      puntoDeVenta: comprobante.puntoDeVenta,
      numero: comprobante.numero,
      impTotal: comprobante.impTotal,
      impNeto: comprobante.impNeto,
      impIva: comprobante.impIva,
      impExento: comprobante.impExento,
      currency: comprobante.currency as string,
      cae: comprobante.cae,
      caeFchVto: comprobante.caeFchVto,
      emittedAt: comprobante.emittedAt,
      docTipo: comprobante.docTipo,
      docNro: comprobante.docNro,
      receptorName: comprobante.receptorName,
      receptorFiscalCondition: comprobante.receptorFiscalCondition,
    };

    const buffer = await this.generateInvoicePdf(comprobanteData, tenantData);
    return { buffer, filename };
  }

  /**
   * Generate PDF via AfipSDK's professional template API.
   */
  private async generateAfipSdkPdf(
    comprobante: any,
    tenant: any,
    issuer: any,
    accessToken: string,
    fileName: string,
    liquidacion?: any,
    property?: any,
  ): Promise<Buffer> {
    const formatDate = (d: Date | string | null) => {
      if (!d) return '';
      const dt = typeof d === 'string' ? new Date(d) : d;
      return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
    };

    // Map cbteTipo to AfipSDK template name
    const templateMap: Record<number, string> = {
      1: 'invoice-a', 6: 'invoice-b', 11: 'invoice-c',
      3: 'credit-note-a', 8: 'credit-note-b', 13: 'credit-note-c',
      2: 'debit-note-a', 7: 'debit-note-b', 12: 'debit-note-c',
    };
    const templateName = templateMap[comprobante.cbteTipo] || 'invoice-c';

    const fiscalConditionMap: Record<string, string> = {
      ResponsableInscripto: 'Responsable Inscripto',
      Monotributista: 'Monotributista',
      Exento: 'Exento',
      ConsumidorFinal: 'Consumidor Final',
      NoResponsable: 'No Responsable',
    };

    const data = {
      file_name: fileName,
      template: {
        name: templateName,
        params: {
          voucher_number: comprobante.numero,
          sales_point: comprobante.puntoDeVenta,
          issue_date: formatDate(comprobante.emittedAt),
          cae_due_date: formatDate(comprobante.caeFchVto),
          issuer_cuit: parseInt(String(issuer?.cuit ?? tenant.cuit).replace(/-/g, ''), 10),
          cae: parseInt(comprobante.cae, 10),
          issuer_business_name: issuer?.businessName || tenant.name,
          issuer_address: issuer?.businessAddress || '-',
          issuer_iva_condition: fiscalConditionMap[issuer?.fiscalCondition] || 'Monotributista',
          issuer_gross_income: issuer?.ingresosBrutos || '-',
          issuer_activity_start_date: issuer?.activityStartDate || '-',
          receiver_name: comprobante.receptorName || 'CONSUMIDOR FINAL',
          receiver_address: '-',
          receiver_document_type: comprobante.docTipo,
          receiver_document_number: parseInt(String(comprobante.docNro).replace(/-/g, ''), 10) || 0,
          receiver_iva_condition: fiscalConditionMap[comprobante.receptorFiscalCondition] || 'Consumidor Final',
          sale_condition: 'Contado',
          currency_id: 'ARS',
          currency_rate: 1,
          concept: comprobante.concepto ?? 2,
          items: [
            {
              description: property
                ? `Alquiler ${property.title || ''} - ${liquidacion?.period ? new Date(liquidacion.period).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : 'Período'}`
                : 'Alquiler - Servicio',
              quantity: 1,
              unit_price: Number(comprobante.impTotal),
              subtotal: Number(comprobante.impTotal),
            },
          ],
          vat_amount: Number(comprobante.impIva || 0),
          tributes_amount: 0,
          total_amount: Number(comprobante.impTotal),
          billing_from: liquidacion?.period
            ? formatDate(new Date(new Date(liquidacion.period).getFullYear(), new Date(liquidacion.period).getMonth(), 1))
            : formatDate(comprobante.emittedAt),
          billing_to: liquidacion?.period
            ? formatDate(new Date(new Date(liquidacion.period).getFullYear(), new Date(liquidacion.period).getMonth() + 1, 0))
            : formatDate(comprobante.emittedAt),
          payment_due_date: formatDate(comprobante.caeFchVto),
          net_amount_taxed: Number(comprobante.impNeto || comprobante.impTotal),
          net_amount_untaxed: 0,
          exempt_amount: Number(comprobante.impExento || 0),
        },
      },
    };

    // Call AfipSDK PDF REST API directly (not via SDK — createPDF doesn't exist in the JS SDK)
    const pdfApiResponse = await fetch('https://app.afipsdk.com/api/v1/pdfs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(data),
    });

    if (!pdfApiResponse.ok) {
      const errBody = await pdfApiResponse.text();
      throw new Error(`AfipSDK PDF API ${pdfApiResponse.status}: ${errBody}`);
    }

    const response = await pdfApiResponse.json();
    this.logger.log('AfipSDK PDF generated', { file: response.file });

    // Download the PDF from the temporary URL
    const pdfResponse = await fetch(response.file);
    if (!pdfResponse.ok) throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
    const arrayBuffer = await pdfResponse.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Generate a fiscal invoice PDF with QR code per RG 4892/2020.
   */
  async generateInvoicePdf(
    comprobante: ComprobantePdfData,
    tenant: TenantPdfData,
  ): Promise<Buffer> {
    const letter = getComprobanteLetter(comprobante.cbteTipo);
    const typeName = getComprobanteTypeName(comprobante.cbteTipo);
    const formattedNum = formatPuntoDeVentaNumero(
      comprobante.puntoDeVenta,
      comprobante.numero,
    );

    // Build fiscal QR
    const qrUrl = buildFiscalQrUrl({
      fecha: getIsoDate(comprobante.emittedAt),
      cuit: cuitToNumber(tenant.cuit),
      ptoVta: comprobante.puntoDeVenta,
      tipoCmp: comprobante.cbteTipo,
      nroCmp: comprobante.numero,
      importe: Number(String(comprobante.impTotal)),
      moneda: comprobante.currency === 'USD' ? 'DOL' : 'PES',
      ctz: comprobante.currency === 'USD' ? 0 : 1, // Exchange rate TBD for USD
      tipoDocRec: comprobante.docTipo,
      nroDocRec: cuitToNumber(comprobante.docNro),
      tipoCodAut: 'E',
      codAut: Number(comprobante.cae),
    });

    // Generate QR code as data URL (base64 PNG)
    const qrDataUrl: string = await QRCode.toDataURL(qrUrl, {
      width: 150,
      margin: 1,
    });

    // ─── Build PDF document definition ────────

    const content: any[] = [];

    // Header: Letter box + comprobante type
    content.push({
      columns: [
        {
          width: '*',
          stack: [
            { text: tenant.name, style: 'header' },
            { text: `CUIT: ${tenant.cuit}`, fontSize: 9 },
            tenant.address
              ? { text: tenant.address, fontSize: 9 }
              : { text: '' },
            {
              text:
                FISCAL_CONDITION_LABEL[tenant.fiscalCondition] ??
                tenant.fiscalCondition,
              fontSize: 9,
            },
          ],
        },
        {
          width: 50,
          stack: [
            {
              table: {
                body: [
                  [
                    {
                      text: letter,
                      fontSize: 24,
                      bold: true,
                      alignment: 'center',
                    },
                  ],
                ],
                widths: [40],
              },
              layout: {
                hLineWidth: () => 2,
                vLineWidth: () => 2,
              },
            },
          ],
          alignment: 'center',
        },
        {
          width: '*',
          stack: [
            {
              text: `${typeName} ${letter}`,
              style: 'header',
              alignment: 'right',
            },
            {
              text: `Nº ${formattedNum}`,
              fontSize: 12,
              bold: true,
              alignment: 'right',
            },
            {
              text: `Fecha: ${formatDate(comprobante.emittedAt)}`,
              fontSize: 9,
              alignment: 'right',
            },
          ],
        },
      ],
      margin: [0, 0, 0, 15] as [number, number, number, number],
    });

    // Separator
    content.push({
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1 },
      ],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });

    // Receptor info
    const receptorFcLabel =
      FISCAL_CONDITION_LABEL[comprobante.receptorFiscalCondition] ??
      comprobante.receptorFiscalCondition;
    const receptorDocLabel = comprobante.docTipo === 80 ? 'CUIT' : comprobante.docTipo === 96 ? 'DNI' : 'Doc';

    content.push({
      columns: [
        {
          width: '*',
          stack: [
            {
              text: `Señor/a: ${comprobante.receptorName}`,
              fontSize: 10,
              bold: true,
            },
            {
              text: `${receptorDocLabel}: ${comprobante.docNro}`,
              fontSize: 9,
            },
            { text: `Condición IVA: ${receptorFcLabel}`, fontSize: 9 },
          ],
        },
      ],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });

    // Separator
    content.push({
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 },
      ],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });

    // Amounts section — varies by letter
    if (letter === 'A') {
      // Letter A: IVA discriminated
      content.push({
        table: {
          headerRows: 1,
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Concepto', bold: true },
              { text: 'Importe', bold: true, alignment: 'right' },
            ],
            [
              comprobante.description ?? 'Servicios de alquiler',
              {
                text: `$ ${formatAmount(comprobante.impNeto)}`,
                alignment: 'right',
              },
            ],
          ],
        },
        margin: [0, 0, 0, 10] as [number, number, number, number],
      });

      content.push({
        columns: [
          { text: '', width: '*' },
          {
            width: 'auto',
            table: {
              body: [
                [
                  { text: 'Subtotal (Neto):', bold: true },
                  {
                    text: `$ ${formatAmount(comprobante.impNeto)}`,
                    alignment: 'right',
                  },
                ],
                [
                  { text: 'IVA 21%:' },
                  {
                    text: `$ ${formatAmount(comprobante.impIva)}`,
                    alignment: 'right',
                  },
                ],
                [
                  { text: 'Total:', bold: true, fontSize: 12 },
                  {
                    text: `$ ${formatAmount(comprobante.impTotal)}`,
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
        margin: [0, 0, 0, 15] as [number, number, number, number],
      });
    } else if (letter === 'B') {
      // Letter B: IVA included
      content.push({
        table: {
          headerRows: 1,
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Concepto', bold: true },
              { text: 'Importe', bold: true, alignment: 'right' },
            ],
            [
              comprobante.description ?? 'Servicios de alquiler',
              {
                text: `$ ${formatAmount(comprobante.impTotal)}`,
                alignment: 'right',
              },
            ],
          ],
        },
        margin: [0, 0, 0, 10] as [number, number, number, number],
      });

      content.push({
        columns: [
          { text: '', width: '*' },
          {
            width: 'auto',
            table: {
              body: [
                [
                  { text: 'Total (IVA incluido):', bold: true, fontSize: 12 },
                  {
                    text: `$ ${formatAmount(comprobante.impTotal)}`,
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
        margin: [0, 0, 0, 15] as [number, number, number, number],
      });
    } else {
      // Letter C: No IVA
      content.push({
        table: {
          headerRows: 1,
          widths: ['*', 'auto'],
          body: [
            [
              { text: 'Concepto', bold: true },
              { text: 'Importe', bold: true, alignment: 'right' },
            ],
            [
              comprobante.description ?? 'Servicios de alquiler',
              {
                text: `$ ${formatAmount(comprobante.impTotal)}`,
                alignment: 'right',
              },
            ],
          ],
        },
        margin: [0, 0, 0, 10] as [number, number, number, number],
      });

      content.push({
        columns: [
          { text: '', width: '*' },
          {
            width: 'auto',
            table: {
              body: [
                [
                  { text: 'Total:', bold: true, fontSize: 12 },
                  {
                    text: `$ ${formatAmount(comprobante.impTotal)}`,
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
        margin: [0, 0, 0, 15] as [number, number, number, number],
      });
    }

    // Separator
    content.push({
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 },
      ],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });

    // CAE info
    content.push({
      columns: [
        {
          width: '*',
          stack: [
            {
              text: `CAE: ${comprobante.cae}`,
              fontSize: 10,
              bold: true,
            },
            {
              text: `Fecha de Vencimiento CAE: ${formatDate(comprobante.caeFchVto)}`,
              fontSize: 9,
            },
          ],
        },
        {
          width: 160,
          image: qrDataUrl,
          fit: [150, 150],
          alignment: 'right' as const,
        },
      ],
      margin: [0, 0, 0, 10] as [number, number, number, number],
    });

    const docDefinition: any = {
      content,
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          {
            text: `CUIT: ${tenant.cuit}`,
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
        header: { fontSize: 16, bold: true },
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
      this.logger.error('Fiscal PDF generation failed', {
        comprobanteId: comprobante.id,
        cbteTipo: comprobante.cbteTipo,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
