import {
  dniFromCuit,
  normalizeCbu,
  normalizeCuit,
  normalizeDni,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from './normalize';

describe('normalización para comparar personas', () => {
  it('CUIT: sólo dígitos y 11 de largo', () => {
    expect(normalizeCuit('20-12345678-6')).toBe('20123456786');
    expect(normalizeCuit(' 20 12345678 6 ')).toBe('20123456786');
    expect(normalizeCuit('2012345678')).toBeNull();
    expect(normalizeCuit(null)).toBeNull();
  });

  it('DNI: sin puntos ni ceros a la izquierda, de 7 a 8 dígitos', () => {
    expect(normalizeDni('12.345.678')).toBe('12345678');
    expect(normalizeDni('012345678')).toBe('12345678');
    expect(normalizeDni('123')).toBeNull();
    expect(normalizeDni(undefined)).toBeNull();
  });

  it('DNI desde el CUIL de una persona física', () => {
    expect(dniFromCuit('20-12345678-6')).toBe('12345678');
    expect(dniFromCuit('27-01234567-1')).toBe('1234567');
    expect(dniFromCuit('30-12345678-1')).toBeNull();
    expect(dniFromCuit('abc')).toBeNull();
  });

  it('CBU: 22 dígitos', () => {
    expect(normalizeCbu('0170 0000 4000 0000 1234 56')).toBe('0170000040000000123456');
    expect(normalizeCbu('1234')).toBeNull();
  });

  it('correo: minúsculas y sin espacios, o nada si no es un correo', () => {
    expect(normalizeEmail('  Ana@Ejemplo.COM ')).toBe('ana@ejemplo.com');
    expect(normalizeEmail('sin-arroba')).toBeNull();
    expect(normalizeEmail('')).toBeNull();
  });

  it.each([
    ['+54 9 11 1234-5678', '1112345678'],
    ['011 15 1234 5678', '1112345678'],
    ['(011) 1234-5678', '1112345678'],
    ['11 1234 5678', '1112345678'],
    ['9 11 1234 5678', '1112345678'],
    ['+54 11 1234 5678', '1112345678'],
    ['0054 9 351 123 4567', '3511234567'],
    ['0351 15 123 4567', '3511234567'],
    ['0221 15 123 4567', '2211234567'],
    ['2966 15 12 3456', '2966123456'],
  ])('teléfono %s -> %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it('teléfono: descarta lo muy corto', () => {
    expect(normalizePhone('123456')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('nombre: sin tildes, mayúsculas, signos ni orden', () => {
    expect(normalizeName('Juan', 'Pérez')).toBe(normalizeName('PEREZ,', ' juan '));
    expect(normalizeName('María  José', "O'Brien")).toBe('brien jose maria o');
    expect(normalizeName('Solo', '')).toBeNull();
    expect(normalizeName(null, null)).toBeNull();
  });
});
