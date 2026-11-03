import { describe, expect, it } from 'vitest';
import { parseRecipient } from './recipient';

describe('CP-1410: parseRecipient, qué circuito y qué inmobiliaria', () => {
  it.each([
    ['boletas@realfy.app', { kind: 'bills', slug: null }],
    ['boletas+demo@realfy.app', { kind: 'bills', slug: 'demo' }],
    ['Boletas+Inmobiliaria-Demo@Realfy.App', { kind: 'bills', slug: 'inmobiliaria-demo' }],
    ['consultas@realfy.app', { kind: 'inbox', slug: null }],
    ['consultas+demo@realfy.app', { kind: 'inbox', slug: 'demo' }],
    [' consultas+demo@realfy.app ', { kind: 'inbox', slug: 'demo' }],
  ])('%s', (address, expected) => {
    expect(parseRecipient(address)).toEqual(expected);
  });

  it.each(['info@realfy.app', 'boletas2@realfy.app', 'boletas+@realfy.app', 'boletas+a_b@realfy.app', 'boletas+a+b@realfy.app', '@realfy.app', 'boletas', ''])(
    'rechaza %j',
    (address) => {
      expect(parseRecipient(address)).toBeNull();
    },
  );
});
