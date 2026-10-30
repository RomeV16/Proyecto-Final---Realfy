import { describe, expect, it } from 'vitest';
import { avatarPalette, coverPalette, initialsOf } from './entity-visuals';

describe('initialsOf', () => {
  it('toma primera y última palabra en nombres compuestos', () => {
    expect(initialsOf('Ana María Pérez')).toBe('AP');
  });

  it('usa las dos primeras letras de un nombre de una palabra', () => {
    expect(initialsOf('Edenor')).toBe('ED');
  });

  it('ignora espacios sobrantes', () => {
    expect(initialsOf('  luz   sur  ')).toBe('LS');
  });

  it('devuelve ? sin nombre', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('   ')).toBe('?');
    expect(initialsOf(null)).toBe('?');
    expect(initialsOf(undefined)).toBe('?');
  });
});

describe('coverPalette', () => {
  it('es determinística para la misma semilla', () => {
    expect(coverPalette('contrato-1')).toEqual(coverPalette('contrato-1'));
  });

  it('produce degradado, textura conocida y tintes hsl', () => {
    const p = coverPalette('contrato-1');
    expect(p.gradient).toMatch(/^linear-gradient\(\d+deg, hsl\(/);
    expect(['cover-grid', 'cover-dots', 'cover-rays', 'cover-arcs']).toContain(p.texture);
    expect(p.tint).toMatch(/^hsl\(/);
    expect(p.soft).toMatch(/\/ 0\.12\)$/);
  });

  it('semillas distintas dan alguna diferencia en un conjunto', () => {
    const gradients = new Set(Array.from({ length: 20 }, (_, i) => coverPalette(`id-${i}`).gradient));
    expect(gradients.size).toBeGreaterThan(1);
  });

  it('una semilla vacía cae a la semilla por defecto', () => {
    expect(coverPalette('')).toEqual(coverPalette('realfy'));
  });
});

describe('avatarPalette', () => {
  it('es determinística y usa degradado de 135 grados', () => {
    const p = avatarPalette('usuario-7');
    expect(p).toEqual(avatarPalette('usuario-7'));
    expect(p.gradient).toMatch(/^linear-gradient\(135deg, /);
  });

  it('comparte la rampa con la portada de la misma semilla', () => {
    expect(avatarPalette('x').tint).toBe(coverPalette('x').tint);
  });
});
