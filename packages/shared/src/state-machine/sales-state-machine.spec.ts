import { SalesOperationStatus as S } from '../enums';
import { OPEN_SALES_STATUSES, salesMachine } from './sales-state-machine';

/** Tabla escrita a mano: cualquier par que no figure acá debe ser rechazado. */
const permitidas: Array<[S, S[]]> = [
  [S.Captacion, [S.Publicada, S.Cancelada]],
  [S.Publicada, [S.Captacion, S.Reservada, S.Cancelada]],
  [S.Reservada, [S.SenaRecibida, S.Publicada, S.Cancelada]],
  [S.SenaRecibida, [S.Boleto, S.Publicada, S.Cancelada]],
  [S.Boleto, [S.Escriturada, S.Cancelada]],
  [S.Escriturada, []],
  [S.Cancelada, []],
];
const todos = Object.values(S);

describe('máquina de estados de venta', () => {
  it('cubre exactamente los estados del enum', () => {
    expect(permitidas.map(([from]) => from).sort()).toEqual([...todos].sort());
  });

  describe.each(permitidas)('desde %s', (from, destinos) => {
    it.each(todos)('hacia %s', (to) => {
      const ok = destinos.includes(to);
      expect(salesMachine.canTransition(from, to)).toBe(ok);
      if (ok) expect(() => salesMachine.assertTransition(from, to)).not.toThrow();
      else expect(() => salesMachine.assertTransition(from, to)).toThrow();
    });
  });

  it('las operaciones abiertas son las que no son finales', () => {
    expect([...OPEN_SALES_STATUSES].sort()).toEqual(
      permitidas
        .filter(([, to]) => to.length > 0)
        .map(([from]) => from)
        .sort(),
    );
  });
});
