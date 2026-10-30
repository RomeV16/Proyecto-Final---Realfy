import { BadRequestException } from '@nestjs/common';
import { defineStateMachine } from '@realfy/shared';
import { assertTransition } from './assert-transition';

const machine = defineStateMachine<string>([
  ['A', ['B']],
  ['B', []],
]);

describe('assertTransition', () => {
  it('no lanza si la transición está permitida', () => {
    expect(() => assertTransition(machine, 'A', 'B')).not.toThrow();
  });

  it('lanza 400 INVALID_TRANSITION con los destinos válidos', () => {
    try {
      assertTransition(machine, 'B', 'A');
      throw new Error('debía lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual({
        error: 'INVALID_TRANSITION',
        message: 'Cannot transition from B to A',
        currentState: 'B',
        attemptedState: 'A',
        validTransitions: [],
      });
    }
  });

  it('sin máquina (tipo desconocido) rechaza con lista vacía', () => {
    expect(() => assertTransition(undefined, 'A', 'B')).toThrow(BadRequestException);
  });
});
