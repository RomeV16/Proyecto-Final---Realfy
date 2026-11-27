import { describe, expect, it } from 'vitest';
import {
  formatDocNumber,
  isCreditNote,
  isInvoice,
  signedTotal,
  voucherCode,
  voucherLetter,
  voucherNumber,
  voucherState,
} from './voucher';

describe('voucher', () => {
  it('distingue facturas de notas de crédito y saca la letra', () => {
    expect(isInvoice('FacturaC')).toBe(true);
    expect(isInvoice('NotaCreditoC')).toBe(false);
    expect(isCreditNote('NotaCreditoB')).toBe(true);
    expect(isCreditNote('NotaDebitoB')).toBe(false);
    expect(voucherLetter('FacturaC')).toBe('C');
    expect(voucherLetter('NotaCreditoA')).toBe('A');
  });

  it('arma el código de ARCA y el número con punto de venta', () => {
    expect(voucherCode(11)).toBe('011');
    expect(voucherCode(null)).toBeNull();
    expect(voucherNumber({ puntoDeVenta: 1, numero: 42 })).toBe('0001-00000042');
  });

  it('da formato de CUIT solo a documentos de once cifras', () => {
    expect(formatDocNumber('23319273964')).toBe('23-31927396-4');
    expect(formatDocNumber('20-32145678-3')).toBe('20-32145678-3');
    expect(formatDocNumber('31927396')).toBe('31927396');
    expect(formatDocNumber(null)).toBeNull();
  });

  it('el estado ante ARCA sale del CAE y de las notas de crédito', () => {
    expect(voucherState({ cae: null })).toBe('pending');
    expect(voucherState({ cae: '1', creditNotes: [] })).toBe('authorized');
    expect(voucherState({ cae: '1', creditNotes: [{ id: 'n', type: 'NotaCreditoC', puntoDeVenta: 1, numero: 1 }] })).toBe(
      'credited',
    );
  });

  it('una nota de crédito resta y un importe ilegible vale cero', () => {
    expect(signedTotal({ type: 'FacturaC', impTotal: '100.5' })).toBe(100.5);
    expect(signedTotal({ type: 'NotaCreditoC', impTotal: 30 })).toBe(-30);
    expect(signedTotal({ type: 'FacturaC', impTotal: 'x' })).toBe(0);
    expect(signedTotal({ type: 'FacturaC' })).toBe(0);
  });
});
