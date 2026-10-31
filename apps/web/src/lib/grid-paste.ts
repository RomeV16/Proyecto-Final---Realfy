/**
 * Texto pegado desde una planilla (Excel, Sheets, LibreOffice) → matriz de celdas.
 * Las filas se separan por salto de línea y las columnas por tabulación; una
 * celda entre comillas puede contener tabulaciones y saltos (`""` es una comilla).
 * Devuelve `null` si el texto no es de una planilla (un solo valor, sin
 * tabulaciones ni saltos), para que el campo lo pegue como siempre.
 */
export function parseClipboardGrid(text: string): string[][] | null {
  if (!/[\t\r\n]/.test(text)) return null;

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let atCellStart = true;

  const endCell = () => {
    row.push(cell);
    cell = '';
    atCellStart = true;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
    } else if (ch === '\t') {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      cell += ch;
      atCellStart = false;
    }
  }
  // La última fila se cierra sola, salvo que el texto termine en salto de línea.
  if (cell !== '' || row.length > 0) endRow();

  return rows;
}
