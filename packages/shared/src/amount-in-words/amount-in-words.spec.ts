import { amountInWords } from './index';

describe('amountInWords (es-AR)', () => {
  const golden: [string | number, string][] = [
    [0, 'Cero pesos'],
    [1, 'Un peso'],
    [2, 'Dos pesos'],
    [15, 'Quince pesos'],
    [21, 'Veintiún pesos'],
    [31, 'Treinta y un pesos'],
    [100, 'Cien pesos'],
    [101, 'Ciento un pesos'],
    [999, 'Novecientos noventa y nueve pesos'],
    [1000, 'Mil pesos'],
    [1001, 'Mil un pesos'],
    [2000, 'Dos mil pesos'],
    [21000, 'Veintiún mil pesos'],
    [101000, 'Ciento un mil pesos'],
    [1234.5, 'Mil doscientos treinta y cuatro pesos con cincuenta centavos'],
    [150000, 'Ciento cincuenta mil pesos'],
    [345678.9, 'Trescientos cuarenta y cinco mil seiscientos setenta y ocho pesos con noventa centavos'],
    [1000000, 'Un millón de pesos'],
    [2000000, 'Dos millones de pesos'],
    [1000001, 'Un millón un pesos'],
    [21500000, 'Veintiún millones quinientos mil pesos'],
    [1500000.01, 'Un millón quinientos mil pesos con un centavo'],
    [1000000000, 'Mil millones de pesos'],
    ['0.01', 'Un centavo'],
    ['0.50', 'Cincuenta centavos'],
    ['99.99', 'Noventa y nueve pesos con noventa y nueve centavos'],
  ];

  it.each(golden)('%s -> %s', (amount, words) => {
    expect(amountInWords(amount)).toBe(words);
  });

  it('redondea a centavos, mitad hacia arriba', () => {
    expect(amountInWords('10.005')).toBe('Diez pesos con un centavo');
    expect(amountInWords('10.004')).toBe('Diez pesos');
  });

  it('dólares', () => {
    expect(amountInWords(1, 'USD')).toBe('Un dólar estadounidense');
    expect(amountInWords('1500.25', 'USD')).toBe(
      'Mil quinientos dólares estadounidenses con veinticinco centavos',
    );
  });

  it('rechaza negativos, monedas sin texto y montos fuera de rango', () => {
    expect(() => amountInWords(-1)).toThrow('negativos');
    expect(() => amountInWords(1, 'BRL')).toThrow('Moneda');
    expect(() => amountInWords('1000000000000')).toThrow('rango');
  });
});
