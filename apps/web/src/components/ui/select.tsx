import type { ComponentProps } from 'react';
import { inputStyles } from './input';

/** `<select>` nativo con el estilo de `Input`; `aria-invalid` marca el borde de error. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  const invalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return (
    <select className={inputStyles({ invalid, className })} {...props}>
      {children}
    </select>
  );
}
