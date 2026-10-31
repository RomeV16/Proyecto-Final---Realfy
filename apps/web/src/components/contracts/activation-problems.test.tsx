// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ApiRequestError } from '@/lib/api-client';
import { renderEs } from '../index-data/test-utils';
import { ActivationProblems, activationProblemsOf } from './activation-problems';

describe('activationProblemsOf', () => {
  it('devuelve la lista de motivos de un rechazo de activación', () => {
    const problems = [{ code: 'MISSING_INQUILINO' }];
    const err = new ApiRequestError(400, 'CONTRACT_NOT_ACTIVATABLE', 'x', { problems });
    expect(activationProblemsOf(err)).toEqual(problems);
  });

  it('devuelve lista vacía si el rechazo no trae motivos', () => {
    const err = new ApiRequestError(400, 'CONTRACT_NOT_ACTIVATABLE', 'x');
    expect(activationProblemsOf(err)).toEqual([]);
  });

  it('devuelve null para cualquier otro error', () => {
    expect(activationProblemsOf(new ApiRequestError(400, 'INVALID_TRANSITION', 'x'))).toBeNull();
    expect(activationProblemsOf(new Error('boom'))).toBeNull();
    expect(activationProblemsOf('texto')).toBeNull();
  });
});

describe('ActivationProblems', () => {
  it('traduce cada motivo conocido', () => {
    renderEs(
      <ActivationProblems
        problems={[
          { code: 'LESSOR_SHARES_INVALID' },
          { code: 'MISSING_INQUILINO' },
          { code: 'INVALID_DATES' },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No se puede activar el contrato:');
    expect(screen.getByText(
        'Los locadores tienen que sumar exactamente 100 % del cobro en cada fecha del contrato.',
      )).toBeInTheDocument();
    expect(screen.getByText('Falta cargar al menos un inquilino.')).toBeInTheDocument();
    expect(
      screen.getByText('La fecha de fin tiene que ser posterior a la de inicio.'),
    ).toBeInTheDocument();
  });

  it('con una superposición muestra las fechas y enlaza al otro contrato', () => {
    renderEs(
      <ActivationProblems
        problems={[
          {
            code: 'OVERLAPPING_CONTRACT',
            contractId: 'c-9',
            startDate: '2026-01-15T00:00:00.000Z',
            endDate: '2027-01-15T00:00:00.000Z',
          },
        ]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/contrato de alquiler activo del/);
    expect(screen.getByRole('link', { name: 'Ver contrato' })).toHaveAttribute(
      'href',
      '/es/contracts/c-9',
    );
  });

  it('una superposición sin id de contrato no muestra enlace', () => {
    renderEs(
      <ActivationProblems problems={[{ code: 'OVERLAPPING_CONTRACT' }]} />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('un código desconocido o una lista vacía caen en el mensaje genérico', () => {
    const generic = 'El contrato no cumple las condiciones para activarse.';
    const { unmount } = renderEs(
      <ActivationProblems problems={[{ code: 'NUEVO_CODIGO' }]} />,
    );
    expect(screen.getByText(generic)).toBeInTheDocument();
    unmount();
    renderEs(<ActivationProblems problems={[]} />);
    expect(screen.getByText(generic)).toBeInTheDocument();
  });
});
