import { describe, expect, it } from 'vitest';
import {
  caseHref,
  canDerive,
  canJudicialize,
  contractCasesPath,
  isLetterPending,
  isOpen,
  isReminder,
  letterPdfPath,
  overdueTone,
  totalPayoff,
} from './collections';

describe('ayudas de cobranza', () => {
  it('arma los enlaces y las rutas de la API', () => {
    expect(caseHref('c-1')).toBe('/cobranza/c-1');
    expect(contractCasesPath('k-1')).toBe('/collection-cases?contractId=k-1&limit=5');
    expect(letterPdfPath('c-1', 'a-1')).toBe('/collection-cases/c-1/actions/a-1/letter.pdf');
  });

  it('solo se deriva desde recordatorio o prejudicial y solo se pasa a judicial desde el abogado', () => {
    expect(canDerive('Recordatorio')).toBe(true);
    expect(canDerive('Prejudicial')).toBe(true);
    expect(canDerive('Abogado')).toBe(false);
    expect(canDerive('Cerrado')).toBe(false);
    expect(canJudicialize('Abogado')).toBe(true);
    expect(canJudicialize('Prejudicial')).toBe(false);
    expect(isOpen('Judicial')).toBe(true);
    expect(isOpen('Cerrado')).toBe(false);
  });

  it('reconoce la carta pendiente de confirmar y los avisos', () => {
    expect(isLetterPending({ kind: 'CartaDocumento', status: 'Preparada' })).toBe(true);
    expect(isLetterPending({ kind: 'CartaDocumento', status: 'Realizada' })).toBe(false);
    expect(isLetterPending({ kind: 'Nota', status: 'Preparada' })).toBe(false);
    expect(isReminder('Recordatorio')).toBe(true);
    expect(isReminder('RecordatorioFirme')).toBe(true);
    expect(isReminder('Nota')).toBe(false);
  });

  it('el tono de la mora sube con los días', () => {
    expect(overdueTone(0)).toBe('neutral');
    expect(overdueTone(5)).toBe('warning');
    expect(overdueTone(29)).toBe('warning');
    expect(overdueTone(30)).toBe('danger');
  });

  it('suma lo que se debe hoy por moneda', () => {
    const items = [
      { payoffToday: '100.50', currency: 'ARS' as const },
      { payoffToday: '200', currency: 'ARS' as const },
      { payoffToday: '50', currency: 'USD' as const },
    ];
    expect(totalPayoff(items, 'ARS')).toBeCloseTo(300.5);
    expect(totalPayoff(items, 'USD')).toBe(50);
    expect(totalPayoff([], 'ARS')).toBe(0);
  });
});
