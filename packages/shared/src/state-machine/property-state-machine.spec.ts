import { PropertyOperationType as Op, PropertyState as S } from '../enums';
import {
  PROPERTY_TRANSITIONS,
  getValidTransitions,
  validateTransition,
} from './property-state-machine';

/** Grafo por tipo de operación, escrito a mano. Los estados que no figuran no existen para ese tipo. */
const permitidas: Record<Op, Array<[S, S[]]>> = {
  [Op.Venta]: [
    [S.Borrador, [S.Disponible, S.Archivado]],
    [S.Disponible, [S.Reservado, S.Suspendido, S.Archivado]],
    [S.Reservado, [S.Disponible, S.Vendido, S.Archivado]],
    [S.Vendido, []],
    [S.Suspendido, [S.Disponible, S.Archivado]],
    [S.Archivado, []],
  ],
  [Op.Alquiler]: [
    [S.Borrador, [S.Disponible, S.Archivado]],
    [S.Disponible, [S.Reservado, S.Suspendido, S.Archivado]],
    [S.Reservado, [S.Disponible, S.Alquilado, S.Archivado]],
    [S.Alquilado, [S.Disponible, S.Archivado]],
    [S.Suspendido, [S.Disponible, S.Archivado]],
    [S.Archivado, []],
  ],
  [Op.Temporario]: [
    [S.Borrador, [S.Disponible, S.Archivado]],
    [S.Disponible, [S.Ocupado, S.Suspendido, S.Archivado]],
    [S.Ocupado, [S.Disponible, S.Archivado]],
    [S.Suspendido, [S.Disponible, S.Archivado]],
    [S.Archivado, []],
  ],
};
const todosEstados = Object.values(S);

describe('máquina de estados de propiedad', () => {
  it('tiene un grafo por cada tipo de operación', () => {
    expect([...PROPERTY_TRANSITIONS.keys()].sort()).toEqual(Object.values(Op).sort());
  });

  describe.each(Object.values(Op))('operación %s', (op) => {
    const filas = permitidas[op];

    it.each(filas)('desde %s permite exactamente sus destinos', (from, destinos) => {
      for (const to of todosEstados) {
        expect(validateTransition(op, from, to)).toBe(destinos.includes(to));
      }
      expect(getValidTransitions(op, from)).toEqual(destinos);
    });

    it('los estados fuera del grafo no tienen salidas ni son destino válido', () => {
      const enGrafo = filas.map(([f]) => f);
      for (const ajeno of todosEstados.filter((s) => !enGrafo.includes(s))) {
        expect(getValidTransitions(op, ajeno)).toEqual([]);
        for (const to of todosEstados) {
          expect(validateTransition(op, ajeno, to)).toBe(false);
        }
      }
    });

    it('Archivado es terminal', () => {
      expect(getValidTransitions(op, S.Archivado)).toEqual([]);
    });

    it('ningún estado puede pasar a sí mismo', () => {
      for (const s of todosEstados) {
        expect(validateTransition(op, s, s)).toBe(false);
      }
    });
  });

  describe('diferencias entre tipos de operación', () => {
    it('Vendido es terminal en Venta', () => {
      expect(getValidTransitions(Op.Venta, S.Vendido)).toEqual([]);
    });

    it('Alquiler y Temporario vuelven a Disponible tras la ocupación', () => {
      expect(validateTransition(Op.Alquiler, S.Alquilado, S.Disponible)).toBe(true);
      expect(validateTransition(Op.Temporario, S.Ocupado, S.Disponible)).toBe(true);
    });

    it('un estado propio de otra operación no es alcanzable', () => {
      expect(validateTransition(Op.Venta, S.Reservado, S.Alquilado)).toBe(false);
      expect(validateTransition(Op.Alquiler, S.Reservado, S.Vendido)).toBe(false);
      expect(validateTransition(Op.Temporario, S.Disponible, S.Reservado)).toBe(false);
      expect(validateTransition(Op.Venta, S.Disponible, S.Ocupado)).toBe(false);
    });

    it('Borrador no puede saltar a Reservado', () => {
      for (const op of Object.values(Op)) {
        expect(validateTransition(op, S.Borrador, S.Reservado)).toBe(false);
      }
    });
  });

  describe('entradas inválidas', () => {
    it('un tipo de operación desconocido no permite nada', () => {
      const raro = 'Permuta' as Op;
      expect(validateTransition(raro, S.Borrador, S.Disponible)).toBe(false);
      expect(getValidTransitions(raro, S.Borrador)).toEqual([]);
    });
  });
});
