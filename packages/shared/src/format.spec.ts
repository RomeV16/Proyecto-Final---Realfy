import { formatMoneyAR, formatPeriodAR, formatPeriodShortAR, personName, propertyLabel } from './format';

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
