// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { ConfirmProvider, useConfirm } from './confirm-dialog';

const messages = { common: { confirm: 'Confirmar', cancel: 'Cancelar' } };

function Harness({ onResult }: { onResult: (v: boolean) => void }) {
  const confirm = useConfirm();
  return (
    <button
      onClick={async () =>
        onResult(await confirm({ body: '¿Eliminar el ítem?', tone: 'danger', confirmLabel: 'Eliminar' }))
      }
    >
      Pedir
    </button>
  );
}

function setup() {
  const results: boolean[] = [];
  render(
    <NextIntlClientProvider locale="es" messages={messages}>
      <ConfirmProvider>
        <Harness onResult={(v) => results.push(v)} />
      </ConfirmProvider>
    </NextIntlClientProvider>,
  );
  return { results, user: userEvent.setup() };
}

describe('CP-75: diálogo de confirmación', () => {
  it('resuelve true al aceptar', async () => {
    const { results, user } = setup();
    await user.click(screen.getByText('Pedir'));
    expect(screen.getByRole('dialog')).toHaveTextContent('¿Eliminar el ítem?');
    await user.click(screen.getByText('Eliminar'));
    expect(results).toEqual([true]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resuelve false al cancelar', async () => {
    const { results, user } = setup();
    await user.click(screen.getByText('Pedir'));
    await user.click(screen.getByText('Cancelar'));
    expect(results).toEqual([false]);
  });

  it('resuelve false con Esc y devuelve el foco', async () => {
    const { results, user } = setup();
    const trigger = screen.getByText('Pedir');
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(results).toEqual([false]);
    expect(trigger).toHaveFocus();
  });
});
