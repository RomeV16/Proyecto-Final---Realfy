import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('une clases y descarta valores falsos', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('acepta condicionales con objetos y arreglos', () => {
    expect(cn('a', { b: true, c: false }, ['d'])).toBe('a b d');
  });

  it('sin entradas devuelve texto vacío', () => {
    expect(cn()).toBe('');
  });
});
