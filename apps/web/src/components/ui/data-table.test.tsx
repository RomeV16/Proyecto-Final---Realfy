// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '@/lib/api-client';
import { renderEs } from '../index-data/test-utils';
import { DataTable, EditableDataTable, type DataTableColumn } from './data-table';
import { useEditableGrid, type EditableGrid, type GridColumn } from '@/hooks/use-editable-grid';

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { id: '1', name: 'Beta', amount: 30 },
  { id: '2', name: 'alfa', amount: 5 },
  { id: '3', name: 'Gamma', amount: 100 },
];

const columns: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Nombre', render: (r) => r.name, sortable: true, sortValue: (r) => r.name },
  { key: 'amount', header: 'Importe', render: (r) => String(r.amount), sortable: true, sortValue: (r) => r.amount, alignRight: true },
  { key: 'id', header: 'Código', render: (r) => `#${r.id}` },
];

/** Nombres en el orden en que aparecen en la tabla de escritorio. */
function tableNames() {
  const table = screen.getByRole('table');
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);
}

describe('DataTable', () => {
  it('muestra las filas, y el vacío cuando no hay datos', () => {
    const { unmount } = renderEs(<DataTable items={rows} columns={columns} keyExtractor={(r) => r.id} />);
    expect(tableNames()).toEqual(['Beta', 'alfa', 'Gamma']);
    unmount();
    renderEs(
      <DataTable items={[]} columns={columns} keyExtractor={(r) => r.id} empty={{ title: 'Sin datos' }} />,
    );
    expect(screen.getByText('Sin datos')).toBeInTheDocument();
  });

  it('ordena en el cliente: ascendente, descendente y por otra columna, con aria-sort', async () => {
    const user = userEvent.setup();
    renderEs(<DataTable items={rows} columns={columns} keyExtractor={(r) => r.id} />);
    const nameHeader = screen.getByRole('columnheader', { name: /Nombre/ });
    expect(nameHeader).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Código' })).not.toHaveAttribute('aria-sort');

    await user.click(within(nameHeader).getByRole('button'));
    expect(tableNames()).toEqual(['alfa', 'Beta', 'Gamma']);
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    await user.click(within(nameHeader).getByRole('button'));
    expect(tableNames()).toEqual(['Gamma', 'Beta', 'alfa']);
    expect(nameHeader).toHaveAttribute('aria-sort', 'descending');

    await user.click(within(screen.getByRole('columnheader', { name: /Importe/ })).getByRole('button'));
    expect(tableNames()).toEqual(['alfa', 'Beta', 'Gamma']);
    expect(screen.getByRole('columnheader', { name: /Importe/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('ordena los valores vacíos al final', async () => {
    const user = userEvent.setup();
    const withGaps: Row[] = [
      { id: '1', name: 'B', amount: 1 },
      { id: '2', name: '', amount: 2 },
      { id: '3', name: 'A', amount: 3 },
    ];
    const cols: DataTableColumn<Row>[] = [
      { key: 'name', header: 'Nombre', render: (r) => r.name || '—', sortable: true, sortValue: (r) => r.name || null },
    ];
    renderEs(<DataTable items={withGaps} columns={cols} keyExtractor={(r) => r.id} />);
    await user.click(screen.getByRole('button', { name: /Nombre/ }));
    expect(tableNames()).toEqual(['A', 'B', '—']);
  });

  it('con orden controlado avisa a la pantalla y no reordena', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderEs(
      <DataTable
        items={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('columnheader', { name: /Nombre/ })).toHaveAttribute('aria-sort', 'ascending');
    await user.click(within(screen.getByRole('columnheader', { name: /Nombre/ })).getByRole('button'));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });
    await user.click(within(screen.getByRole('columnheader', { name: /Importe/ })).getByRole('button'));
    expect(onSortChange).toHaveBeenLastCalledWith({ key: 'amount', direction: 'asc' });
    expect(tableNames()).toEqual(['Beta', 'alfa', 'Gamma']);
  });

  it('una columna sin sortValue no reordena en el cliente', async () => {
    const user = userEvent.setup();
    const cols: DataTableColumn<Row>[] = [{ key: 'name', header: 'Nombre', render: (r) => r.name, sortable: true }];
    renderEs(<DataTable items={rows} columns={cols} keyExtractor={(r) => r.id} />);
    await user.click(screen.getByRole('button', { name: /Nombre/ }));
    expect(tableNames()).toEqual(['Beta', 'alfa', 'Gamma']);
  });

  it('un error reemplaza la tabla por el aviso', () => {
    renderEs(
      <DataTable
        items={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        error={new ApiRequestError(500, 'BOOM', 'Falló la carga', { correlationId: 'c-1' })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Falló la carga');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('pagina: muestra el rango y avisa el cambio de página; no aparece mientras carga', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const pagination = { page: 2, totalPages: 3, total: 30, limit: 12, onPageChange };
    const { unmount } = renderEs(
      <DataTable items={rows} columns={columns} keyExtractor={(r) => r.id} pagination={pagination} />,
    );
    expect(screen.getByText('Mostrando 13-24 de 30')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    unmount();

    renderEs(<DataTable items={rows} columns={columns} keyExtractor={(r) => r.id} pagination={pagination} loading />);
    expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument();
  });

  it('con una sola página no hay barra y los extremos deshabilitan sus botones', () => {
    const { unmount } = renderEs(
      <DataTable
        items={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        pagination={{ page: 1, totalPages: 1, total: 3, limit: 12, onPageChange: vi.fn() }}
      />,
    );
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    unmount();
    renderEs(
      <DataTable
        items={rows}
        columns={columns}
        keyExtractor={(r) => r.id}
        pagination={{ page: 1, totalPages: 2, total: 20, limit: 12, onPageChange: vi.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByText('Mostrando 1-12 de 20')).toBeInTheDocument();
  });
});

/* ──────────── Grilla editable ──────────── */

const gridColumns: GridColumn[] = [
  { key: 'property', header: 'Propiedad', readOnly: true },
  { key: 'amount', header: 'Importe', type: 'decimal', required: true },
  { key: 'kind', header: 'Servicio', type: 'select', options: [{ value: 'luz', label: 'Luz' }, { value: 'gas', label: 'Gas' }] },
  { key: 'note', header: 'Nota', placeholder: 'opcional' },
];

const gridRows = [
  { id: 'r1', values: { property: 'Casa A', amount: '100', kind: 'luz', note: '' } },
  { id: 'r2', values: { property: 'Casa B', amount: '200', kind: 'gas', note: '' } },
  { id: 'r3', values: { property: 'Casa C', amount: '300', kind: 'luz', note: '' } },
];

let lastGrid: EditableGrid;

function Harness({ allowAddRows = true }: { allowAddRows?: boolean }) {
  const grid = useEditableGrid({ columns: gridColumns, initialRows: gridRows, allowAddRows });
  lastGrid = grid;
  return <EditableDataTable grid={grid} columns={gridColumns} label="Boletas" footer={<span>pie</span>} />;
}

const amount = (n: number) => screen.getByRole('textbox', { name: `Importe ${n}` });
const note = (n: number) => screen.getByRole('textbox', { name: `Nota ${n}` });

describe('EditableDataTable', () => {
  it('muestra una grilla con encabezados, números de fila y celdas con nombre accesible', () => {
    renderEs(<Harness />);
    const grid = screen.getByRole('grid', { name: 'Boletas' });
    expect(within(grid).getByRole('columnheader', { name: /Importe/ })).toBeInTheDocument();
    expect(amount(2)).toHaveValue('200');
    expect(screen.getByRole('combobox', { name: 'Servicio 1' })).toHaveValue('luz');
    expect(screen.getByText('Casa A')).toBeInTheDocument();
    expect(screen.getByText('Sin cambios')).toBeInTheDocument();
    expect(screen.getByText('pie')).toBeInTheDocument();
    expect(screen.getByText(/Podés pegar filas/)).toBeInTheDocument();
  });

  it('editar una celda marca la celda y la fila como modificadas y cuenta los cambios', async () => {
    const user = userEvent.setup();
    renderEs(<Harness />);
    await user.clear(amount(1));
    await user.type(amount(1), '150');
    expect(amount(1)).toHaveAttribute('data-dirty', 'true');
    expect(amount(1).closest('tr')).toHaveAttribute('data-dirty', 'true');
    expect(amount(2).closest('tr')).not.toHaveAttribute('data-dirty');
    expect(screen.getByText('1 cambio sin guardar')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Servicio 2' }), 'luz');
    expect(screen.getByText('2 cambios sin guardar')).toBeInTheDocument();
  });

  describe('teclado', () => {
    it('Enter y flecha abajo bajan de fila; flecha arriba y Mayús+Enter suben', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(1));
      await user.keyboard('{Enter}');
      expect(amount(2)).toHaveFocus();
      await user.keyboard('{ArrowDown}');
      expect(amount(3)).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(amount(2)).toHaveFocus();
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      expect(amount(1)).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(amount(1)).toHaveFocus();
    });

    it('izquierda y derecha cambian de columna solo en el borde del texto, salteando la de solo lectura', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(1));
      // El cursor queda al final: derecha pasa a la siguiente columna (la lista).
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('combobox', { name: 'Servicio 1' })).toHaveFocus();
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('combobox', { name: 'Servicio 1' })).toHaveFocus();
      await user.click(note(1));
      await user.keyboard('{ArrowLeft}');
      expect(screen.getByRole('combobox', { name: 'Servicio 1' })).toHaveFocus();
    });

    it('con el cursor en medio del texto las flechas laterales mueven el cursor', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(1));
      await user.keyboard('{Home}{ArrowRight}');
      expect(amount(1)).toHaveFocus();
      await user.keyboard('{ArrowLeft}{ArrowLeft}');
      expect(amount(1)).toHaveFocus();
    });

    it('en una lista, Enter baja y las flechas verticales cambian la opción en vez de moverse', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      const select = screen.getByRole('combobox', { name: 'Servicio 1' });
      select.focus();
      await user.keyboard('{ArrowDown}');
      expect(select).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('combobox', { name: 'Servicio 2' })).toHaveFocus();
    });

    it('Enter en la última fila agrega una fila y enfoca la misma columna', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(3));
      await user.keyboard('{Enter}');
      expect(lastGrid.rows).toHaveLength(4);
      expect(amount(4)).toHaveFocus();
    });

    it('sin allowAddRows, Enter en la última fila no agrega nada', async () => {
      const user = userEvent.setup();
      renderEs(<Harness allowAddRows={false} />);
      await user.click(amount(3));
      await user.keyboard('{Enter}');
      expect(lastGrid.rows).toHaveLength(3);
      expect(screen.queryByRole('button', { name: 'Agregar fila' })).not.toBeInTheDocument();
    });

    it('otras teclas escriben normalmente', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(note(1));
      await user.keyboard('hola');
      expect(note(1)).toHaveValue('hola');
    });
  });

  describe('pegado desde una planilla', () => {
    it('reparte filas y columnas desde la celda activa y avisa cuántas filas', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(1));
      await user.paste('11,5\tGas\tuno\n22\tLuz\tdos');
      expect(amount(1)).toHaveValue('11,5');
      expect(screen.getByRole('combobox', { name: 'Servicio 1' })).toHaveValue('gas');
      expect(note(1)).toHaveValue('uno');
      expect(amount(2)).toHaveValue('22');
      expect(screen.getByRole('combobox', { name: 'Servicio 2' })).toHaveValue('luz');
      expect(note(2)).toHaveValue('dos');
      expect(amount(3)).toHaveValue('300');
      expect(screen.getByText('Se pegaron 2 filas')).toBeInTheDocument();
    });

    it('agrega filas cuando lo pegado excede la grilla', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(3));
      await user.paste('1\n2\n3');
      expect(lastGrid.rows).toHaveLength(5);
      expect(amount(5)).toHaveValue('3');
      expect(lastGrid.rows[4].isNew).toBe(true);
    });

    it('pega en una celda de lista desde el texto de la opción', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      const select = screen.getByRole('combobox', { name: 'Servicio 1' });
      select.focus();
      await user.paste('Gas\tnota pegada');
      expect(select).toHaveValue('gas');
      expect(note(1)).toHaveValue('nota pegada');
    });

    it('un texto común se pega en el campo sin interceptarse', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(note(2));
      await user.paste('texto simple');
      expect(note(2)).toHaveValue('texto simple');
      expect(screen.queryByText(/Se peg/)).not.toBeInTheDocument();
    });

    it('una fila sola se anuncia en singular', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(1));
      await user.paste('5\tGas');
      expect(screen.getByText('Se pegó 1 fila')).toBeInTheDocument();
    });
  });

  describe('validación por celda', () => {
    it('no muestra errores hasta tocar la celda; después marca el campo y lo describe', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.clear(amount(1));
      expect(amount(1)).toHaveAttribute('aria-invalid', 'true');
      expect(amount(1)).toHaveAccessibleDescription('Este campo es obligatorio');
      expect(amount(2)).not.toHaveAttribute('aria-invalid');
      expect(screen.getByText('1 celda con error')).toBeInTheDocument();
    });

    it('valida el decimal y la opción de lista, también para lo pegado', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(amount(1));
      await user.paste('abc\tAgua');
      expect(amount(1)).toHaveAccessibleDescription('Ingresá un número válido');
      expect(screen.getByRole('combobox', { name: 'Servicio 1' })).toHaveAccessibleDescription('Elegí una opción de la lista');
      expect(screen.getByText('2 celdas con error')).toBeInTheDocument();
    });

    it('validateAll muestra los errores de las celdas que nadie tocó', () => {
      renderEs(<Harness />);
      expect(screen.queryByText(/con error/)).not.toBeInTheDocument();
      // Una fila nueva con datos a medias: el importe obligatorio falta, pero nadie lo tocó.
      act(() => {
        lastGrid.addRow();
      });
      act(() => lastGrid.setCell('new-1', 'note', 'x'));
      expect(screen.getByRole('textbox', { name: 'Importe 4' })).not.toHaveAttribute('aria-invalid');
      act(() => {
        lastGrid.validateAll();
      });
      expect(screen.getByRole('textbox', { name: 'Importe 4' })).toHaveAttribute('aria-invalid', 'true');
    });
  });

  describe('filas', () => {
    it('Agregar fila suma una fila vacía con el foco en la primera celda editable', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Agregar fila' }));
      expect(lastGrid.rows).toHaveLength(4);
      expect(amount(4)).toHaveFocus();
      // La fila en blanco no cuenta como cambio ni como error.
      expect(screen.getByText('Sin cambios')).toBeInTheDocument();
      expect(lastGrid.isValid).toBe(true);
    });

    it('Quitar la fila la saca de la grilla y cuenta como cambio', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Quitar la fila 2' }));
      expect(screen.queryByText('Casa B')).not.toBeInTheDocument();
      expect(screen.getByText('1 cambio sin guardar')).toBeInTheDocument();
    });

    it('sin filas muestra el mensaje de vacío', async () => {
      const user = userEvent.setup();
      function Empty() {
        const grid = useEditableGrid({ columns: gridColumns, initialRows: [{ id: 'x', values: {} }] });
        return <EditableDataTable grid={grid} columns={gridColumns} label="Vacía" />;
      }
      renderEs(<Empty />);
      await user.click(screen.getByRole('button', { name: 'Quitar la fila 1' }));
      expect(screen.getByText('No hay filas para editar')).toBeInTheDocument();
    });

    it('las filas nuevas llevan el aviso para lectores de pantalla', async () => {
      const user = userEvent.setup();
      renderEs(<Harness />);
      await user.click(screen.getByRole('button', { name: 'Agregar fila' }));
      expect(screen.getByText('(Nueva)')).toBeInTheDocument();
    });
  });
});
