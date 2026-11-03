import { Injectable, Logger } from '@nestjs/common';
import { extractText, getDocumentProxy } from 'unpdf';

/** Páginas que se leen de un documento: una boleta tiene pocas y un resumen de cuenta, algunas más. */
const MAX_PAGES = 30;

/** `%PDF-` al principio: lo que dice el tipo del archivo no alcanza. */
export const isPdf = (content: Buffer): boolean => content.subarray(0, 5).toString('latin1') === '%PDF-';

export class PdfUnreadableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfUnreadableError';
  }
}

/** Texto de un PDF con `unpdf` (PDF.js sin binarios nativos). No hace OCR: un escaneo da texto vacío. */
@Injectable()
export class PdfTextService {
  private readonly logger = new Logger(PdfTextService.name);

  async extract(content: Buffer): Promise<string> {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(content));
      if (pdf.numPages > MAX_PAGES) throw new PdfUnreadableError(`PDF with ${pdf.numPages} pages`);
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    } catch (error) {
      if (error instanceof PdfUnreadableError) throw error;
      this.logger.warn(`PDF text extraction failed: ${(error as Error).message}`);
      throw new PdfUnreadableError((error as Error).message);
    }
  }
}
