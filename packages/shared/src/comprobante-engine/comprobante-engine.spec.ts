import { FiscalCondition } from '../enums';
import {
  resolveComprobanteType,
  canIssueFiscalInvoice,
  getIvaTreatment,
  ComprobanteResolution,
  ComprobanteLetra,
} from './index';

describe('comprobante-engine', () => {
  const allReceptors = Object.values(FiscalCondition);

  // ─── resolveComprobanteType ─────────────────────────

  describe('resolveComprobanteType', () => {
    // RI → RI = A (cbteTipo 1, NC 3, ND 2)
    it('RI → RI = Factura A (cbteTipo 1)', () => {
      const result = resolveComprobanteType(
        FiscalCondition.ResponsableInscripto,
        FiscalCondition.ResponsableInscripto,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 1,
        letra: 'A',
        ncTipo: 3,
        ndTipo: 2,
      });
    });

    // RI → Monotributo = B (cbteTipo 6, NC 8, ND 7)
    it('RI → Monotributista = Factura B (cbteTipo 6)', () => {
      const result = resolveComprobanteType(
        FiscalCondition.ResponsableInscripto,
        FiscalCondition.Monotributista,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 6,
        letra: 'B',
        ncTipo: 8,
        ndTipo: 7,
      });
    });

    // RI → ConsumidorFinal = B
    it('RI → ConsumidorFinal = Factura B (cbteTipo 6)', () => {
      const result = resolveComprobanteType(
        FiscalCondition.ResponsableInscripto,
        FiscalCondition.ConsumidorFinal,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 6,
        letra: 'B',
        ncTipo: 8,
        ndTipo: 7,
      });
    });

    // RI → Exento = B
    it('RI → Exento = Factura B (cbteTipo 6)', () => {
      const result = resolveComprobanteType(
        FiscalCondition.ResponsableInscripto,
        FiscalCondition.Exento,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 6,
        letra: 'B',
        ncTipo: 8,
        ndTipo: 7,
      });
    });

    // RI → NoResponsable = B
    it('RI → NoResponsable = Factura B (cbteTipo 6)', () => {
      const result = resolveComprobanteType(
        FiscalCondition.ResponsableInscripto,
        FiscalCondition.NoResponsable,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 6,
        letra: 'B',
        ncTipo: 8,
        ndTipo: 7,
      });
    });

    // Monotributo → every receptor = C (cbteTipo 11, NC 13, ND 12)
    it.each(allReceptors)('Monotributista → %s = Factura C (cbteTipo 11)', (receptor) => {
      const result = resolveComprobanteType(
        FiscalCondition.Monotributista,
        receptor,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 11,
        letra: 'C',
        ncTipo: 13,
        ndTipo: 12,
      });
    });

    // Exento → every receptor = C (cbteTipo 11, NC 13, ND 12)
    it.each(allReceptors)('Exento → %s = Factura C (cbteTipo 11)', (receptor) => {
      const result = resolveComprobanteType(
        FiscalCondition.Exento,
        receptor,
      );
      expect(result).toEqual<ComprobanteResolution>({
        cbteTipo: 11,
        letra: 'C',
        ncTipo: 13,
        ndTipo: 12,
      });
    });

    // Invalid emisor conditions
    it('throws for ConsumidorFinal as emisor', () => {
      expect(() =>
        resolveComprobanteType(
          FiscalCondition.ConsumidorFinal,
          FiscalCondition.ResponsableInscripto,
        ),
      ).toThrow('cannot issue invoices');
    });

    it('throws for NoResponsable as emisor', () => {
      expect(() =>
        resolveComprobanteType(
          FiscalCondition.NoResponsable,
          FiscalCondition.ResponsableInscripto,
        ),
      ).toThrow('cannot issue invoices');
    });

    // Verify NC and ND codes are consistent with factura codes
    describe('NC/ND code consistency', () => {
      const validPairs: Array<[FiscalCondition, FiscalCondition, string]> = [
        [FiscalCondition.ResponsableInscripto, FiscalCondition.ResponsableInscripto, 'A'],
        [FiscalCondition.ResponsableInscripto, FiscalCondition.ConsumidorFinal, 'B'],
        [FiscalCondition.Monotributista, FiscalCondition.ConsumidorFinal, 'C'],
        [FiscalCondition.Exento, FiscalCondition.Exento, 'C'],
      ];

      it.each(validPairs)(
        'Factura %s → %s (letter %s) has correct NC/ND offsets',
        (emisor, receptor, expectedLetra) => {
          const result = resolveComprobanteType(emisor, receptor);
          expect(result.letra).toBe(expectedLetra);

          // ARCA codes: A=1/2/3, B=6/7/8, C=11/12/13
          // Pattern: factura, debito=factura+1, credito=factura+2
          expect(result.ndTipo).toBe(result.cbteTipo + 1);
          expect(result.ncTipo).toBe(result.cbteTipo + 2);
        },
      );
    });
  });

  // ─── canIssueFiscalInvoice ──────────────────────────

  describe('canIssueFiscalInvoice', () => {
    it('returns true for ResponsableInscripto', () => {
      expect(canIssueFiscalInvoice(FiscalCondition.ResponsableInscripto)).toBe(true);
    });

    it('returns true for Monotributista', () => {
      expect(canIssueFiscalInvoice(FiscalCondition.Monotributista)).toBe(true);
    });

    it('returns true for Exento', () => {
      expect(canIssueFiscalInvoice(FiscalCondition.Exento)).toBe(true);
    });

    it('returns false for ConsumidorFinal', () => {
      expect(canIssueFiscalInvoice(FiscalCondition.ConsumidorFinal)).toBe(false);
    });

    it('returns false for NoResponsable', () => {
      expect(canIssueFiscalInvoice(FiscalCondition.NoResponsable)).toBe(false);
    });
  });

  // ─── getIvaTreatment ───────────────────────────────

  describe('getIvaTreatment', () => {
    it('returns "discriminado" for letter A', () => {
      expect(getIvaTreatment('A')).toBe('discriminado');
    });

    it('returns "included" for letter B', () => {
      expect(getIvaTreatment('B')).toBe('included');
    });

    it('returns "none" for letter C', () => {
      expect(getIvaTreatment('C')).toBe('none');
    });
  });

  // ─── Full matrix exhaustiveness ─────────────────────

  describe('exhaustive matrix coverage', () => {
    const validEmisors = [
      FiscalCondition.ResponsableInscripto,
      FiscalCondition.Monotributista,
      FiscalCondition.Exento,
    ];

    it('covers all valid emisor × receptor combinations without error', () => {
      for (const emisor of validEmisors) {
        for (const receptor of allReceptors) {
          expect(() => resolveComprobanteType(emisor, receptor)).not.toThrow();
          const result = resolveComprobanteType(emisor, receptor);
          expect(result.cbteTipo).toBeGreaterThan(0);
          expect(result.ncTipo).toBeGreaterThan(0);
          expect(result.ndTipo).toBeGreaterThan(0);
          expect(['A', 'B', 'C']).toContain(result.letra);
        }
      }
    });
  });
});
