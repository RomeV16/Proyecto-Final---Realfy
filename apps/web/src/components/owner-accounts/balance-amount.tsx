'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { absAmount, balanceReading } from '@/lib/owner-accounts';
import { MoneyText } from '@/components/ui/money-text';

const TONE = {
  agencyOwes: 'text-[var(--color-success)]',
  ownerOwes: 'text-[var(--color-danger)]',
  settled: 'text-[var(--color-muted)]',
} as const;

/** Saldo del locador con su lectura: quién le debe a quién. */
export function BalanceAmount({ value, currency, className }: { value: string; currency: string; className?: string }) {
  const t = useTranslations('ownerAccounts.reading');
  const reading = balanceReading(value);
  return (
    <span className={cn('inline-flex flex-col items-end leading-tight', className)}>
      <MoneyText value={absAmount(value)} currency={currency} decimals={2} className={cn('tabular-nums font-semibold', TONE[reading])} />
      <span className="text-xs text-[var(--color-muted)]">{t(reading)}</span>
    </span>
  );
}

/** Importe con signo (positivo en verde, negativo en rojo). */
export function SignedAmount({ value, currency, className }: { value: string; currency: string; className?: string }) {
  const n = Number(value);
  return (
    <MoneyText
      value={value}
      currency={currency}
      decimals={2}
      className={cn(
        'tabular-nums font-medium',
        n > 0 ? 'text-[var(--color-success)]' : n < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-muted)]',
        className,
      )}
    />
  );
}
