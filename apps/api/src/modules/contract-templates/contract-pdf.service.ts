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

interface DocumentMetadata {
  title: string;
  contractType: string;
  tenantName?: string;
}

@Injectable()
export class ContractPdfService {
  private readonly logger = new Logger(ContractPdfService.name);

  /**
   * Generate a PDF buffer from already-interpolated text.
   * Splits text on newlines and renders each line as a pdfmake Paragraph.
   */
  async generatePdf(
    resolvedText: string,
    metadata: DocumentMetadata,
  ): Promise<Buffer> {
    const lines = resolvedText.split('\n');

    const content: any[] = [
      // Header: tenant name if available
      ...(metadata.tenantName
        ? [
            {
              text: metadata.tenantName,
              style: 'header',
              alignment: 'center' as const,
              margin: [0, 0, 0, 5] as [number, number, number, number],
            },
          ]
        : []),
      {
        text: metadata.title,
        style: 'title',
        alignment: 'center' as const,
        margin: [0, 5, 0, 15] as [number, number, number, number],
      },
    ];

    // Render each line — blank lines get a smaller spacer
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        content.push({ text: ' ', fontSize: 6, margin: [0, 2, 0, 2] as [number, number, number, number] });
      } else {
        content.push({ text: trimmed, margin: [0, 1, 0, 1] as [number, number, number, number] });
      }
    }

    const docDefinition: any = {
      content,
      footer: (currentPage: number, pageCount: number) => ({
        columns: [
          {
            text: metadata.title,
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
        title: { fontSize: 13, bold: true },
      },
      defaultStyle: {
        fontSize: 10,
        lineHeight: 1.3,
      },
      pageMargins: [40, 40, 40, 40],
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
      this.logger.error('Contract PDF generation failed', {
        title: metadata.title,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
