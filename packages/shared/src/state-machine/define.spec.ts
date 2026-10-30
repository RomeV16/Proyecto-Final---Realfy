import { InvalidTransitionError, defineStateMachine } from './define';

type S = 'A' | 'B' | 'C';

const machine = defineStateMachine<S>([
  ['A', ['B', 'C']],
  ['B', ['A']],
  ['C', []],
]);

describe('defineStateMachine', () => {
  it('canTransition refleja el grafo', () => {
    expect(machine.canTransition('A', 'B')).toBe(true);
    expect(machine.canTransition('B', 'C')).toBe(false);
    expect(machine.canTransition('C', 'A')).toBe(false);
  });

  it('allowedFrom devuelve los destinos y [] para terminales o desconocidos', () => {
    expect(machine.allowedFrom('A')).toEqual(['B', 'C']);
    expect(machine.allowedFrom('C')).toEqual([]);
    expect(machine.allowedFrom('Z' as S)).toEqual([]);
  });

  it('assertTransition no lanza si es válida', () => {
    expect(() => machine.assertTransition('A', 'B')).not.toThrow();
  });

  it('assertTransition lanza con los destinos válidos', () => {
    try {
      machine.assertTransition('B', 'C');
      throw new Error('debía lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      expect((err as InvalidTransitionError).validTransitions).toEqual(['A']);
      expect((err as Error).message).toBe('Cannot transition from B to C');
    }
  });
});
