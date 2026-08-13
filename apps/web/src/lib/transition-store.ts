'use client';

import { useSyncExternalStore } from 'react';

interface TransitionData {
  firstName?: string;
  lastName?: string;
}

interface State {
  active: boolean;
  data: TransitionData;
  /** Monotonic id so a fresh start re-keys the overlay even across remounts. */
  runId: number;
}

let state: State = { active: false, data: {}, runId: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const transition = {
  start(data: TransitionData) {
    state = { active: true, data, runId: state.runId + 1 };
    emit();
  },
  end() {
    state = { active: false, data: state.data, runId: state.runId };
    emit();
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTransitionState(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
