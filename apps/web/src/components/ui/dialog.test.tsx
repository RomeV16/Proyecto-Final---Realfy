// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './dialog';

function Single({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Dialog open={open} onClose={() => setOpen(false)} busy={busy}>
        <DialogHeader>
          <h2>Título del diálogo</h2>
        </DialogHeader>
        <DialogBody>
          <input aria-label="Nombre" />
        </DialogBody>
        <DialogFooter>
          <button>Guardar</button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

function Stacked() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(true);
  return (
    <>
      <Dialog open={a} onClose={() => setA(false)}>
        <DialogHeader>Primero</DialogHeader>
        <button>uno</button>
      </Dialog>
      <Dialog open={b} onClose={() => setB(false)}>
        <DialogHeader>Segundo</DialogHeader>
        <button>dos</button>
      </Dialog>
    </>
  );
}

describe('CP-74: diálogo accesible', () => {
  it('Tab cicla dentro del diálogo y Shift+Tab da la vuelta', async () => {
    const user = userEvent.setup();
    render(<Single />);
    await user.click(screen.getByText('Abrir'));
    const input = screen.getByLabelText('Nombre');
    const save = screen.getByText('Guardar');
    expect(input).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(input).toHaveFocus();
    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('Esc cierra y el foco vuelve al disparador', async () => {
    const user = userEvent.setup();
    render(<Single />);
    const trigger = screen.getByText('Abrir');
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('aria-labelledby apunta al título y es modal', async () => {
    const user = userEvent.setup();
    render(<Single />);
    await user.click(screen.getByText('Abrir'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Título del diálogo');
  });

  it('apilados: Esc cierra solo el de arriba y el scroll se libera al cerrar ambos', async () => {
    const user = userEvent.setup();
    document.body.style.overflow = '';
    render(<Stacked />);
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByText('Primero')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('busy bloquea Esc y el clic en el fondo', async () => {
    const user = userEvent.setup();
    render(<Single busy />);
    await user.click(screen.getByText('Abrir'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('el clic en el fondo cierra cuando no está ocupado', async () => {
    const user = userEvent.setup();
    render(<Single />);
    await user.click(screen.getByText('Abrir'));
    await user.click(screen.getByRole('dialog').previousElementSibling as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
