'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { Button } from './button';

interface PrintSheetProps {
  /** Nombre accesible del documento (por ejemplo, "Recibo 0001-00000123"). */
  label: string;
  /** Encabezado del documento: logo, emisor, número, fecha. */
  header?: ReactNode;
  /** Pie del documento: leyendas legales, firma, datos de contacto. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Contenedor de un documento imprimible (recibos, liquidaciones, resúmenes de dueño).
 *
 * En pantalla se ve como una hoja A4 sobre el fondo de la app; al imprimir se aplana: sin borde, sombra ni
 * relleno (el margen lo pone `@page` en `globals.css`), texto negro sobre blanco, y la navegación y el
 * encabezado de la app desaparecen. Las filas de tablas y los bloques con `print-avoid-break` no se cortan
 * entre páginas; `print-page-break` fuerza una página nueva. Los controles que no son parte del documento
 * (botones, filtros) llevan `print:hidden` o `print-hide`, como `PrintButton`.
 */
export function PrintSheet({ label, header, footer, className, children }: PrintSheetProps) {
  return (
    <article
      aria-label={label}
      className={cn(
        'print-sheet mx-auto w-full max-w-[210mm] bg-white p-8 text-black',
        'rounded-[var(--radius-lg)] border border-[var(--color-border)] shadow-sm',
        'print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none',
        className,
      )}
    >
      {header && <header className="print-avoid-break mb-6 border-b border-black/20 pb-4">{header}</header>}
      <div>{children}</div>
      {footer && <footer className="print-avoid-break mt-8 border-t border-black/20 pt-4 text-xs">{footer}</footer>}
    </article>
  );
}

/** Botón que abre el diálogo de impresión del navegador. No sale en la hoja impresa. */
export function PrintButton({ className }: { className?: string }) {
  const t = useTranslations('print');
  return (
    <Button type="button" variant="secondary" size="sm" className={cn('print:hidden', className)} onClick={() => window.print()}>
      {t('action')}
    </Button>
  );
}
