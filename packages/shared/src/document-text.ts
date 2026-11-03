/**
 * Formato mínimo del texto de un contrato ya resuelto, común al PDF y al DOCX:
 * un renglón es un párrafo; `# Título` es un título centrado y `**texto**`, negrita.
 */

export interface TextSegment {
  text: string;
  bold: boolean;
}

export type DocumentLine =
  | { kind: 'blank' }
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; segments: TextSegment[] };

const BOLD = /\*\*(.+?)\*\*/g;

/** Parte un renglón en tramos normales y en negrita; un `**` sin cierre queda como texto. */
export function parseInlineBold(line: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const m of line.matchAll(BOLD)) {
    if (m.index > last) segments.push({ text: line.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) segments.push({ text: line.slice(last), bold: false });
  return segments;
}

/** Clasifica cada renglón del texto resuelto. */
export function parseDocumentText(text: string): DocumentLine[] {
  return text.split('\n').map((raw): DocumentLine => {
    const line = raw.trim();
    if (line === '') return { kind: 'blank' };
    if (line.startsWith('# ') && line.slice(2).trim()) return { kind: 'heading', text: line.slice(2).trim() };
    return { kind: 'paragraph', segments: parseInlineBold(line) };
  });
}
