'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { formatDate, formatMoneyFixed, formatPeriod } from '@/lib/format';
import { proposedDueDate, type SheetResponse, type SheetRow } from '@/lib/service-bills';
import { Icon } from '@/components/ui/icon';

export interface ServiceGroup {
  serviceType: string;
  rows: SheetRow[];
  loaded: number;
}

/** Una boleta anulada no cuenta como cargada: el servicio sigue esperando la del mes. */
export const hasBill = (row: SheetRow) => row.bills.some((bill) => bill.status !== 'Anulada');

/** Los servicios del mes agrupados por tipo, en el orden en que llegan, con cuántos ya tienen boleta. */
export function groupByServiceType(rows: SheetRow[]): ServiceGroup[] {
  const groups = new Map<string, ServiceGroup>();
  for (const row of rows) {
    const key = row.service.serviceType;
    const group = groups.get(key) ?? { serviceType: key, rows: [], loaded: 0 };
    group.rows.push(row);
    if (hasBill(row)) group.loaded += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-sunken)]"
    >
      <div
        className={cn('h-full rounded-full', done === total ? 'bg-[var(--color-success)]' : 'bg-[var(--color-brand-500)]')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Tablero del mes: una columna por tipo de servicio con las propiedades que ya tienen la boleta cargada y las que
 * faltan. Es de lectura; los importes se cargan en la planilla de abajo.
 */
export function ServiceBoard({ sheet }: { sheet: SheetResponse }) {
  const t = useTranslations('serviceBills.board');
  const tTypes = useTranslations('services.serviceTypes');
  const locale = useLocale();
  const period = sheet.period.slice(0, 7);
  const groups = groupByServiceType(sheet.rows);
  const total = sheet.rows.length;
  const loaded = groups.reduce((sum, group) => sum + group.loaded, 0);
  const typeName = (type: string) => (tTypes.has(type) ? tTypes(type) : type);

  return (
    <div role="group" aria-label={t('label')} className="space-y-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-[var(--color-text)]">
            <span className="font-mono text-lg font-semibold tabular-nums">
              {loaded}/{total}
            </span>{' '}
            {t('overall', { count: total, period: formatPeriod(sheet.period, undefined, locale).toLowerCase() })}
          </p>
          <p className="text-sm text-[var(--color-muted)]">
            {loaded === total ? t('allLoaded') : t('missing', { count: total - loaded })}
          </p>
        </div>
        <Progress done={loaded} total={total} label={t('overallLabel')} />
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {groups.map((group) => {
          const name = typeName(group.serviceType);
          return (
            <div key={group.serviceType} role="group" aria-label={name} className="border-t-2 border-[var(--color-text)] pt-2">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-[var(--color-text)]">{name}</h2>
                <span className="font-mono text-xs tabular-nums text-[var(--color-muted)]">
                  {t('groupCount', { loaded: group.loaded, total: group.rows.length })}
                </span>
              </div>
              <ul className="mt-2 divide-y divide-[var(--color-border)]">
                {group.rows.map((row) => {
                  const done = hasBill(row);
                  const bills = row.bills.filter((bill) => bill.status !== 'Anulada');
                  const amount = bills.reduce((sum, bill) => sum + Number(bill.amount), 0);
                  const due = bills[0]?.dueDate ?? proposedDueDate(period, row.service.dueDay);
                  return (
                    <li key={row.service.id} className="flex items-start gap-2.5 py-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                          done
                            ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                            : 'border-dashed border-[var(--color-slate-400)]',
                        )}
                      >
                        {done && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[var(--color-text)]">
                          {row.service.property?.title ?? t('noProperty')}
                        </p>
                        {row.service.providerName && (
                          <p className="truncate text-xs text-[var(--color-muted)]">{row.service.providerName}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {done ? (
                          <p className="font-mono text-sm tabular-nums text-[var(--color-text)]">
                            {formatMoneyFixed(amount, row.service.currency, locale)}
                          </p>
                        ) : (
                          <p className="text-sm font-medium text-[color-mix(in_oklab,var(--color-warning)_72%,var(--color-text))]">
                            {t('pending')}
                          </p>
                        )}
                        <p className="text-xs tabular-nums text-[var(--color-muted)]">
                          {t('due', { date: formatDate(due, 'dayMonth', locale) })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
