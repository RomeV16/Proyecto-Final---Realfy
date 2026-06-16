'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PersonForm } from '@/components/persons/person-form';

export default function NewPersonPage() {
  const t = useTranslations('persons');
  const pathname = usePathname();
  const router = useRouter();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/persons`}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label={t('backToList')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('createTitle')}</h1>
      </div>

      <PersonForm
        mode="create"
        onSuccess={(id) => router.push(`${localePrefix}/persons/${id}`)}
        onCancel={() => router.push(`${localePrefix}/persons`)}
      />
    </div>
  );
}
