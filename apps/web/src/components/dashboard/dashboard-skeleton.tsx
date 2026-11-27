'use client';

import { useTranslations } from 'next-intl';

function Bar({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />;
}

/**
 * Loading shape of the panel. It mirrors the real dashboard box for box so the
 * arrival of data swaps content without moving anything, and it is also what
 * the login → panel transition paints while the app boots — one shape, three
 * moments, no reflow between them.
 *
 * When the user is already known (hydrated session, or the name carried by the
 * login transition) the greeting is rendered for real instead of as a bar, so
 * the headline never blinks from placeholder to text.
 */
export function DashboardSkeleton({ firstName }: { firstName?: string }) {
  const t = useTranslations('dashboard.panel');

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          {firstName ? (
            <h1 className="h1">{t('greeting', { name: firstName })}</h1>
          ) : (
            <Bar className="h-10 w-72" />
          )}
          <Bar className="h-4 w-40 mt-2" />
        </div>
        <Bar className="h-4 w-32 hidden sm:block" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-lux p-5 min-h-[8rem] flex flex-col justify-between">
            <Bar className="h-3 w-20" />
            <Bar className="h-8 w-24" />
          </div>
        ))}
      </div>

      <div className="card-lux grid overflow-hidden lg:grid-cols-[minmax(260px,0.8fr)_1.6fr]">
        <div className="p-5 sm:p-6 lg:border-r border-[var(--color-border)] flex flex-col justify-center gap-4">
          <Bar className="h-3 w-40" />
          <Bar className="h-11 w-56" />
          <div className="flex gap-6">
            <Bar className="h-10 w-16" />
            <Bar className="h-10 w-20" />
            <Bar className="h-10 w-16" />
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <Bar className="h-3 w-44 mb-4" />
          <Bar className="h-[200px] w-full" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="card-lux p-6 min-h-[360px] space-y-4">
          <Bar className="h-5 w-48" />
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="h-14 w-full" />
          ))}
        </div>
        <div className="space-y-5">
          <div className="card-lux p-6">
            <Bar className="h-5 w-32 mb-5" />
            <Bar className="h-[72px] w-full" />
          </div>
          <div className="card-lux p-6">
            <Bar className="h-5 w-44 mb-5" />
            <Bar className="h-[130px] w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
