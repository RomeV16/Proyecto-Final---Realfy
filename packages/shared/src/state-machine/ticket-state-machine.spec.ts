import { TicketStatus as S } from '../enums';
import {
  getValidTicketTransitions,
  validateTicketTransition,
} from './ticket-state-machine';

const permitidas: Array<[S, S[]]> = [
  [S.Abierto, [S.Asignado, S.Cancelado, S.ProveedorAsignado]],
  [S.Asignado, [S.EnProgreso, S.Abierto, S.Cancelado, S.ProveedorAsignado]],
  [S.EnProgreso, [S.Resuelto, S.Cancelado, S.ProveedorAsignado]],
  [S.Resuelto, [S.Cerrado, S.Reabierto]],
  [S.Cerrado, [S.Reabierto]],
  [S.Cancelado, []],
  [S.Reabierto, [S.Asignado, S.Cancelado, S.ProveedorAsignado]],
  [S.ProveedorAsignado, [S.ProveedorEnCamino, S.EnProgreso, S.Cancelado]],
  [S.ProveedorEnCamino, [S.TrabajoRealizado, S.ProveedorAsignado]],
  [S.TrabajoRealizado, [S.Resuelto, S.EnProgreso]],
];
const todos = Object.values(S);

describe('máquina de estados de ticket', () => {
  it('cubre exactamente los estados del enum', () => {
    expect(permitidas.map(([from]) => from).sort()).toEqual([...todos].sort());
  });

  describe.each(permitidas)('desde %s', (from, destinos) => {
    it('permite pasar a cada destino declarado', () => {
      for (const to of destinos) {
        expect(validateTicketTransition(from, to)).toBe(true);
      }
    });

    it('rechaza todos los demás destinos, incluido quedarse en el mismo estado', () => {
      for (const to of todos.filter((t) => !destinos.includes(t))) {
        expect(validateTicketTransition(from, to)).toBe(false);
      }
    });

    it('lista los destinos válidos en el orden declarado', () => {
      expect(getValidTicketTransitions(from)).toEqual(destinos);
    });
  });

  describe('casos representativos rechazados', () => {
    it.each([
      [S.Abierto, S.Resuelto],
      [S.Abierto, S.Cerrado],
      [S.Resuelto, S.EnProgreso],
      [S.Cerrado, S.Abierto],
      [S.ProveedorEnCamino, S.Resuelto],
      [S.TrabajoRealizado, S.Cerrado],
    ])('%s no puede pasar a %s', (from, to) => {
      expect(validateTicketTransition(from, to)).toBe(false);
    });
  });

  it('Cancelado es el único estado terminal y no tiene salidas', () => {
    const sinSalidas = todos.filter((s) => getValidTicketTransitions(s).length === 0);
    expect(sinSalidas).toEqual([S.Cancelado]);
    for (const to of todos) {
      expect(validateTicketTransition(S.Cancelado, to)).toBe(false);
    }
  });

  it('Cerrado se puede reabrir (no es terminal)', () => {
    expect(validateTicketTransition(S.Cerrado, S.Reabierto)).toBe(true);
  });

  it('un estado de origen desconocido no tiene salidas', () => {
    const raro = 'Pendiente' as S;
    expect(validateTicketTransition(raro, S.Abierto)).toBe(false);
    expect(getValidTicketTransitions(raro)).toEqual([]);
  });
});
