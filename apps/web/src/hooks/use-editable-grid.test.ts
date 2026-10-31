// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { cellKey, useEditableGrid, type GridColumn } from './use-editable-grid';

const columns: GridColumn[] = [
  { key: 'property', header: 'Propiedad', readOnly: true },
  { key: 'amount', header: 'Importe', type: 'decimal', required: true },
  { key: 'kind', header: 'Tipo', type: 'select', options: [{ value: 'luz', label: 'Luz' }, { value: 'gas', label: 'Gas' }] },
  { key: 'note', header: 'Nota', validate: (v) => (v.length > 5 ? 'Muy larga' : null) },
];

const initialRows = [
  { id: 'r1', values: { property: 'Casa A', amount: '100', kind: 'luz', note: '' } },
  { id: 'r2', values: { property: 'Casa B', amount: '200', kind: 'gas', note: '' } },
];

function setup(options: { allowAddRows?: boolean } = {}) {
  return renderHook(() => useEditableGrid({ columns, initialRows, ...options }));
}

describe('useEditableGrid', () => {
  it('arranca limpio y válido', () => {
    const { result } = setup();
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isValid).toBe(true);
    expect(result.current.dirtyCount).toBe(0);
  });

  it('editar una celda la marca sucia, y volver al valor original la limpia', () => {
    const { result } = setup();
    act(() => result.current.setCell('r1', 'amount', '150'));
    expect(result.current.dirtyCells.has(cellKey('r1', 'amount'))).toBe(true);
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.setCell('r1', 'amount', '100'));
    expect(result.current.isDirty).toBe(false);
  });

  it('valida obligatorio, decimal, opción y reglas propias', () => {
    const { result } = setup();
    act(() => {
      result.current.setCell('r1', 'amount', '');
      result.current.setCell('r2', 'amount', 'abc');
      result.current.setCell('r2', 'kind', 'agua');
      result.current.setCell('r2', 'note', 'demasiado larga');
    });
    expect(result.current.errors[cellKey('r1', 'amount')]).toBe('validation.required');
    expect(result.current.errors[cellKey('r2', 'amount')]).toBe('validation.invalidNumber');
    expect(result.current.errors[cellKey('r2', 'kind')]).toBe('dataTable.grid.invalidOption');
    expect(result.current.errors[cellKey('r2', 'note')]).toBe('Muy larga');
    expect(result.current.errorCount).toBe(4);
    expect(result.current.isValid).toBe(false);
  });

  it('el decimal acepta coma, porcentaje y negativos', () => {
    const { result } = setup();
    act(() => {
      result.current.setCell('r1', 'amount', '1,5');
      result.current.setCell('r2', 'amount', '-2%');
    });
    expect(result.current.isValid).toBe(true);
  });

  it('los errores se muestran en celdas tocadas y en todas tras validateAll', () => {
    const { result } = setup();
    act(() => {
      result.current.setCell('r1', 'amount', '');
    });
    expect(result.current.isErrorVisible('r1', 'amount')).toBe(true);
    expect(result.current.isErrorVisible('r2', 'amount')).toBe(false);
    let valid = true;
    act(() => {
      valid = result.current.validateAll();
    });
    expect(valid).toBe(false);
    expect(result.current.isErrorVisible('r2', 'amount')).toBe(true);
  });

  it('addRow agrega una fila nueva en blanco que se ignora hasta que tiene datos', () => {
    const { result } = setup();
    let id: string | null = null;
    act(() => {
      id = result.current.addRow();
    });
    expect(id).toBe('new-1');
    expect(result.current.rows).toHaveLength(3);
    expect(result.current.filledRows).toHaveLength(2);
    expect(result.current.isValid).toBe(true);
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.setCell('new-1', 'note', 'x'));
    expect(result.current.filledRows).toHaveLength(3);
    // Falta el importe obligatorio de la fila nueva.
    expect(result.current.errors[cellKey('new-1', 'amount')]).toBe('validation.required');
    expect(result.current.dirtyCells.has(cellKey('new-1', 'note'))).toBe(true);
  });

  it('sin allowAddRows no se agregan filas', () => {
    const { result } = setup({ allowAddRows: false });
    let id: string | null = 'x';
    act(() => {
      id = result.current.addRow();
    });
    expect(id).toBeNull();
    expect(result.current.rows).toHaveLength(2);
  });

  it('quitar una fila existente cuenta como cambio; quitar una nueva, no', () => {
    const { result } = setup();
    act(() => result.current.removeRow('r2'));
    expect(result.current.rows.map((r) => r.id)).toEqual(['r1']);
    expect(result.current.removedIds).toEqual(['r2']);
    expect(result.current.dirtyCount).toBe(1);
    act(() => {
      result.current.addRow();
    });
    act(() => result.current.removeRow('new-1'));
    expect(result.current.removedIds).toEqual(['r2']);
  });

  describe('pasteAt', () => {
    it('un texto común no se intercepta', () => {
      const { result } = setup();
      let applied: number | null = 0;
      act(() => {
        applied = result.current.pasteAt('r1', 'amount', '123');
      });
      expect(applied).toBeNull();
      expect(result.current.rows[0].values.amount).toBe('100');
    });

    it('reparte filas y columnas desde la celda, salteando las de solo lectura', () => {
      const { result } = setup();
      let applied: number | null = null;
      act(() => {
        applied = result.current.pasteAt('r1', 'amount', '10,5\tGas\tuna\n20\tluz\tdos');
      });
      expect(applied).toBe(2);
      expect(result.current.rows[0].values).toMatchObject({ property: 'Casa A', amount: '10,5', kind: 'gas', note: 'una' });
      expect(result.current.rows[1].values).toMatchObject({ property: 'Casa B', amount: '20', kind: 'luz', note: 'dos' });
      expect(result.current.isErrorVisible('r2', 'note')).toBe(true);
    });

    it('agrega filas cuando lo pegado excede las existentes', () => {
      const { result } = setup();
      act(() => {
        result.current.pasteAt('r2', 'amount', '1\n2\n3');
      });
      expect(result.current.rows).toHaveLength(4);
      expect(result.current.rows[3].values.amount).toBe('3');
      expect(result.current.rows[3].isNew).toBe(true);
    });

    it('sin allowAddRows descarta lo que excede', () => {
      const { result } = setup({ allowAddRows: false });
      let applied: number | null = null;
      act(() => {
        applied = result.current.pasteAt('r2', 'amount', '1\n2\n3');
      });
      expect(applied).toBe(1);
      expect(result.current.rows).toHaveLength(2);
    });

    it('descarta las columnas que sobran a la derecha y un valor de lista inexistente queda para mostrarse como error', () => {
      const { result } = setup();
      act(() => {
        result.current.pasteAt('r1', 'note', 'a\tb\tc');
      });
      expect(result.current.rows[0].values.note).toBe('a');
      act(() => {
        result.current.pasteAt('r1', 'kind', 'Agua\tx');
      });
      expect(result.current.rows[0].values.kind).toBe('Agua');
      expect(result.current.errors[cellKey('r1', 'kind')]).toBe('dataTable.grid.invalidOption');
    });

    it('una fila o columna de inicio desconocida no hace nada', () => {
      const { result } = setup();
      let a: number | null = 0;
      let b: number | null = 0;
      act(() => {
        a = result.current.pasteAt('nope', 'amount', '1\t2');
        b = result.current.pasteAt('r1', 'property', '1\t2');
      });
      expect(a).toBeNull();
      expect(b).toBeNull();
    });
  });

  it('reset vuelve al estado inicial o adopta filas nuevas como base', () => {
    const { result } = setup();
    act(() => {
      result.current.setCell('r1', 'amount', '999');
      result.current.removeRow('r2');
      result.current.validateAll();
    });
    act(() => result.current.reset());
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.rows[0].values.amount).toBe('100');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isErrorVisible('r1', 'amount')).toBe(false);

    act(() => result.current.reset([{ id: 'z1', values: { property: 'P', amount: '5', kind: '', note: '' } }]));
    expect(result.current.rows.map((r) => r.id)).toEqual(['z1']);
    act(() => result.current.setCell('z1', 'amount', '6'));
    expect(result.current.dirtyCount).toBe(1);
  });

  it('newRowValues completa las filas nuevas', () => {
    const { result } = renderHook(() =>
      useEditableGrid({ columns, initialRows: [], newRowValues: () => ({ kind: 'luz' }) }),
    );
    act(() => {
      result.current.addRow();
    });
    expect(result.current.rows[0].values).toMatchObject({ kind: 'luz', amount: '' });
  });
});
