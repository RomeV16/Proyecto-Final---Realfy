import { RendicionStatus as S } from '../enums';
import {
  getValidRendicionTransitions,
  validateRendicionTransition,
} from './rendicion-state-machine';

const permitidas: Array<[S, S[]]> = [
  [S.Borrador, [S.Aprobada]],
  [S.Aprobada, [S.Enviada, S.Borrador]],
  [S.Enviada, [S.Depositada]],
  [S.Depositada, []],
];
const todos = Object.values(S);

describe('máquina de estados de rendición', () => {
  it('cubre exactamente los estados del enum', () => {
    expect(permitidas.map(([from]) => from).sort()).toEqual([...todos].sort());
  });

  describe.each(permitidas)('desde %s', (from, destinos) => {
    it('permite pasar a cada destino declarado', () => {
      for (const to of destinos) {
        expect(validateRendicionTransition(from, to)).toBe(true);
      }
    });

    it('rechaza todos los demás destinos, incluido quedarse en el mismo estado', () => {
      for (const to of todos.filter((t) => !destinos.includes(t))) {
        expect(validateRendicionTransition(from, to)).toBe(false);
      }
    });

    it('lista los destinos válidos en el orden declarado', () => {
      expect(getValidRendicionTransitions(from)).toEqual(destinos);
    });
  });

  describe('casos representativos rechazados', () => {
    it.each([
      [S.Borrador, S.Enviada],
      [S.Borrador, S.Depositada],
      [S.Aprobada, S.Depositada],
      [S.Enviada, S.Aprobada],
      [S.Enviada, S.Borrador],
    ])('%s no puede pasar a %s', (from, to) => {
      expect(validateRendicionTransition(from, to)).toBe(false);
    });
  });

  it('Depositada es terminal', () => {
    expect(getValidRendicionTransitions(S.Depositada)).toEqual([]);
    for (const to of todos) {
      expect(validateRendicionTransition(S.Depositada, to)).toBe(false);
    }
  });

  it('un estado de origen desconocido no tiene salidas', () => {
    const raro = 'Anulada' as S;
    expect(validateRendicionTransition(raro, S.Borrador)).toBe(false);
    expect(getValidRendicionTransitions(raro)).toEqual([]);
  });
});
