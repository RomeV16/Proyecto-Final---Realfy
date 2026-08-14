'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { KanbanBoard } from '@/components/kanban/kanban-board';

const ALLOWED_ROLES = ['Admin', 'Gerente', 'Ventas'];

export default function PipelinePage() {
  const t = useTranslations('kanban');
  const { user } = useAuth();

  if (!ALLOWED_ROLES.includes(user?.role || '')) {
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
