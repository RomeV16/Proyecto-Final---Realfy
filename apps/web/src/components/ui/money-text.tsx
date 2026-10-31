'use client';

import { useLocale } from 'next-intl';
import { formatMoney, type MoneyOptions } from '@/lib/format';

interface MoneyTextProps extends Omit<MoneyOptions, 'locale'> {
  value: number | string | null | undefined;
  currency?: string | null;
  className?: string;
}

/** Importe con el formato del locale de la pantalla. */
export function MoneyText({ value, currency = 'ARS', className, ...options }: MoneyTextProps) {
  const locale = useLocale();
  return <span className={className}>{formatMoney(value, currency, { ...options, locale })}</span>;
}
