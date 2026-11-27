'use client';

import { useTranslations } from 'next-intl';
import { useCan } from '@/lib/permissions';
import { KanbanBoard } from '@/components/kanban/kanban-board';

export default function PipelinePage() {
  const t = useTranslations('kanban');
  const allowed = useCan('pipeline.access');

  if (!allowed) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-slate-500">{t('rbac.noAccess')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{t('pageTitle')}</h1>
        <p className="mt-2 hidden text-sm text-[var(--color-muted)] lg:block">{t('subtitle')}</p>
      </div>
      <KanbanBoard />
    </div>
  );
}
