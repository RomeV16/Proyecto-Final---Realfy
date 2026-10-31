import { LiquidacionStatus as S } from '../enums';
import {
  OVERDUE_STATUSES,
  RECEIVABLE_STATUSES,
  getValidLiquidacionTransitions,
  validateLiquidacionTransition,
} from './liquidacion-state-machine';

/**
 * Tabla de transiciones permitidas, escrita a mano a partir del flujo
 * documentado. Cualquier par que no figure acá debe ser rechazado.
 */
const permitidas: Array<[S, S[]]> = [
  [S.Borrador, [S.Revision, S.Anulada]],
  [S.Revision, [S.Aprobada, S.Borrador, S.Anulada]],
  [S.Aprobada, [S.Enviada, S.Anulada]],
  [S.Pendiente, []],
  [S.Enviada, [S.Pagada, S.Vencida, S.Anulada]],
  [S.Pagada, []],
  [S.Vencida, [S.Pagada, S.Anulada]],
  [S.Anulada, []],
];
const todos = Object.values(S);

describe('máquina de estados de liquidación', () => {
  it('cubre exactamente los estados del enum', () => {
    expect(permitidas.map(([from]) => from).sort()).toEqual([...todos].sort());
  });

  describe.each(permitidas)('desde %s', (from, destinos) => {
    it('permite pasar a cada destino declarado', () => {
      for (const to of destinos) {
        expect(validateLiquidacionTransition(from, to)).toBe(true);
      }
    });

    it('rechaza todos los demás destinos, incluido quedarse en el mismo estado', () => {
      for (const to of todos.filter((t) => !destinos.includes(t))) {
        expect(validateLiquidacionTransition(from, to)).toBe(false);
      }
    });

    it('lista los destinos válidos en el orden declarado', () => {
      expect(getValidLiquidacionTransitions(from)).toEqual(destinos);
    });
  });

  describe('casos representativos rechazados', () => {
    it.each([
      [S.Borrador, S.Pagada],
      [S.Borrador, S.Enviada],
      [S.Revision, S.Enviada],
      [S.Aprobada, S.Borrador],
      [S.Aprobada, S.Pagada],
      [S.Enviada, S.Borrador],
      [S.Vencida, S.Enviada],
      [S.Vencida, S.Borrador],
    ])('%s no puede pasar a %s', (from, to) => {
      expect(validateLiquidacionTransition(from, to)).toBe(false);
    });
  });

  describe('Pendiente (estado heredado, sin flujo definido)', () => {
    it('ningún estado entra ni sale de Pendiente', () => {
      expect(getValidLiquidacionTransitions(S.Pendiente)).toEqual([]);
      for (const from of todos) {
        expect(validateLiquidacionTransition(from, S.Pendiente)).toBe(false);
      }
    });
  });

  describe('estados terminales', () => {
    it.each([S.Pagada, S.Anulada])('%s no tiene salidas', (terminal) => {
      expect(getValidLiquidacionTransitions(terminal)).toEqual([]);
      for (const to of todos) {
        expect(validateLiquidacionTransition(terminal, to)).toBe(false);
      }
    });
  });

  describe('entradas inválidas', () => {
    it('rechaza un estado de origen desconocido', () => {
      const raro = 'Inventado' as S;
      expect(validateLiquidacionTransition(raro, S.Borrador)).toBe(false);
      expect(getValidLiquidacionTransitions(raro)).toEqual([]);
    });
  });
});

describe('grupos de estados de deuda', () => {
  it('por cobrar: aprobadas, enviadas, pendientes y vencidas', () => {
    expect([...RECEIVABLE_STATUSES].sort()).toEqual([S.Aprobada, S.Enviada, S.Pendiente, S.Vencida].sort());
  });

  it('nunca incluye estados sin saldo ni sin emitir', () => {
    for (const s of [S.Borrador, S.Revision, S.Pagada, S.Anulada]) {
      expect(RECEIVABLE_STATUSES).not.toContain(s);
    }
  });

  it('los vencibles son un subconjunto de los por cobrar', () => {
    expect([...OVERDUE_STATUSES].sort()).toEqual([S.Enviada, S.Vencida].sort());
    for (const s of OVERDUE_STATUSES) expect(RECEIVABLE_STATUSES).toContain(s);
  });
});
