// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText, safeHref, toDateInput } from './listings';

describe('helpers de publicación', () => {
  afterEach(() => vi.restoreAllMocks());

  it('safeHref sólo deja pasar http(s)', () => {
    expect(safeHref('https://zonaprop.test/aviso-1')).toBe('https://zonaprop.test/aviso-1');
    expect(safeHref('http://x.test')).toBe('http://x.test');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('https://x.test/a b')).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref('')).toBeNull();
  });

  it('toDateInput recorta a la fecha', () => {
    expect(toDateInput('2026-11-30T23:59:59.000Z')).toBe('2026-11-30');
    expect(toDateInput(null)).toBe('');
    expect(toDateInput(undefined)).toBe('');
  });

  it('copyText devuelve si pudo copiar', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await expect(copyText('hola')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hola');

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
      configurable: true,
    });
    await expect(copyText('hola')).resolves.toBe(false);
  });
});
