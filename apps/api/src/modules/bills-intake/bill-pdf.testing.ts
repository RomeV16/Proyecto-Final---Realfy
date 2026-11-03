import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { PdfTextService, PdfUnreadableError } from './pdf-text.service';

/**
 * PDF mínimo con texto, para las pruebas: cada elemento es una línea suelta en una
 * posición de la página (como el texto de un PDF real, que no viene en orden de lectura).
 * Usa Helvetica sin incrustar, sin comprimir, y escribe sólo caracteres de Latin-1.
 */
export interface PdfTextItem {
  text: string;
  x: number;
  y: number;
  size?: number;
}

const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Lleva una lista de líneas a posiciones de arriba hacia abajo, a 14 puntos entre sí. */
export function stack(lines: string[], x = 40, top = 800): PdfTextItem[] {
  return lines.map((text, i) => ({ text, x, y: top - i * 14 }));
}

/** Un PDF por página (cada página con sus elementos). */
export function buildTextPdf(pages: PdfTextItem[][]): Buffer {
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((items, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const stream = items
      .map((it) => `BT /F1 ${it.size ?? 10} Tf 1 0 0 1 ${it.x} ${it.y} Tm (${escape(it.text)}) Tj ET`)
      .join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Un PDF de una página con las líneas apiladas de arriba hacia abajo. */
export function simplePdf(lines: string[]): Buffer {
  return buildTextPdf([stack(lines)]);
}

/**
 * Extracción de texto para las pruebas: `unpdf` carga PDF.js con un `import()` dinámico que
 * Jest no admite sin banderas especiales, así que la lectura real corre en un proceso de
 * Node aparte. Es la misma librería y la misma llamada que usa `PdfTextService`.
 */
export class NodePdfTextService extends PdfTextService {
  override async extract(content: Buffer): Promise<string> {
    const script = [
      "const { extractText, getDocumentProxy } = require('unpdf');",
      'const chunks = [];',
      "process.stdin.on('data', (d) => chunks.push(d)).on('end', async () => {",
      '  const pdf = await getDocumentProxy(new Uint8Array(Buffer.concat(chunks)));',
      '  const { text } = await extractText(pdf, { mergePages: true });',
      '  process.stdout.write(text);',
      '});',
    ].join('\n');
    return new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script], { cwd: join(__dirname, '..', '..', '..') });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => out.push(d));
      child.stderr.on('data', (d: Buffer) => err.push(d));
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new PdfUnreadableError(Buffer.concat(err).toString('utf8').slice(0, 300))),
      );
      child.stdin.end(content);
    });
  }
}
