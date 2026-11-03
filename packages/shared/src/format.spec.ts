import { formatMoneyAR, formatPeriodAR, formatPeriodShortAR, personName, propertyLabel, formatReceiptNumber, formatDniAR } from './format';

describe('formatMoneyAR', () => {
  it('separa miles y deja dos decimales', () => {
    expect(formatMoneyAR(1234.5)).toBe('1.234,50');
    expect(formatMoneyAR('152500')).toBe('152.500,00');
    expect(formatMoneyAR({ toString: () => '0.1' })).toBe('0,10');
  });
});

describe('formatPeriodAR y formatPeriodShortAR', () => {
  it('leen el período en UTC', () => {
    const period = new Date('2025-03-01T00:00:00.000Z');
    expect(formatPeriodAR(period)).toBe('marzo de 2025');
    expect(formatPeriodShortAR(period)).toBe('03/2025');
    expect(formatPeriodShortAR('2025-12-01T00:00:00.000Z')).toBe('12/2025');
  });
});

describe('propertyLabel', () => {
  it('usa el título si existe', () => {
    expect(propertyLabel({ title: ' Depto Palermo ', street: 'Av. Santa Fe', number: '1234' })).toBe(
      'Depto Palermo',
    );
  });

  it('sin título arma calle, número y unidad', () => {
    expect(
      propertyLabel({ title: '', street: 'Av. Santa Fe', number: '1234', floor: '3', apartment: 'B' }),
    ).toBe('Av. Santa Fe 1234, piso 3 B');
  });

  it('omite lo que falta', () => {
    expect(propertyLabel({ street: 'Corrientes' })).toBe('Corrientes');
    expect(propertyLabel({ street: 'Corrientes', number: '10', apartment: 'A' })).toBe('Corrientes 10, A');
    expect(propertyLabel({ floor: '2' })).toBe('piso 2');
  });

  it('devuelve vacío sin datos', () => {
    expect(propertyLabel(null)).toBe('');
    expect(propertyLabel(undefined)).toBe('');
    expect(propertyLabel({ title: '  ', street: null })).toBe('');
  });
});

describe('personName', () => {
  it('une nombre y apellido', () => {
    expect(personName({ firstName: 'Ana', lastName: 'Pérez' })).toBe('Ana Pérez');
  });

  it('tolera campos vacíos', () => {
    expect(personName({ firstName: 'Ana', lastName: '' })).toBe('Ana');
    expect(personName({ firstName: null, lastName: null })).toBe('');
    expect(personName(null)).toBe('');
  });
});

describe('formatReceiptNumber', () => {
  it('completa con ceros a ocho dígitos', () => {
    expect(formatReceiptNumber(1)).toBe('00000001');
    expect(formatReceiptNumber(42)).toBe('00000042');
    expect(formatReceiptNumber(123456789)).toBe('123456789');
  });
});

describe('formatDniAR', () => {
  it('agrega los puntos de millares', () => {
    expect(formatDniAR('6678901')).toBe('6.678.901');
    expect(formatDniAR('30123456')).toBe('30.123.456');
    expect(formatDniAR(' 30123456 ')).toBe('30.123.456');
  });

  it('acepta el DNI ya con puntos y deja igual lo que no es un número de documento', () => {
    expect(formatDniAR('30.123.456')).toBe('30.123.456');
    expect(formatDniAR('AB123456')).toBe('AB123456');
    expect(formatDniAR('12')).toBe('12');
    expect(formatDniAR('')).toBe('');
    expect(formatDniAR(null)).toBe('');
  });
});
