import { ContractStatus } from '../enums';
import {
  getValidContractTransitions,
  validateContractTransition,
} from './contract-state-machine';

const { Borrador, Activo, Vencido, Rescindido, Renovado, Archivado } =
  ContractStatus;

describe('contract-state-machine', () => {
  describe('activación', () => {
    it('un borrador se puede activar', () => {
      expect(validateContractTransition(Borrador, Activo)).toBe(true);
    });

    it('un contrato cerrado no vuelve a estar activo', () => {
      for (const from of [Vencido, Rescindido, Renovado, Archivado]) {
        expect(validateContractTransition(from, Activo)).toBe(false);
      }
    });

    it('activar un contrato que ya está activo no es una transición', () => {
      expect(validateContractTransition(Activo, Activo)).toBe(false);
    });
  });

  describe('rescisión', () => {
    it('se rescinde un contrato activo, vencido o en borrador', () => {
      for (const from of [Borrador, Activo, Vencido]) {
        expect(validateContractTransition(from, Rescindido)).toBe(true);
      }
    });

    it('no se rescinde dos veces ni después de archivar', () => {
      expect(validateContractTransition(Rescindido, Rescindido)).toBe(false);
      expect(validateContractTransition(Archivado, Rescindido)).toBe(false);
    });
  });

  describe('cierre', () => {
    it('un contrato activo vence o se renueva', () => {
      expect(validateContractTransition(Activo, Vencido)).toBe(true);
      expect(validateContractTransition(Activo, Renovado)).toBe(true);
    });

    it('un borrador no vence ni se renueva sin haber estado activo', () => {
      expect(validateContractTransition(Borrador, Vencido)).toBe(false);
      expect(validateContractTransition(Borrador, Renovado)).toBe(false);
    });

    it('archivado es terminal', () => {
      expect(getValidContractTransitions(Archivado)).toEqual([]);
    });
  });

  it('devuelve los destinos válidos de un borrador', () => {
    expect(getValidContractTransitions(Borrador)).toEqual([
      Activo,
      Rescindido,
      Archivado,
    ]);
  });

  it('un estado desconocido no tiene transiciones', () => {
    expect(validateContractTransition('Otro' as ContractStatus, Activo)).toBe(false);
    expect(getValidContractTransitions('Otro' as ContractStatus)).toEqual([]);
  });
});
