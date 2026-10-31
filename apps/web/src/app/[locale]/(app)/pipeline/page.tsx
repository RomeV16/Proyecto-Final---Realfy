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
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {t('pageTitle')}
        </h1>
      </div>
      <KanbanBoard />
    </div>
  );
}
