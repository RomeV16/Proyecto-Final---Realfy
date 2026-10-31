import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import { inputStyles } from './input';

/** `<textarea>` con el estilo de `Input`; no se redimensiona salvo que se pida con `className`. */
export function Textarea({ className, rows = 3, ...props }: ComponentProps<'textarea'>) {
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return (
    <textarea
      rows={rows}
      className={inputStyles({ invalid, multiline: true, className: cn('resize-none', className) })}
      {...props}
    />
  );
}
