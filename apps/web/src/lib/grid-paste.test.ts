import { describe, expect, it } from 'vitest';
import { parseClipboardGrid } from './grid-paste';

describe('parseClipboardGrid', () => {
  it('un texto simple no es de planilla', () => {
    expect(parseClipboardGrid('hola')).toBeNull();
    expect(parseClipboardGrid('')).toBeNull();
  });

  it('separa columnas por tabulación y filas por salto de línea', () => {
    expect(parseClipboardGrid('a\tb\tc\n1\t2\t3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('acepta saltos de línea de Windows y descarta el salto final', () => {
    expect(parseClipboardGrid('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('una sola fila con tabulaciones es una fila de varias celdas', () => {
    expect(parseClipboardGrid('x\ty')).toEqual([['x', 'y']]);
  });

  it('conserva las celdas vacías en el medio y al final', () => {
    expect(parseClipboardGrid('a\t\tc\n\tb\t')).toEqual([
      ['a', '', 'c'],
      ['', 'b', ''],
    ]);
  });

  it('una columna con varias filas', () => {
    expect(parseClipboardGrid('1\n2\n3')).toEqual([['1'], ['2'], ['3']]);
  });

  it('las celdas entre comillas pueden llevar tabulaciones, saltos y comillas dobles', () => {
    expect(parseClipboardGrid('"uno\ndos"\t"a\tb"\n"di ""hola"""\tfin')).toEqual([
      ['uno\ndos', 'a\tb'],
      ['di "hola"', 'fin'],
    ]);
  });

  it('una comilla en medio de una celda es un carácter común', () => {
    expect(parseClipboardGrid('5"\tb')).toEqual([['5"', 'b']]);
  });
});
