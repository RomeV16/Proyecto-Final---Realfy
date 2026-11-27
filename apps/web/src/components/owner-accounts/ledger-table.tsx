'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { absAmount, type LedgerEntry } from '@/lib/owner-accounts';
import { DateText } from '@/components/ui/date-text';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';

interface Props {
  entries: LedgerEntry[];
  currency: string;
  /** Saldo antes del primer movimiento: se muestra como primer renglón. Sin valor, no se muestra. */
  opening?: string;
  /** Saldo después del último movimiento: se muestra como renglón de cierre. Sin valor, no se muestra. */
  closing?: string;
}

const TH = 'px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-muted)] first:pl-4 last:pr-4';
const TD = 'px-3 py-2.5 align-top first:pl-4 last:pr-4';
const NUM = 'whitespace-nowrap text-right tabular-nums';

/**
 * Cuenta corriente en formato de libro: cada movimiento en su columna de debe (lo que se le descuenta o se le
 * paga al locador) o de haber (lo que se le acredita), con el saldo acumulado después de cada uno.
 */
export function LedgerTable({ entries, currency, opening, closing }: Props) {
  const t = useTranslations('ownerAccounts');
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead className="border-b border-[var(--color-border)]">
          <tr>
            <th scope="col" className={TH}>{t('ledger.columns.date')}</th>
            <th scope="col" className={TH}>{t('ledger.columns.type')}</th>
            <th scope="col" className={`${TH} text-right`}>{t('ledger.columns.debit')}</th>
            <th scope="col" className={`${TH} text-right`}>{t('ledger.columns.credit')}</th>
            <th scope="col" className={`${TH} text-right`}>{t('ledger.columns.balance')}</th>
            <th scope="col" className={`${TH} hidden md:table-cell`}>{t('ledger.columns.statement')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {opening !== undefined && (
            <tr className="bg-[var(--color-surface-sunken)] text-[var(--color-muted)]">
              <td className={TD} />
              <td className={TD} colSpan={3}>{t('ledger.carried')}</td>
              <td className={`${TD} ${NUM} font-medium text-[var(--color-text)]`}>
                <MoneyText value={opening} currency={currency} decimals={2} />
              </td>
              <td className={`${TD} hidden md:table-cell`} />
            </tr>
          )}
          {entries.map((e) => {
            const amount = Number(e.amount);
            return (
              <tr key={e.id}>
                <td className={`${TD} whitespace-nowrap tabular-nums text-[var(--color-muted)]`}>
                  <DateText value={e.date} />
                </td>
                <td className={TD}>
                  <p className="font-medium text-[var(--color-text)]">{t(`types.${e.type}`)}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {e.description}
                    {e.property && <> · <span>{e.property}</span></>}
                  </p>
                </td>
                <td className={`${TD} ${NUM} text-[var(--color-danger)]`}>
                  {amount < 0 ? <MoneyText value={absAmount(e.amount)} currency={currency} decimals={2} /> : null}
                </td>
                <td className={`${TD} ${NUM} text-[var(--color-success)]`}>
                  {amount >= 0 ? <MoneyText value={e.amount} currency={currency} decimals={2} /> : null}
                </td>
                <td className={`${TD} ${NUM} font-medium text-[var(--color-text)]`}>
                  <MoneyText value={e.balance} currency={currency} decimals={2} />
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  {e.statement ? (
                    <Link href={`/estados-de-cuenta/${e.statement.id}`} className="hover:underline">
                      <StatusBadge domain="estadoCuenta" status={e.statement.status} />
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">{t('ledger.unlocked')}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        {closing !== undefined && (
          <tfoot className="border-t-2 border-[var(--color-border)]">
            <tr>
              <td className={TD} />
              <td className={`${TD} font-semibold text-[var(--color-text)]`} colSpan={3}>{t('ledger.closingRow')}</td>
              <td className={`${TD} ${NUM} font-semibold text-[var(--color-text)]`}>
                <MoneyText value={closing} currency={currency} decimals={2} />
              </td>
              <td className={`${TD} hidden md:table-cell`} />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
