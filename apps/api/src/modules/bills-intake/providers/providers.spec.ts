import { BILL_PROVIDER_KEYS, BILL_PROVIDER_SERVICE_TYPES, BillChannel } from '@realfy/shared';
import { NodePdfTextService, simplePdf } from '../bill-pdf.testing';
import { BILL_PROVIDERS, detectProvider, getProvider, normalizeAccount, readBill } from './index';
import {
  aguasInvoiceLines,
  aguasStatementLines,
  ecogasLines,
  epecLines,
  muniCurrentLines,
  muniLegacyLines,
  rentasCurrentLines,
  rentasLegacyLines,
  unknownLines,
} from './bill-text.testing';

const text = (lines: string[]) => lines.join('\n');

describe('catálogo de proveedores', () => {
  it('tiene un proveedor por cada clave del catálogo compartido, sin repetir, y el genérico va último', () => {
    expect(BILL_PROVIDERS.map((p) => p.key).sort((a, b) => a.localeCompare(b))).toEqual(
      [...BILL_PROVIDER_KEYS].sort((a, b) => a.localeCompare(b)),
    );
    expect(BILL_PROVIDERS[BILL_PROVIDERS.length - 1].key).toBe('generico');
  });

  it.each(BILL_PROVIDERS.map((p) => [p.key, p] as const))('%s: tipos de servicio, canales y firmas coherentes', (key, provider) => {
    expect(provider.serviceTypes).toEqual(BILL_PROVIDER_SERVICE_TYPES[key]);
    expect(provider.channels).toContain(BillChannel.Archivo);
    expect(provider.name.length).toBeGreaterThan(0);
    if (key === 'generico') expect(provider.signatures).toEqual([]);
    else expect(provider.signatures.length).toBeGreaterThan(0);
  });

  it('getProvider devuelve la definición por clave y nada para una clave desconocida', () => {
    expect(getProvider('epec')?.name).toBe('EPEC');
    expect(getProvider('otro')).toBeUndefined();
  });

  it('normalizeAccount usa el formato del proveedor y devuelve null si no es válido o no hay proveedor', () => {
    expect(normalizeAccount('aguas-cordobesas', 'UF 1234')).toBe('001234');
    expect(normalizeAccount('rentas-cordoba', '1100-00000001')).toBe('110000000001');
    expect(normalizeAccount('rentas-cordoba', '123')).toBeNull();
    expect(normalizeAccount('inexistente', '123456')).toBeNull();
  });
});

describe('detección por firmas', () => {
  it.each([
    ['aguas-cordobesas', aguasInvoiceLines()],
    ['aguas-cordobesas', aguasStatementLines([{ num: 'FC-0010-00000001', periodo: '10/2026', venc: '12/11/2026', amount: '1,00' }])],
    ['muni-cordoba', muniCurrentLines()],
    ['muni-cordoba', muniLegacyLines()],
    ['rentas-cordoba', rentasCurrentLines()],
    ['rentas-cordoba', rentasLegacyLines()],
    ['epec', epecLines()],
    ['ecogas', ecogasLines()],
  ])('reconoce %s', (key, lines) => {
    expect(detectProvider(text(lines))?.key).toBe(key);
  });

  it('no reconoce un documento sin firma, ni la página de datos de la Municipalidad', () => {
    expect(detectProvider(text(unknownLines()))).toBeNull();
    expect(detectProvider('Municipalidad de Córdoba\nInforme de deuda del inmueble')).toBeNull();
  });

  it('un empate entre dos proveedores no reconoce a ninguno', () => {
    expect(detectProvider('Contribución sobre los Inmuebles\nF-1010')).toBeNull();
  });
});

describe('readBill', () => {
  it('con proveedor reconocido lee con su lector', () => {
    const result = readBill(text(epecLines()));
    expect(result.detected).toBe(true);
    expect(result.providerKey).toBe('epec');
    expect(result.data?.lines).toHaveLength(1);
  });

  it('sin proveedor reconocido cae en el lector genérico y lo marca como no reconocido', () => {
    const result = readBill(text(unknownLines()));
    expect(result.detected).toBe(false);
    expect(result.providerKey).toBe('generico');
    expect(result.data?.confidence).toBeLessThanOrEqual(0.5);
  });

  it('un texto vacío no da lectura', () => {
    expect(readBill('').data).toBeNull();
  });
});

describe('del PDF al lector', () => {
  const pdfText = new NodePdfTextService();
  const readPdf = async (lines: string[]) => readBill(await pdfText.extract(simplePdf(lines)));

  it.each([
    ['aguas-cordobesas', aguasInvoiceLines(), '22238.93'],
    ['muni-cordoba', muniCurrentLines(), '12345.67'],
    ['muni-cordoba', muniLegacyLines(), '490.00'],
    ['rentas-cordoba', rentasCurrentLines(), '18303.87'],
    ['rentas-cordoba', rentasLegacyLines(), '1273.60'],
  ])('%s: un PDF con el texto de la boleta se lee igual que el texto', async (key, lines, amount) => {
    const result = await readPdf(lines);
    expect(result.providerKey).toBe(key);
    expect(result.detected).toBe(true);
    expect(result.data?.lines[0].amount).toBe(amount);
    expect(result.data?.confidence).toBe(1);
  });
});
