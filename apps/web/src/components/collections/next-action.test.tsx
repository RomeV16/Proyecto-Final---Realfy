// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';
import { SuggestedStep, suggestedStep } from './next-action';
import { StageSteps } from './stage-steps';

type Item = Parameters<typeof suggestedStep>[0];

const item = (o: Partial<Item> = {}): Item =>
  ({ stage: 'Recordatorio', planStatus: 'Scheduled', nextAction: null, nextActionAt: null, pausedUntil: null, ...o }) as Item;

describe('suggestedStep', () => {
  it.each([
    [item({ planStatus: 'Paused', pausedUntil: '2026-03-30T00:00:00.000Z' } as Partial<Item>), 'wait'],
    [item({ planStatus: 'AwaitingLetterConfirmation' } as Partial<Item>), 'confirmLetter'],
    [item({ planStatus: 'Manual', stage: 'Abogado' } as Partial<Item>), 'lawyer'],
    [item({ planStatus: 'Manual', stage: 'Judicial' } as Partial<Item>), 'court'],
    [item({ planStatus: 'Manual' } as Partial<Item>), 'person'],
    [item({ nextAction: 'Recordatorio' } as Partial<Item>), 'remind'],
    [item({ nextAction: 'RecordatorioFirme' } as Partial<Item>), 'remindFirm'],
    [item({ nextAction: 'CartaDocumento' } as Partial<Item>), 'letter'],
    [item({ nextAction: 'DerivacionAbogado' } as Partial<Item>), 'derive'],
    [item({ nextAction: 'Nota' } as Partial<Item>), 'call'],
    [item(), 'call'],
  ])('caso %# → %s', (input, expected) => {
    expect(suggestedStep(input)).toBe(expected);
  });
});

describe('SuggestedStep', () => {
  it('una acción programada sin fecha lo dice', () => {
    renderEs(<SuggestedStep item={item({ nextAction: 'CartaDocumento' } as Partial<Item>)} />);
    expect(screen.getByText('Intimar por carta documento')).toBeInTheDocument();
    expect(screen.getByText('Todavía sin fecha.')).toBeInTheDocument();
  });

  it('la carta pendiente de confirmar explica que el borrador está listo', () => {
    renderEs(<SuggestedStep item={item({ planStatus: 'AwaitingLetterConfirmation' } as Partial<Item>)} />);
    expect(screen.getByText('Confirmar el envío de la carta')).toBeInTheDocument();
    expect(screen.getByText('El borrador está listo para imprimir y mandar por correo.')).toBeInTheDocument();
  });
});

describe('StageSteps', () => {
  it('en la cola marca el paso alcanzado y nombra la etapa', () => {
    renderEs(<StageSteps stage="Abogado" />);
    expect(screen.getByText('Con el abogado')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Paso 3 de 4' })).toBeInTheDocument();
  });

  it('un caso cerrado no marca ningún paso', () => {
    renderEs(<StageSteps stage="Cerrado" variant="full" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(document.querySelector('[aria-current]')).toBeNull();
    renderEs(<StageSteps stage="Cerrado" />);
    expect(screen.getByRole('img', { name: 'Cerrado' })).toBeInTheDocument();
  });
});
