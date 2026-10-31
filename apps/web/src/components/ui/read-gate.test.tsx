// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';

const { canRead } = vi.hoisted(() => ({ canRead: vi.fn() }));
vi.mock('@/lib/permissions', () => ({ useCanRead: (r: string) => canRead(r) }));

import { ReadGate } from './read-gate';

describe('ReadGate', () => {
  it('muestra el contenido si el rol puede leer el recurso', () => {
    canRead.mockReturnValue(true);
    renderEs(
      <ReadGate resource="persons.bankAccounts">
        <p>cuentas</p>
      </ReadGate>,
    );
    expect(screen.getByText('cuentas')).toBeInTheDocument();
    expect(canRead).toHaveBeenCalledWith('persons.bankAccounts');
  });

  it('sin acceso muestra el aviso y no el contenido', () => {
    canRead.mockReturnValue(false);
    renderEs(
      <ReadGate resource="persons.bankAccounts">
        <p>cuentas</p>
      </ReadGate>,
    );
    expect(screen.queryByText('cuentas')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Sin acceso');
  });

  it('acepta un reemplazo propio', () => {
    canRead.mockReturnValue(false);
    renderEs(
      <ReadGate resource="audit" fallback={<p>nada</p>}>
        <p>bitácora</p>
      </ReadGate>,
    );
    expect(screen.getByText('nada')).toBeInTheDocument();
  });
});
