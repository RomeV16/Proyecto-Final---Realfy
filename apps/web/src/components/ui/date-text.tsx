'use client';

import { useLocale } from 'next-intl';
import { formatDate, formatDateTime, formatLocalDate, type DateStyle } from '@/lib/format';

interface DateTextProps {
  value: string | Date | null | undefined;
  /**
   * `date` (por defecto): fecha de solo día, se lee en UTC.
   * `instant`: un instante mostrado como fecha en la zona del usuario.
   * `datetime`: un instante con fecha y hora.
   */
  kind?: 'date' | 'instant' | 'datetime';
  style?: DateStyle;
  className?: string;
}

/** Fecha con el formato del locale de la pantalla. */
export function DateText({ value, kind = 'date', style, className }: DateTextProps) {
  const locale = useLocale();
  let text: string;
  if (kind === 'datetime') {
    text = formatDateTime(value, typeof style === 'object' ? style : undefined, locale);
  } else if (kind === 'instant') {
    text = formatLocalDate(value, style, locale);
  } else {
    text = formatDate(value, style, locale);
  }
  return <span className={className}>{text}</span>;
}
