import { RECONCILIATION_CYCLE, RECONCILIATION_EXPECTED } from './characterization.fixture';
import { compareReconciliation, formatDifferences } from './format';
import { runCycle } from './cycle';

/**
 * Caracterización del ciclo mensual (CP-663): los motores, encadenados como en la
 * API, reproducen al centavo el resultado calculado a mano para una cartera
 * sintética con la forma de la real. La misma entrada y el mismo esperado los
 * usa la prueba de punta a punta de la API (`reconciliacion.e2e-spec.ts`).
 */
describe('reconciliación — ciclo sintético de julio de 2026', () => {
  const actual = runCycle(RECONCILIATION_CYCLE);

  it('CP-663 — sin diferencias contra lo calculado a mano, contrato por contrato y locador por locador', () => {
    const differences = compareReconciliation(RECONCILIATION_EXPECTED, actual);
    expect(formatDifferences(differences)).toBe('');
  });

  it('CP-663 — cubre los once contratos y los nueve estados (uno en dólares)', () => {
    expect(Object.keys(actual.contracts)).toHaveLength(11);
    expect(Object.keys(actual.statements).sort((a, b) => a.localeCompare(b))).toEqual([
      'L1 ARS',
      'L2 ARS',
      'L3 ARS',
      'L4 USD',
      'L5 ARS',
      'L6 ARS',
      'L7 ARS',
      'L8 ARS',
      'L9 ARS',
    ]);
  });

  it('CP-664 — una diferencia de un centavo en un recibo o en un estado se informa', () => {
    const tampered: typeof actual = JSON.parse(JSON.stringify(actual));
    tampered.contracts.C04.comision = '34580.01';
    tampered.statements['L1 ARS'].cierre = '573183.72';
    expect(compareReconciliation(RECONCILIATION_EXPECTED, tampered)).toEqual([
      { scope: 'contrato', key: 'C04', concept: 'comision', expected: '34580.00', actual: '34580.01' },
      { scope: 'estado', key: 'L1 ARS', concept: 'cierre', expected: '573183.73', actual: '573183.72' },
    ]);
  });
});
