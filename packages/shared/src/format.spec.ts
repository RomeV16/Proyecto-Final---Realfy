import { personName, propertyLabel } from './format';

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
