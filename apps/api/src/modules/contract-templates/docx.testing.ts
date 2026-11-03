import { inflateRawSync } from 'node:zlib';

/** Contenido de un archivo del .docx (que es un zip): se busca la entrada por nombre y se descomprime. */
export function readDocxEntry(docx: Buffer, name: string): string {
  let offset = 0;
  while (offset + 30 < docx.length && docx.readUInt32LE(offset) === 0x04034b50) {
    const method = docx.readUInt16LE(offset + 8);
    const compressed = docx.readUInt32LE(offset + 18);
    const nameLength = docx.readUInt16LE(offset + 26);
    const extraLength = docx.readUInt16LE(offset + 28);
    const entryName = docx.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    if (entryName === name) {
      const data = docx.subarray(start, start + compressed);
      return (method === 8 ? inflateRawSync(data) : data).toString('utf8');
    }
    offset = start + compressed;
  }
  throw new Error(`El .docx no tiene ${name}`);
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Texto de cada párrafo del cuerpo del .docx, en orden. */
export function docxParagraphs(docx: Buffer): string[] {
  const xml = readDocxEntry(docx, 'word/document.xml');
  return [...xml.matchAll(/<w:p[ >][^]*?<\/w:p>/g)].map((p) =>
    decode([...p[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join('')),
  );
}
