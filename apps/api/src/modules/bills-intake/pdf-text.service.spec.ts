import { NodePdfTextService, buildTextPdf, simplePdf, stack } from './bill-pdf.testing';
import { PdfTextService, PdfUnreadableError } from './pdf-text.service';

const mockExtract = jest.fn();
const mockProxy = jest.fn();
jest.mock('unpdf', () => ({
  getDocumentProxy: (...args: unknown[]) => mockProxy(...args),
  extractText: (...args: unknown[]) => mockExtract(...args),
}));

describe('PdfTextService', () => {
  beforeEach(() => jest.resetAllMocks());

  it('devuelve el texto de todas las páginas unido', async () => {
    mockProxy.mockResolvedValue({ numPages: 2 });
    mockExtract.mockResolvedValue({ text: 'hola\nmundo' });
    await expect(new PdfTextService().extract(Buffer.from('%PDF-'))).resolves.toBe('hola\nmundo');
    expect(mockExtract).toHaveBeenCalledWith({ numPages: 2 }, { mergePages: true });
  });

  it('rechaza un documento con demasiadas páginas', async () => {
    mockProxy.mockResolvedValue({ numPages: 31 });
    await expect(new PdfTextService().extract(Buffer.from('%PDF-'))).rejects.toBeInstanceOf(PdfUnreadableError);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('convierte cualquier fallo de la librería en PdfUnreadableError', async () => {
    mockProxy.mockRejectedValue(new Error('Invalid PDF structure'));
    await expect(new PdfTextService().extract(Buffer.from('basura'))).rejects.toThrow(PdfUnreadableError);
  });
});

describe('lectura real de un PDF con unpdf (proceso aparte)', () => {
  it('extrae el texto de un PDF de varias páginas con acentos y posiciones sueltas', async () => {
    const pdf = buildTextPdf([
      [...stack(['Contribución sobre los Inmuebles', 'Año Cuota']), { text: 'Total: $1.234,56', x: 300, y: 700 }],
      stack(['Segunda página']),
    ]);
    const text = await new NodePdfTextService().extract(pdf);
    expect(text).toContain('Contribución sobre los Inmuebles');
    expect(text).toContain('Total: $1.234,56');
    expect(text).toContain('Segunda página');
  });

  it('falla con un archivo que no es un PDF', async () => {
    await expect(new NodePdfTextService().extract(Buffer.from('no soy un pdf'))).rejects.toThrow(PdfUnreadableError);
  });

  it('un PDF sin texto da texto vacío', async () => {
    expect((await new NodePdfTextService().extract(simplePdf([]))).trim()).toBe('');
  });
});
