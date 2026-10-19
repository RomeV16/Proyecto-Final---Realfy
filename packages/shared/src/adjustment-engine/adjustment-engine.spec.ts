import Decimal from 'decimal.js';
import { AdjustmentType } from '../enums';
import {
  calculateAdjustment,
  calculateCCP,
  calculateICL,
  calculateIPC,
} from './index';

/**
 * Tabla de decisión de CU-08 (docs/calidad/05-casos-de-prueba.md, reglas D1 a D11).
 * Cada valor esperado se calculó a mano antes de escribir la prueba:
 * el motor no puede ser su propio oráculo.
 */
const base = new Decimal('100000.00');
const d = (v: string | number) => new Decimal(v);

describe('adjustment-engine — tabla de decisión de CU-08', () => {
  describe('IPC: variaciones mensuales encadenadas por producto', () => {
    it('D1: 2 % y 3 % encadenados dan 5,06 %, no 5 %', () => {
      const result = calculateAdjustment({
        type: AdjustmentType.IPC,
        monthlyValues: [d('2.0'), d('3.0')],
        baseRent: base,
      });

      expect(result.newRent.toFixed(2)).toBe('105060.00');
      expect(result.percentage.toFixed(2)).toBe('5.06');
    });

    it('D2: sin valores el alquiler no cambia', () => {
      const result = calculateIPC([], base);

      expect(result.newRent.toFixed(2)).toBe('100000.00');
      expect(result.percentage.toFixed(2)).toBe('0.00');
    });

    it('límite: un solo valor equivale a aplicar ese porcentaje', () => {
      const result = calculateIPC([d('4.5')], base);

      expect(result.newRent.toFixed(2)).toBe('104500.00');
    });

    it('acepta variación negativa (deflación)', () => {
      const result = calculateIPC([d('-1.0')], base);

      expect(result.newRent.toFixed(2)).toBe('99000.00');
    });

    it('redondea el alquiler a dos decimales con ROUND_HALF_UP', () => {
      // 100000 × 1.000005 = 100000.5 → 100000.50; 100000 × 1.0000049 → 100000.49
      expect(calculateIPC([d('0.0005')], base).newRent.toFixed(2)).toBe('100000.50');
      expect(calculateIPC([d('0.00049')], base).newRent.toFixed(2)).toBe('100000.49');
    });
  });

  describe('ICL: niveles, cociente final sobre inicial', () => {
    it('D3: 100 → 120 es un 20 %', () => {
      const result = calculateAdjustment({
        type: AdjustmentType.ICL,
        startValue: d(100),
        endValue: d(120),
        baseRent: base,
      });

      expect(result.newRent.toFixed(2)).toBe('120000.00');
      expect(result.percentage.toFixed(2)).toBe('20.00');
    });

    it('D5: inicio igual a fin da factor 1', () => {
      const result = calculateICL(d('31.49'), d('31.49'), base);

      expect(result.newRent.toFixed(2)).toBe('100000.00');
    });

    it('límite: valor inicial cero se rechaza en lugar de dividir', () => {
      expect(() => calculateICL(d(0), d(120), base)).toThrow('ICL start value cannot be zero');
    });

    it('usa los niveles tal como se publican, sin tratarlos como porcentaje', () => {
      // Nivel 31.47 → 31.49: un 0,0635 %. Tratarlos como % daría un disparate.
      const result = calculateICL(d('31.47'), d('31.49'), base);

      expect(result.percentage.toFixed(4)).toBe('0.0636');
      expect(result.newRent.toFixed(2)).toBe('100063.55');
    });
  });

  describe('CCP: mínimo entre 0,9 × CVS y CER, encadenado', () => {
    it('D6: CVS 2,0 y CER 1,5 → aplica 1,5 % (0,9 × 2,0 = 1,8 > 1,5)', () => {
      const result = calculateAdjustment({
        type: AdjustmentType.CCP,
        cvsPcts: [d('2.0')],
        cerPcts: [d('1.5')],
        baseRent: base,
      });

      expect(result.newRent.toFixed(2)).toBe('101500.00');
    });

    it('D7: CVS 1,0 y CER 1,5 → aplica 0,9 % (0,9 × 1,0 = 0,9 < 1,5)', () => {
      const result = calculateCCP([d('1.0')], [d('1.5')], base);

      expect(result.newRent.toFixed(2)).toBe('100900.00');
    });

    it('encadena varios meses por producto', () => {
      // mes 1: min(0.9·2.0, 1.5) = 1.5 %; mes 2: min(0.9·1.0, 1.5) = 0.9 %
      // 100000 × 1.015 × 1.009 = 102413.50
      const result = calculateCCP([d('2.0'), d('1.0')], [d('1.5'), d('1.5')], base);

      expect(result.newRent.toFixed(2)).toBe('102413.50');
    });

    it('sin valores no ajusta', () => {
      expect(calculateCCP([], [], base).newRent.toFixed(2)).toBe('100000.00');
    });

    it('series de distinta longitud se rechazan', () => {
      expect(() => calculateCCP([d(1)], [], base)).toThrow('same length');
    });
  });

  describe('Porcentaje fijo y personalizado', () => {
    it('D8: fijo 10 % sobre 100.000 da 110.000', () => {
      const result = calculateAdjustment({
        type: AdjustmentType.FixedPercent,
        percentage: d('10.00'),
        baseRent: base,
      });

      expect(result.newRent.toFixed(2)).toBe('110000.00');
      expect(result.percentage.toFixed(2)).toBe('10.00');
    });

    it('D9: porcentaje 0 no cambia el alquiler', () => {
      const result = calculateAdjustment({
        type: AdjustmentType.FixedPercent,
        percentage: d(0),
        baseRent: base,
      });

      expect(result.newRent.toFixed(2)).toBe('100000.00');
    });

    it('D10: personalizado 7,5 % da 107.500', () => {
      const result = calculateAdjustment({
        type: AdjustmentType.Custom,
        percentage: d('7.5'),
        baseRent: base,
      });

      expect(result.newRent.toFixed(2)).toBe('107500.00');
    });
  });

  it('un tipo desconocido se rechaza con error explícito', () => {
    expect(() =>
      calculateAdjustment({ type: 'Inventado', baseRent: base } as any),
    ).toThrow('Unknown adjustment type: Inventado');
  });
});
