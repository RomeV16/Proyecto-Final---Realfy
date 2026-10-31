'use client';

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useSchemaMessages } from '@/hooks/use-zod-form';
import { cellKey, type EditableGrid, type GridColumn } from '@/hooks/use-editable-grid';
import { Button } from './button';
import { ErrorNotice } from './error-notice';
import { inputStyles } from './input';
import { PaginationBar } from './pagination';
import { ResponsiveTable, type Column, type ResponsiveTableProps, type TableSort } from './responsive-table';

/* ──────────────────────────── Tabla de datos ──────────────────────────── */

export interface DataTableColumn<T> extends Column<T> {
  /** Valor por el que se ordena la columna cuando el orden se resuelve en el cliente. */
  sortValue?: (item: T) => string | number | null | undefined;
}

export interface DataTablePagination {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T> extends Omit<ResponsiveTableProps<T>, 'columns' | 'sort' | 'onSortChange'> {
  columns: DataTableColumn<T>[];
  /** Orden controlado (por ejemplo, el que viaja a la API). Sin esto las columnas `sortable` ordenan en el cliente. */
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  /** Error de la carga: se muestra con `ErrorNotice` en lugar de la tabla. */
  error?: unknown;
  pagination?: DataTablePagination;
}

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Tabla de datos: `ResponsiveTable` (tabla en escritorio, tarjetas en móvil, con la transición cargando →
 * contenido → vacío) más orden por columna, paginación y el aviso de error. Con `sort` y `onSortChange` el orden
 * lo lleva la pantalla (para pedírselo a la API); sin ellos las columnas `sortable` se ordenan acá con `sortValue`.
 */
export function DataTable<T>({
  columns,
  items,
  sort,
  onSortChange,
  error,
  pagination,
  loading,
  ...rest
}: DataTableProps<T>) {
  const [localSort, setLocalSort] = useState<TableSort | null>(null);
  const controlled = onSortChange !== undefined;
  const activeSort = controlled ? (sort ?? null) : localSort;

  const sortedItems = useMemo(() => {
    if (controlled || !localSort) return items;
    const column = columns.find((c) => c.key === localSort.key);
    if (!column?.sortValue) return items;
    const sign = localSort.direction === 'asc' ? 1 : -1;
    const sortValue = column.sortValue;
    return [...items].sort((a, b) => sign * compareValues(sortValue(a), sortValue(b)));
  }, [items, columns, localSort, controlled]);

  function toggleSort(key: string) {
    const direction = activeSort?.key === key && activeSort.direction === 'asc' ? 'desc' : 'asc';
    const next: TableSort = { key, direction };
    if (controlled) onSortChange(next);
    else setLocalSort(next);
  }

  if (error != null) return <ErrorNotice error={error} />;

  return (
    <div>
      <ResponsiveTable
        {...rest}
        items={sortedItems}
        columns={columns}
        loading={loading}
        sort={activeSort}
        onSortChange={toggleSort}
      />
      {pagination && !loading && <PaginationBar {...pagination} />}
    </div>
  );
}

/* ──────────────────────────── Grilla editable ──────────────────────────── */

interface EditableDataTableProps {
  grid: EditableGrid;
  columns: GridColumn[];
  /** Nombre accesible de la grilla. */
  label: string;
  /** Contenido extra del pie (por ejemplo, el botón de guardar). */
  footer?: ReactNode;
  className?: string;
}

const CELL = 'h-9 px-2.5';

/**
 * Grilla editable para cargas masivas (boletas de servicios, cargos): cada celda es un campo, con
 *  - navegación por teclado: flechas arriba/abajo y Enter/Mayús+Enter cambian de fila; izquierda/derecha cambian de
 *    columna al llegar al borde del texto; Enter en la última fila agrega una (si la grilla lo permite);
 *  - pegado de filas copiadas de una planilla (tabulaciones y saltos de línea) a partir de la celda activa;
 *  - validación por celda (obligatorio, decimal, opción de lista, `validate` propio), mostrada en las celdas tocadas;
 *  - seguimiento de cambios: las celdas y filas modificadas se marcan y se cuentan.
 * El estado vive en `useEditableGrid`, así la pantalla lee `grid.filledRows`, `grid.isValid` y `grid.dirtyCount`.
 */
export function EditableDataTable({ grid, columns, label, footer, className }: EditableDataTableProps) {
  const t = useTranslations('dataTable.grid');
  const translate = useSchemaMessages();
  const id = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const pendingFocus = useRef<{ row: number; col: number } | null>(null);
  const [pasted, setPasted] = useState<number | null>(null);

  const editable = columns.filter((c) => !c.readOnly);

  // El foco pedido después de agregar una fila se aplica cuando la fila ya existe.
  const focusCell = (row: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`);
    if (!el) return false;
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
    return true;
  };
  useEffect(() => {
    if (pendingFocus.current && focusCell(pendingFocus.current.row, pendingFocus.current.col)) {
      pendingFocus.current = null;
    }
  });

  function move(row: number, col: number, dRow: number, dCol: number) {
    const nextCol = col + dCol;
    if (nextCol < 0 || nextCol >= editable.length) return;
    const nextRow = row + dRow;
    if (nextRow < 0) return;
    if (nextRow >= grid.rows.length) {
      if (dRow === 0 || !grid.allowAddRows) return;
      if (grid.addRow()) pendingFocus.current = { row: nextRow, col: nextCol };
      return;
    }
    focusCell(nextRow, nextCol);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, row: number, col: number) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const isSelect = target.tagName === 'SELECT';
    const atStart = !isSelect && (target as HTMLInputElement).selectionStart === 0 && (target as HTMLInputElement).selectionEnd === 0;
    const atEnd =
      !isSelect &&
      (target as HTMLInputElement).selectionStart === target.value.length &&
      (target as HTMLInputElement).selectionEnd === target.value.length;

    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        move(row, col, event.shiftKey ? -1 : 1, 0);
        break;
      case 'ArrowDown':
        if (isSelect && !event.altKey) return;
        event.preventDefault();
        move(row, col, 1, 0);
        break;
      case 'ArrowUp':
        if (isSelect && !event.altKey) return;
        event.preventDefault();
        move(row, col, -1, 0);
        break;
      case 'ArrowLeft':
        if (!atStart) return;
        event.preventDefault();
        move(row, col, 0, -1);
        break;
      case 'ArrowRight':
        if (!atEnd) return;
        event.preventDefault();
        move(row, col, 0, 1);
        break;
    }
  }

  function onPaste(event: ClipboardEvent<HTMLElement>, rowId: string, columnKey: string) {
    const applied = grid.pasteAt(rowId, columnKey, event.clipboardData.getData('text'));
    if (applied === null) return;
    event.preventDefault();
    setPasted(applied);
  }

  const visibleErrors = Object.keys(grid.errors).filter((key) => {
    const [rowId, ...rest] = key.split(':');
    return grid.isErrorVisible(rowId, rest.join(':'));
  }).length;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-x-auto rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table ref={tableRef} role="grid" aria-label={label} className="w-full border-collapse text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)]">
            <tr>
              <th scope="col" className="w-10 px-2 py-2.5 text-left text-xs font-semibold text-[var(--color-muted)]">
                <span className="sr-only">{t('rowNumber')}</span>
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-2.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]',
                    column.type === 'decimal' && 'text-right',
                    column.className,
                  )}
                >
                  {column.header}
                  {column.required && <span aria-hidden="true"> *</span>}
                </th>
              ))}
              <th scope="col" className="w-10 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {grid.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="px-4 py-8 text-center text-[var(--color-muted)]">
                  {t('empty')}
                </td>
              </tr>
            )}
            {grid.rows.map((row, rowIndex) => {
              const rowDirty = columns.some((c) => grid.dirtyCells.has(cellKey(row.id, c.key)));
              return (
                <tr
                  key={row.id}
                  data-dirty={rowDirty || undefined}
                  className={cn(
                    'border-b border-[var(--color-border)] last:border-0',
                    rowDirty && 'bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--color-surface))]',
                  )}
                >
                  <th
                    scope="row"
                    className="px-2 text-left text-xs font-normal tabular-nums text-[var(--color-muted)]"
                  >
                    {rowIndex + 1}
                    {row.isNew && <span className="sr-only"> ({t('newRow')})</span>}
                  </th>
                  {columns.map((column) => {
                    const key = cellKey(row.id, column.key);
                    const value = row.values[column.key] ?? '';
                    const colIndex = editable.findIndex((c) => c.key === column.key);
                    const error = grid.errors[key];
                    const showError = error && grid.isErrorVisible(row.id, column.key);
                    const errorId = `${id}-${key}-error`;
                    const common = {
                      'aria-label': `${column.header} ${rowIndex + 1}`,
                      'aria-invalid': showError ? (true as const) : undefined,
                      'aria-describedby': showError ? errorId : undefined,
                      'data-cell': `${rowIndex}:${colIndex}`,
                      'data-dirty': grid.dirtyCells.has(key) || undefined,
                    };
                    const dirtyStyle = grid.dirtyCells.has(key) && !showError ? 'border-brand-500/60' : undefined;

                    return (
                      <td key={column.key} className={cn('px-1.5 py-1.5 align-top', column.className)}>
                        {column.readOnly ? (
                          <span className="block px-1 py-1.5">{value}</span>
                        ) : column.type === 'select' ? (
                          <select
                            {...common}
                            value={value}
                            onChange={(e) => grid.setCell(row.id, column.key, e.target.value)}
                            onKeyDown={(e) => onKeyDown(e, rowIndex, colIndex)}
                            onPaste={(e) => onPaste(e, row.id, column.key)}
                            className={inputStyles({ invalid: !!showError, className: cn(CELL, dirtyStyle) })}
                          >
                            <option value="" />
                            {column.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            {...common}
                            type="text"
                            inputMode={column.type === 'decimal' ? 'decimal' : undefined}
                            value={value}
                            placeholder={column.placeholder}
                            onChange={(e) => grid.setCell(row.id, column.key, e.target.value)}
                            onKeyDown={(e) => onKeyDown(e, rowIndex, colIndex)}
                            onPaste={(e) => onPaste(e, row.id, column.key)}
                            className={inputStyles({
                              invalid: !!showError,
                              className: cn(CELL, column.type === 'decimal' && 'text-right tabular-nums', dirtyStyle),
                            })}
                          />
                        )}
                        {showError && (
                          <p id={errorId} className="mt-0.5 text-[11px] text-[var(--color-danger)]">
                            {translate(error)}
                          </p>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-1 py-1.5 text-center align-top">
                    <button
                      type="button"
                      onClick={() => grid.removeRow(row.id)}
                      aria-label={t('removeRow', { row: rowIndex + 1 })}
                      className="rounded-md px-2 py-1.5 text-[var(--color-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-danger)] focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {grid.allowAddRows && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const rowId = grid.addRow();
                if (rowId) pendingFocus.current = { row: grid.rows.length, col: 0 };
              }}
            >
              {t('addRow')}
            </Button>
          )}
          <p className="text-xs text-[var(--color-muted)]">{t('pasteHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3" aria-live="polite">
          {pasted !== null && <span className="text-xs text-[var(--color-muted)]">{t('pasted', { count: pasted })}</span>}
          {visibleErrors > 0 && (
            <span className="text-xs font-medium text-[var(--color-danger)]">{t('invalid', { count: visibleErrors })}</span>
          )}
          <span className="text-xs text-[var(--color-muted)]">
            {grid.isDirty ? t('changes', { count: grid.dirtyCount }) : t('noChanges')}
          </span>
          {footer}
        </div>
      </div>
    </div>
  );
}
