import { parseDocumentText, parseInlineBold } from './document-text';

describe('parseInlineBold', () => {
  it('separa los tramos en negrita', () => {
    expect(parseInlineBold('PRIMERO: **Objeto**. Texto **otro** fin')).toEqual([
      { text: 'PRIMERO: ', bold: false },
      { text: 'Objeto', bold: true },
      { text: '. Texto ', bold: false },
      { text: 'otro', bold: true },
      { text: ' fin', bold: false },
    ]);
  });

  it('un renglón sin marcas es un solo tramo; un ** sin cierre queda como texto', () => {
    expect(parseInlineBold('Texto')).toEqual([{ text: 'Texto', bold: false }]);
    expect(parseInlineBold('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
    expect(parseInlineBold('')).toEqual([]);
    expect(parseInlineBold('**todo**')).toEqual([{ text: 'todo', bold: true }]);
  });
});

describe('parseDocumentText', () => {
  it('clasifica renglones vacíos, títulos y párrafos', () => {
    expect(parseDocumentText('# CONTRATO\n\n  Cláusula **uno**  \n#sin espacio\n# ')).toEqual([
      { kind: 'heading', text: 'CONTRATO' },
      { kind: 'blank' },
      { kind: 'paragraph', segments: [{ text: 'Cláusula ', bold: false }, { text: 'uno', bold: true }] },
      { kind: 'paragraph', segments: [{ text: '#sin espacio', bold: false }] },
      { kind: 'paragraph', segments: [{ text: '#', bold: false }] },
    ]);
  });
});
