import { Injectable, Logger } from '@nestjs/common';
import { parseDocumentText } from '@realfy/shared';
import { PdfRendererService, pageFooter } from '../../common/pdf/pdf-renderer.service';

interface DocumentMetadata {
  title: string;
  contractType: string;
  tenantName?: string;
}

@Injectable()
export class ContractPdfService {
  private readonly logger = new Logger(ContractPdfService.name);

  constructor(private readonly renderer: PdfRendererService) {}

  /**
   * Generate a PDF buffer from already-interpolated text.
   * Each line is a paragraph (justified); `# Title` is a centered heading and
   * `**text**` is bold.
   */
  async generatePdf(
    resolvedText: string,
    metadata: DocumentMetadata,
  ): Promise<Buffer> {
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
    for (const line of parseDocumentText(resolvedText)) {
      if (line.kind === 'blank') {
        content.push({ text: ' ', fontSize: 6, margin: [0, 2, 0, 2] as [number, number, number, number] });
      } else if (line.kind === 'heading') {
        content.push({
          text: line.text,
          bold: true,
          fontSize: 12,
          alignment: 'center' as const,
          margin: [0, 8, 0, 4] as [number, number, number, number],
        });
      } else {
        content.push({
          text: line.segments.map((s) => (s.bold ? { text: s.text, bold: true } : { text: s.text })),
          alignment: 'justify' as const,
          margin: [0, 1, 0, 1] as [number, number, number, number],
        });
      }
    }

    const docDefinition: any = {
      content,
      footer: pageFooter(metadata.title),
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
      return await this.renderer.render(docDefinition);
    } catch (error) {
      this.logger.error('Contract PDF generation failed', {
        title: metadata.title,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
