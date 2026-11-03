import { describe, expect, it } from 'vitest';
import { INHERIT, comprobanteNumber, isEmptyOverride, jobPersonName, overrideBody } from './lessor-invoicing';

describe('lessor-invoicing', () => {
  it('numera el comprobante con punto de venta y número rellenos', () => {
    expect(comprobanteNumber({ puntoDeVenta: 3, numero: 12 })).toBe('0003-00000012');
  });

  it('nombra al locador de un trabajo, o devuelve su id si no vino la persona', () => {
    expect(jobPersonName({ personId: 'p', person: { id: 'p', firstName: 'Ana', lastName: 'Locadora' } })).toBe('Ana Locadora');
    expect(jobPersonName({ personId: 'p-9' })).toBe('p-9');
  });

  it('una configuración propia está vacía si no define ningún campo', () => {
    expect(isEmptyOverride(null)).toBe(true);
    expect(isEmptyOverride({})).toBe(true);
    expect(isEmptyOverride({ scope: null, when: null, vatPct: null })).toBe(true);
    expect(isEmptyOverride({ vatPct: 0 })).toBe(false);
  });

  it('el cuerpo del formulario manda null en lo que hereda y la alícuota como número', () => {
    expect(overrideBody({ scope: INHERIT, when: INHERIT, vatPct: INHERIT })).toEqual({ scope: null, when: null, vatPct: null });
    expect(overrideBody({ scope: 'TodoLocador', when: 'AlPagar', vatPct: '10.5' })).toEqual({
      scope: 'TodoLocador',
      when: 'AlPagar',
      vatPct: 10.5,
    });
  });
});
