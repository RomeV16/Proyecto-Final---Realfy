import { ecogas, normalizeEcogasAccount } from './ecogas';
import { epec, normalizeEpecAccount } from './epec';
import { generico, normalizeGenericAccount } from './generico';
import { ecogasLines, epecLines, unknownLines } from './bill-text.testing';

describe('lectores por etiquetas (EPEC, Ecogas y genérico)', () => {
  it('EPEC lee contrato, período (mes de la fecha final), total y vencimiento, con confianza topada en 0,6', () => {
    const data = epec.parse(epecLines().join('\n'))!;
    expect(data.providerKey).toBe('epec');
    expect(data.accountNumbers).toEqual(['1234567']);
    expect(data.lines).toEqual([expect.objectContaining({ period: '2026-10-01', amount: '15432.10', dueDate: '2026-11-12' })]);
    expect(data.confidence).toBe(0.6);
  });

  it('Ecogas lee cuenta, período mes/año, total y vencimiento, con confianza topada en 0,6', () => {
    const data = ecogas.parse(ecogasLines().join('\n'))!;
    expect(data.providerKey).toBe('ecogas');
    expect(data.accountNumbers).toEqual(['7654321']);
    expect(data.lines).toEqual([expect.objectContaining({ period: '2026-09-01', amount: '8765.40', dueDate: '2026-11-12' })]);
    expect(data.confidence).toBe(0.6);
  });

  it('sin período toma el mes de la emisión; sin vencimiento lo avisa y baja la confianza', () => {
    const data = ecogas.parse(ecogasLines().filter((l) => !/Período|Vencimiento/.test(l)).join('\n'))!;
    expect(data.lines[0].period).toBe('2026-11-01');
    expect(data.lines[0].dueDate).toBeNull();
    expect(data.warnings).toContain('NO_DUE_DATE');
    expect(data.confidence).toBeLessThanOrEqual(0.6);
  });

  it('el genérico lee lo mismo por sus etiquetas pero nunca pasa de 0,5', () => {
    const data = generico.parse(unknownLines().join('\n'))!;
    expect(data.providerKey).toBe('generico');
    expect(data.accountNumbers).toEqual(['ABC1234']);
    expect(data.lines).toEqual([expect.objectContaining({ period: '2026-11-01', amount: '3210.00', dueDate: '2026-11-12' })]);
    expect(data.confidence).toBeLessThanOrEqual(0.5);
  });

  it('sin cuenta ni total no hay lectura; con el total pero sin cuenta lo avisa', () => {
    expect(generico.parse('Un texto cualquiera')).toBeNull();
    const data = generico.parse('Vencimiento: 12/11/2026\nTotal a pagar $ 100,00\nFecha de emisión: 02/11/2026')!;
    expect(data.accountNumbers).toEqual([]);
    expect(data.warnings).toContain('NO_ACCOUNT');
  });

  it('sin total avisa que falta el importe y no arma ninguna boleta', () => {
    const data = generico.parse('Cliente N° 123456\nVencimiento: 12/11/2026')!;
    expect(data.lines).toEqual([]);
    expect(data.warnings).toContain('NO_AMOUNT');
  });

  it.each([
    [normalizeEpecAccount, '12-345-678', '12345678'],
    [normalizeEcogasAccount, '7654321', '7654321'],
    [normalizeGenericAccount, 'abc-12.34', 'ABC1234'],
  ])('normaliza los identificadores', (normalize, raw, expected) => {
    expect(normalize(raw)).toBe(expected);
  });

  it.each([
    [epec, '12'],
    [epec, '123456789012345'],
    [ecogas, 'abc'],
    [generico, '--'],
  ])('rechaza identificadores fuera de formato', (provider, raw) => {
    expect(provider.accountSchema.safeParse(raw).success).toBe(false);
  });
});
