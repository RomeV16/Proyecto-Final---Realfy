/**
 * Definición única de una máquina de estados: un mapa de cada estado a los
 * estados a los que puede pasar. Un estado sin entrada, o con lista vacía, no
 * tiene salidas.
 */
export interface StateMachine<S extends string> {
  /** El grafo tal como se definió. */
  readonly transitions: ReadonlyMap<S, readonly S[]>;
  /** `true` si `from → to` está permitido. */
  canTransition(from: S, to: S): boolean;
  /** Estados a los que se puede pasar desde `from` ([] si es terminal o desconocido). */
  allowedFrom(from: S): S[];
  /** Lanza un error si `from → to` no está permitido. */
  assertTransition(from: S, to: S): void;
}

/** Error de una transición que la máquina no permite. */
export class InvalidTransitionError<S extends string = string> extends Error {
  constructor(
    readonly from: S,
    readonly to: S,
    readonly validTransitions: S[],
  ) {
    super(`Cannot transition from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function defineStateMachine<S extends string>(
  entries: ReadonlyMap<S, S[]> | Array<[S, S[]]>,
): StateMachine<S> {
  const transitions = new Map<S, S[]>(entries);
  const allowedFrom = (from: S): S[] => transitions.get(from) ?? [];
  const canTransition = (from: S, to: S): boolean => allowedFrom(from).includes(to);
  return {
    transitions,
    canTransition,
    allowedFrom,
    assertTransition(from, to) {
      if (!canTransition(from, to)) {
        throw new InvalidTransitionError(from, to, allowedFrom(from));
      }
    },
  };
}
