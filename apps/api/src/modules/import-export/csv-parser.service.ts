import { Injectable, Logger } from '@nestjs/common';

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  /**
   * Parse a CSV buffer with automatic encoding detection (Latin-1 → UTF-8)
   * and delimiter detection (comma, semicolon, tab).
   */
  parse(buffer: Buffer): ParsedCsv {
    const text = this.decodeBuffer(buffer);
    const delimiter = this.detectDelimiter(text);

    this.logger.log(
      `CSV parse: encoding detected, delimiter="${delimiter === '\t' ? 'TAB' : delimiter}"`,
    );

    const rows = this.parseCsvText(text, delimiter);

    if (rows.length === 0) {
      return { headers: [], rows: [] };
    }

    const headers = rows[0].map((h) => h.trim());
    const dataRows = rows.slice(1).filter((row) =>
      row.some((cell) => cell.trim() !== ''),
    );

    return { headers, rows: dataRows };
  }

  /**
   * Decode buffer with automatic encoding detection.
   * Checks for UTF-8 BOM first, then tries UTF-8, falls back to Latin-1.
   */
  private decodeBuffer(buffer: Buffer): string {
    // Check for UTF-8 BOM
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return buffer.subarray(3).toString('utf-8');
    }

    // Try UTF-8 first — if it has invalid sequences, fall back to Latin-1
    const utf8 = buffer.toString('utf-8');
    if (!this.hasReplacementChars(utf8, buffer)) {
      return utf8;
    }

    this.logger.log('CSV encoding: Latin-1 detected, converting to UTF-8');
    return buffer.toString('latin1');
  }

  /**
   * Detect whether UTF-8 decoding produced replacement characters
   * indicating the source is likely Latin-1.
   */
  private hasReplacementChars(text: string, original: Buffer): boolean {
    // Check for replacement character (U+FFFD) which indicates bad UTF-8
    if (text.includes('�')) return true;

    // Heuristic: if decoding as UTF-8 and re-encoding doesn't match original bytes,
    // there were encoding issues. Check for common Latin-1 chars (0x80-0xFF range)
    // that aren't valid UTF-8 start bytes.
    for (let i = 0; i < original.length; i++) {
      const byte = original[i];
      // Bytes 0x80-0xBF are continuation bytes in UTF-8, not valid as starters
      // Bytes 0xC0-0xC1 are overlong UTF-8 sequences
      // Bytes 0xFE-0xFF are never valid in UTF-8
      if (byte >= 0x80 && byte <= 0xBF) {
        // Check if this is a valid continuation byte (preceded by a valid start byte)
        if (i === 0) return true;
        const prev = original[i - 1];
        if (prev < 0xC2 || prev > 0xF4) return true;
      }
    }

    return false;
  }

  /**
   * Auto-detect the delimiter by counting occurrences in the first few lines.
   */
  private detectDelimiter(text: string): string {
    const firstLines = text.split('\n').slice(0, 5).join('\n');
    const candidates = [',', ';', '\t'];

    let bestDelim = ',';
    let bestCount = 0;

    for (const delim of candidates) {
      // Count occurrences outside of quoted fields
      let count = 0;
      let inQuotes = false;
      for (const ch of firstLines) {
        if (ch === '"') inQuotes = !inQuotes;
        if (!inQuotes && ch === delim) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestDelim = delim;
      }
    }

    return bestDelim;
  }

  /**
   * Parse CSV text respecting quoted fields, embedded newlines, and escaped quotes.
   */
  private parseCsvText(text: string, delimiter: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentField = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          // Check for escaped quote ("")
          if (i + 1 < text.length && text[i + 1] === '"') {
            currentField += '"';
            i += 2;
            continue;
          }
          // End of quoted field
          inQuotes = false;
          i++;
          continue;
        }
        currentField += ch;
        i++;
        continue;
      }

      // Not in quotes
      if (ch === '"' && currentField === '') {
        inQuotes = true;
        i++;
        continue;
      }

      if (ch === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      }

      if (ch === '\r') {
        // Handle \r\n or bare \r
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++; // skip \r, \n handled next
        }
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      }

      if (ch === '\n') {
        currentRow.push(currentField);
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
        i++;
        continue;
      }

      currentField += ch;
      i++;
    }

    // Handle last field/row
    if (currentField !== '' || currentRow.length > 0) {
      currentRow.push(currentField);
      rows.push(currentRow);
    }

    return rows;
  }
}
