'use client';

import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { PersonForm } from '@/components/persons/person-form';

export default function NewPersonPage() {
  const t = useTranslations('persons');
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href={'/persons'}
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
        onSuccess={(id) => router.push(`/persons/${id}`)}
        onCancel={() => router.push('/persons')}
      />
    </div>
  );
}
