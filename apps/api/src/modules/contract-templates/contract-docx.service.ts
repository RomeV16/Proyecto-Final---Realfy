import { Injectable, Logger } from '@nestjs/common';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  HeadingLevel,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
} from 'docx';

interface DocumentMetadata {
  title: string;
  contractType: string;
  tenantName?: string;
}

@Injectable()
export class ContractDocxService {
  private readonly logger = new Logger(ContractDocxService.name);

  /**
   * Generate a DOCX buffer from already-interpolated text.
   * Splits text on newlines and renders each line as a docx Paragraph.
   */
  async generateDocx(
    resolvedText: string,
    metadata: DocumentMetadata,
  ): Promise<Buffer> {
    const lines = resolvedText.split('\n');

    const children: Paragraph[] = [];

    // Title paragraph
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        heading: HeadingLevel.HEADING_1,
        children: [
          new TextRun({
            text: metadata.title,
            bold: true,
            size: 28,
          }),
        ],
        spacing: { after: 200 },
      }),
    );

    // Tenant name as subtitle
    if (metadata.tenantName) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: metadata.tenantName,
              size: 22,
              italics: true,
            }),
          ],
          spacing: { after: 300 },
        }),
      );
    }

    // Body paragraphs
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        // Empty line → blank paragraph for spacing
        children.push(new Paragraph({ children: [] }));
      } else {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: trimmed,
                size: 22, // 11pt
              }),
            ],
            spacing: { after: 80 },
          }),
        );
      }
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch in twips
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
              pageNumbers: {
                start: 1,
                formatType: NumberFormat.DECIMAL,
              },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: metadata.tenantName ?? '',
                      size: 16,
                      italics: true,
                    }),
                  ],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES],
                      size: 16,
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    try {
      const buffer = await Packer.toBuffer(doc);
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error('Contract DOCX generation failed', {
        title: metadata.title,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
