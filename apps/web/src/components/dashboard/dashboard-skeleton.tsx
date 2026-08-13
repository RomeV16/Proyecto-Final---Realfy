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
  const t = useTranslations('dashboard');

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-3">Centro de operaciones</p>
          {firstName ? (
            <h1 className="h1">{t('welcome', { name: firstName })}</h1>
          ) : (
            <Bar className="h-10 w-72" />
          )}
          <Bar className="h-4 w-40 mt-2.5" />
        </div>
        <Bar className="h-4 w-32 hidden sm:block" />
      </div>

      <div className="card-lux grid lg:grid-cols-[minmax(240px,0.9fr)_1.6fr] min-h-[288px] overflow-hidden">
        <div className="p-7 lg:border-r border-[var(--color-border)] flex flex-col justify-center gap-4">
          <Bar className="h-3 w-40" />
          <Bar className="h-12 w-56" />
          <div className="flex gap-8">
            <Bar className="h-10 w-16" />
            <Bar className="h-10 w-24" />
            <Bar className="h-10 w-16" />
          </div>
        </div>
        <div className="p-6 pt-7">
          <Bar className="h-3 w-44 mb-4" />
          <Bar className="h-[190px] w-full" />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card-lux p-5 min-h-[128px] flex flex-col justify-between">
            <Bar className="h-3 w-20" />
            <Bar className="h-8 w-24" />
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        <div className="card-lux p-6 min-h-[420px] space-y-4">
          <Bar className="h-5 w-48" />
          {[0, 1, 2, 3, 4].map((i) => (
            <Bar key={i} className="h-12 w-full" />
          ))}
        </div>
        <div className="space-y-6">
          <div className="card-lux p-6 min-h-[220px]">
            <Bar className="h-5 w-44 mb-5" />
            <Bar className="h-[130px] w-full" />
          </div>
          <div className="card-lux p-6 min-h-[168px]">
            <Bar className="h-5 w-32 mb-5" />
            <Bar className="h-[84px] w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
