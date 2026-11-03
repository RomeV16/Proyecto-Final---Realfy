import { ContractDocxService } from './contract-docx.service';
import { docxParagraphs, readDocxEntry } from './docx.testing';

describe('ContractDocxService', () => {
  const service = new ContractDocxService();
  const meta = { title: 'Contrato de prueba', contractType: 'Alquiler', tenantName: 'Inmobiliaria Demo' };

  it('un renglón es un párrafo justificado; # es título centrado y ** negrita', async () => {
    const buffer = await service.generateDocx('# CLÁUSULAS\nPRIMERA: **objeto** del contrato.\n\nSegunda línea', meta);
    const xml = readDocxEntry(buffer, 'word/document.xml');

    expect(xml).toContain('CLÁUSULAS');
    expect(xml).toContain('w:jc w:val="both"');
    expect(xml).toMatch(/<w:b\/>[^]*?objeto/);
    expect(xml).toContain('Segunda línea');
    expect(xml).toContain('w:pStyle w:val="Heading2"');
  });

  it('el texto de los párrafos sale en orden, con el título, la inmobiliaria y los renglones vacíos', async () => {
    const buffer = await service.generateDocx('Uno & <dos>\n\n**Tres**', meta);
    expect(docxParagraphs(buffer).filter((p, i, all) => i < all.length)).toEqual(
      expect.arrayContaining(['Contrato de prueba', 'Inmobiliaria Demo', 'Uno & <dos>', 'Tres']),
    );
  });

  it('sin nombre de inmobiliaria genera igual', async () => {
    const buffer = await service.generateDocx('Texto', { title: 'Sin nombre', contractType: 'Alquiler' });
    expect(readDocxEntry(buffer, 'word/document.xml')).toContain('Texto');
  });
});
