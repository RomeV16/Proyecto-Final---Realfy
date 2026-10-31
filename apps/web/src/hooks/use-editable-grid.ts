'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { parseClipboardGrid } from '@/lib/grid-paste';
import { toDecimalString } from '@/lib/index-values';

export type GridValues = Record<string, string>;

export interface GridColumn {
  key: string;
  header: string;
  /** `decimal` valida con `toDecimalString` (acepta coma decimal y `%`); `select` exige una opción de la lista. */
  type?: 'text' | 'decimal' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Se muestra pero no se edita ni recibe pegado (por ejemplo, la propiedad de una fila ya cargada). */
  readOnly?: boolean;
  /** Mensaje de error (o clave i18n) para un valor inválido; `null` si está bien. Corre sobre valores no vacíos. */
  validate?: (value: string, row: GridValues) => string | null;
  placeholder?: string;
  /** Clases del ancho de la columna. */
  className?: string;
}

export interface GridRow {
  id: string;
  values: GridValues;
  /** Fila agregada en la grilla (no vino de los datos iniciales). */
  isNew: boolean;
}

interface Options {
  columns: GridColumn[];
  initialRows: { id: string; values: GridValues }[];
  /** Valores de una fila nueva; por defecto, todo vacío. Sin `allowAddRows` no se agregan filas. */
  newRowValues?: () => GridValues;
  allowAddRows?: boolean;
}

const REQUIRED_MESSAGE = 'validation.required';
const INVALID_NUMBER_MESSAGE = 'validation.invalidNumber';
const INVALID_OPTION_MESSAGE = 'dataTable.grid.invalidOption';

export const cellKey = (rowId: string, columnKey: string) => `${rowId}:${columnKey}`;

function blankValues(columns: GridColumn[]): GridValues {
  return Object.fromEntries(columns.map((c) => [c.key, '']));
}

function validateCell(column: GridColumn, value: string, row: GridValues): string | null {
  const text = value.trim();
  if (text === '') return column.required ? REQUIRED_MESSAGE : null;
  if (column.type === 'decimal' && toDecimalString(text) === null) return INVALID_NUMBER_MESSAGE;
  if (column.type === 'select' && !column.options?.some((o) => o.value === value)) return INVALID_OPTION_MESSAGE;
  return column.validate?.(value, row) ?? null;
}

/**
 * Estado de una grilla editable (cargas masivas de boletas, cargos, índices).
 *
 * - `rows` / `setCell` / `addRow` / `removeRow`: edición. Una fila nueva en blanco se ignora (`filledRows`).
 * - `pasteAt(filaId, columna, texto)`: reparte filas y columnas pegadas desde una planilla a partir de esa
 *   celda, salteando las columnas de solo lectura y agregando filas si hace falta. Devuelve la cantidad de
 *   filas tocadas, o `null` si el texto no era de planilla (el campo lo pega como un texto común).
 * - `errors`: por celda (`cellKey`), siempre calculados; la pantalla los muestra en las celdas ya tocadas, o
 *   en todas después de `validateAll()`.
 * - `dirtyCells` / `dirtyCount` / `isDirty`: celdas distintas del valor inicial, celdas con dato en filas
 *   nuevas y filas quitadas.
 */
export function useEditableGrid({ columns, initialRows, newRowValues, allowAddRows = true }: Options) {
  const initial = useRef(new Map(initialRows.map((r) => [r.id, r.values])));
  const counter = useRef(0);
  const [rows, setRows] = useState<GridRow[]>(() => initialRows.map((r) => ({ ...r, isNew: false })));
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [showAllErrors, setShowAllErrors] = useState(false);

  const makeRow = useCallback((): GridRow => {
    counter.current += 1;
    return { id: `new-${counter.current}`, values: { ...blankValues(columns), ...newRowValues?.() }, isNew: true };
  }, [columns, newRowValues]);

  const editable = useMemo(() => columns.filter((c) => !c.readOnly), [columns]);

  const markTouched = useCallback((keys: string[]) => {
    setTouched((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  const setCell = useCallback(
    (rowId: string, columnKey: string, value: string) => {
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, values: { ...r.values, [columnKey]: value } } : r)));
      markTouched([cellKey(rowId, columnKey)]);
    },
    [markTouched],
  );

  const addRow = useCallback((): string | null => {
    if (!allowAddRows) return null;
    const row = makeRow();
    setRows((prev) => [...prev, row]);
    return row.id;
  }, [allowAddRows, makeRow]);

  const removeRow = useCallback((rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    if (initial.current.has(rowId)) setRemovedIds((prev) => [...prev, rowId]);
  }, []);

  const pasteAt = useCallback(
    (rowId: string, columnKey: string, text: string): number | null => {
      const matrix = parseClipboardGrid(text);
      if (!matrix) return null;
      const startRow = rows.findIndex((r) => r.id === rowId);
      const startCol = editable.findIndex((c) => c.key === columnKey);
      if (startRow < 0 || startCol < 0) return null;

      const next = rows.map((r) => ({ ...r, values: { ...r.values } }));
      const touchedKeys: string[] = [];
      let applied = 0;

      matrix.forEach((cells, i) => {
        let target = next[startRow + i];
        if (!target) {
          if (!allowAddRows) return;
          target = makeRow();
          next.push(target);
        }
        let wrote = false;
        cells.forEach((raw, j) => {
          const column = editable[startCol + j];
          if (!column) return;
          const trimmed = raw.trim();
          const option =
            column.type === 'select'
              ? column.options?.find((o) => o.value === trimmed || o.label.toLowerCase() === trimmed.toLowerCase())
              : undefined;
          target.values[column.key] = option ? option.value : trimmed;
          touchedKeys.push(cellKey(target.id, column.key));
          wrote = true;
        });
        if (wrote) applied += 1;
      });

      setRows(next);
      markTouched(touchedKeys);
      return applied;
    },
    [rows, editable, allowAddRows, makeRow, markTouched],
  );

  const isBlank = useCallback(
    (row: GridRow) => row.isNew && editable.every((c) => (row.values[c.key] ?? '').trim() === ''),
    [editable],
  );

  const filledRows = useMemo(() => rows.filter((r) => !isBlank(r)), [rows, isBlank]);

  const errors = useMemo(() => {
    const found: Record<string, string> = {};
    for (const row of filledRows) {
      for (const column of editable) {
        const error = validateCell(column, row.values[column.key] ?? '', row.values);
        if (error) found[cellKey(row.id, column.key)] = error;
      }
    }
    return found;
  }, [filledRows, editable]);

  const dirtyCells = useMemo(() => {
    const dirty = new Set<string>();
    for (const row of rows) {
      const original = initial.current.get(row.id);
      for (const column of editable) {
        const value = row.values[column.key] ?? '';
        const changed = row.isNew ? value.trim() !== '' : value !== (original?.[column.key] ?? '');
        if (changed) dirty.add(cellKey(row.id, column.key));
      }
    }
    return dirty;
  }, [rows, editable]);

  const errorCount = Object.keys(errors).length;
  const dirtyCount = dirtyCells.size + removedIds.length;

  /** Muestra los errores de todas las celdas (por ejemplo, al intentar guardar). Devuelve si la grilla es válida. */
  const validateAll = useCallback((): boolean => {
    setShowAllErrors(true);
    return errorCount === 0;
  }, [errorCount]);

  /** Vuelve al estado indicado (o a uno nuevo con esas filas, por ejemplo después de guardar). */
  const reset = useCallback((nextRows?: { id: string; values: GridValues }[]) => {
    if (nextRows) initial.current = new Map(nextRows.map((r) => [r.id, r.values]));
    const source = nextRows ?? [...initial.current].map(([id, values]) => ({ id, values }));
    setRows(source.map((r) => ({ ...r, isNew: false })));
    setRemovedIds([]);
    setTouched(new Set());
    setShowAllErrors(false);
  }, []);

  const isErrorVisible = useCallback(
    (rowId: string, columnKey: string) => showAllErrors || touched.has(cellKey(rowId, columnKey)),
    [showAllErrors, touched],
  );

  return {
    rows,
    filledRows,
    removedIds,
    errors,
    errorCount,
    dirtyCells,
    dirtyCount,
    isDirty: dirtyCount > 0,
    isValid: errorCount === 0,
    allowAddRows,
    isErrorVisible,
    setCell,
    addRow,
    removeRow,
    pasteAt,
    validateAll,
    reset,
  };
}

export type EditableGrid = ReturnType<typeof useEditableGrid>;
