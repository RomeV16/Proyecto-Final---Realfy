'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────

interface PipelineStage {
  id: string;
  name: string;
  sortOrder: number;
  staleDays: number | null;
  isDefault: boolean;
}

interface Pipeline {
  id: string;
  type: string;
  name: string;
  isActive: boolean;
  stages: PipelineStage[];
}

// ─── Icons ──────────────────────────────────────────────

function IconArrowUp() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function IconX() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ─── Loading Skeleton ───────────────────────────────────

function StageSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-[var(--radius-xl)]" />
      ))}
    </div>
  );
}

// ─── Confirm Dialog ─────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  description,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
}: {
  open: boolean;
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
  cancelLabel: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-[var(--color-surface)] rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-zoom-in">
        <h3 className="text-lg font-semibold text-[var(--color-text)]">{title}</h3>
        <p className="text-sm text-[var(--color-muted)]">{description}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] text-sm font-medium hover:bg-[var(--color-bg)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2.5 rounded-lg bg-[var(--color-danger)] text-white text-sm font-medium hover:brightness-95 transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Stage Modal ────────────────────────────────────

function AddStageModal({
  open,
  onClose,
  onSubmit,
  nextSortOrder,
  t,
  tCommon,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; sortOrder: number; staleDays: number | null }) => Promise<void>;
  nextSortOrder: number;
  t: ReturnType<typeof useTranslations>;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const [name, setName] = useState('');
  const [staleDays, setStaleDays] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('validation.nameRequired'));
      return;
    }
    if (name.length > 200) {
      setError(t('validation.nameMaxLength'));
      return;
    }
    const parsedStaleDays = staleDays.trim() ? parseInt(staleDays, 10) : null;
    if (staleDays.trim() && (isNaN(parsedStaleDays!) || parsedStaleDays! < 1)) {
      setError(t('validation.staleDaysMin'));
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), sortOrder: nextSortOrder, staleDays: parsedStaleDays });
      setName('');
      setStaleDays('');
      onClose();
    } catch {
      setError(t('toast.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--color-surface)] rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5 animate-zoom-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{t('addModal.title')}</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-muted)] hover:bg-[var(--color-bg)] transition-colors"
            aria-label={tCommon('close')}
          >
            <IconX />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="stageName" className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('addModal.namePlaceholder')}
            </label>
            <input
              id="stageName"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder={t('addModal.namePlaceholder')}
              className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="staleDaysInput" className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('addModal.staleDaysLabel')}
            </label>
            <input
              id="staleDaysInput"
              type="number"
              min={1}
              value={staleDays}
              onChange={(e) => setStaleDays(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder={t('staleDaysPlaceholder')}
              className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            />
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] text-[var(--color-danger)] text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text)] text-sm font-medium hover:bg-[var(--color-bg)] transition-colors"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting && <Spinner className="w-4 h-4 text-white" />}
            {submitting ? t('addModal.submitting') : t('addModal.submit')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Stage Row (Desktop) ────────────────────────────────

function StageRow({
  stage,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRename,
  onUpdateStaleDays,
  onDelete,
  t,
}: {
  stage: PipelineStage;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (name: string) => void;
  onUpdateStaleDays: (days: number | null) => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(stage.name);
  const [editingStaleDays, setEditingStaleDays] = useState(false);
  const [editStaleDays, setEditStaleDays] = useState(stage.staleDays?.toString() ?? '');

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== stage.name) {
      onRename(trimmed);
    } else {
      setEditName(stage.name);
    }
    setEditing(false);
  };

  const commitStaleDays = () => {
    const val = editStaleDays.trim();
    const parsed = val ? parseInt(val, 10) : null;
    if (parsed !== stage.staleDays) {
      if (val && (isNaN(parsed!) || parsed! < 1)) {
        setEditStaleDays(stage.staleDays?.toString() ?? '');
      } else {
        onUpdateStaleDays(parsed);
      }
    }
    setEditingStaleDays(false);
  };

  return (
    <tr className="hover:bg-[var(--color-bg)]/50 transition-colors group">
      {/* Posición */}
      <td className="px-4 py-3 text-sm text-[var(--color-muted)] w-12">{stage.sortOrder + 1}</td>

      {/* Nombre — click para editar */}
      <td className="px-4 py-3 text-sm">
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') {
                  setEditName(stage.name);
                  setEditing(false);
                }
              }}
              className="w-full max-w-xs rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              autoFocus
            />
          </div>
        ) : (
          <button
            onClick={() => { setEditName(stage.name); setEditing(true); }}
            className="text-[var(--color-text)] font-medium hover:text-brand-600 transition-colors text-left cursor-text"
            title={t('rename')}
          >
            {stage.name}
          </button>
        )}
      </td>

      {/* staleDays — click para editar */}
      <td className="px-4 py-3 text-sm w-40">
        {editingStaleDays ? (
          <input
            type="number"
            min={1}
            value={editStaleDays}
            onChange={(e) => setEditStaleDays(e.target.value)}
            onBlur={commitStaleDays}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitStaleDays();
              if (e.key === 'Escape') {
                setEditStaleDays(stage.staleDays?.toString() ?? '');
                setEditingStaleDays(false);
              }
            }}
            className="w-20 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setEditStaleDays(stage.staleDays?.toString() ?? ''); setEditingStaleDays(true); }}
            className="text-[var(--color-muted)] hover:text-brand-600 transition-colors cursor-text"
          >
            {stage.staleDays != null ? `${stage.staleDays} días` : t('staleDaysPlaceholder')}
          </button>
        )}
      </td>

      {/* Acciones */}
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t('moveUp')}
            aria-label={t('moveUp')}
          >
            <IconArrowUp />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title={t('moveDown')}
            aria-label={t('moveDown')}
          >
            <IconArrowDown />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] transition-colors"
            title={t('removeStage')}
            aria-label={t('removeStage')}
          >
            <IconTrash />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Stage Card (Mobile) ────────────────────────────────

function StageCard({
  stage,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRename,
  onUpdateStaleDays,
  onDelete,
  t,
}: {
  stage: PipelineStage;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRename: (name: string) => void;
  onUpdateStaleDays: (days: number | null) => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(stage.name);
  const [editingStaleDays, setEditingStaleDays] = useState(false);
  const [editStaleDays, setEditStaleDays] = useState(stage.staleDays?.toString() ?? '');

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== stage.name) {
      onRename(trimmed);
    } else {
      setEditName(stage.name);
    }
    setEditing(false);
  };

  const commitStaleDays = () => {
    const val = editStaleDays.trim();
    const parsed = val ? parseInt(val, 10) : null;
    if (parsed !== stage.staleDays) {
      if (val && (isNaN(parsed!) || parsed! < 1)) {
        setEditStaleDays(stage.staleDays?.toString() ?? '');
      } else {
        onUpdateStaleDays(parsed);
      }
    }
    setEditingStaleDays(false);
  };

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-[var(--color-muted)] shrink-0">{stage.sortOrder + 1}</span>
          {editing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditName(stage.name); setEditing(false); }
              }}
              className="w-full max-w-sm rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setEditName(stage.name); setEditing(true); }}
              className="text-sm font-medium text-[var(--color-text)] hover:text-brand-600 transition-colors text-left truncate cursor-text"
              title={t('rename')}
            >
              {stage.name}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t('moveUp')}
          >
            <IconArrowUp />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label={t('moveDown')}
          >
            <IconArrowDown />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[color-mix(in_oklab,var(--color-danger)_10%,transparent)] transition-colors"
            aria-label={t('removeStage')}
          >
            <IconTrash />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--color-muted)]">{t('table.staleDays')}:</span>
        {editingStaleDays ? (
          <input
            type="number"
            min={1}
            value={editStaleDays}
            onChange={(e) => setEditStaleDays(e.target.value)}
            onBlur={commitStaleDays}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitStaleDays();
              if (e.key === 'Escape') { setEditStaleDays(stage.staleDays?.toString() ?? ''); setEditingStaleDays(false); }
            }}
            className="w-16 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            autoFocus
          />
        ) : (
          <button
            onClick={() => { setEditStaleDays(stage.staleDays?.toString() ?? ''); setEditingStaleDays(true); }}
            className="text-xs text-[var(--color-muted)] hover:text-brand-600 transition-colors cursor-text"
          >
            {stage.staleDays != null ? `${stage.staleDays} días` : t('staleDaysPlaceholder')}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────

export default function PipelineSettingsPage() {
  const t = useTranslations('pipeline');
  const tCommon = useTranslations('common');
  const { user } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('Alquiler');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PipelineStage | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // RBAC: solo Admin y Gerente pueden administrar pipelines
  const isAdminOrGerente = user?.role === 'Admin' || user?.role === 'Gerente';

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadPipelines = useCallback(async () => {
    try {
      const data = await apiClient<Pipeline[]>('/pipelines');
      setPipelines(data);
    } catch {
      showToast(t('toast.error'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    loadPipelines();
  }, [loadPipelines]);

  const activePipeline = pipelines.find((p) => p.type === activeTab);
  const sortedStages = activePipeline
    ? [...activePipeline.stages].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  // ─── Operaciones sobre etapas ──────────────────────────

  const handleReorder = useCallback(
    async (stageIndex: number, direction: 'up' | 'down') => {
      if (!activePipeline) return;
      const stages = [...sortedStages];
      const targetIdx = direction === 'up' ? stageIndex - 1 : stageIndex + 1;
      if (targetIdx < 0 || targetIdx >= stages.length) return;

      [stages[stageIndex], stages[targetIdx]] = [stages[targetIdx], stages[stageIndex]];
      const stageIds = stages.map((s) => s.id);

      try {
        await apiClient(`/pipelines/${activePipeline.id}/stages/reorder`, {
          method: 'PATCH',
          body: JSON.stringify({ stageIds }),
        });
        showToast(t('toast.reorderSuccess'));
        await loadPipelines();
      } catch {
        showToast(t('toast.error'), 'error');
      }
    },
    [activePipeline, sortedStages, loadPipelines, showToast, t],
  );

  const handleRename = useCallback(
    async (stageId: string, name: string) => {
      if (!activePipeline) return;
      try {
        await apiClient(`/pipelines/${activePipeline.id}/stages/${stageId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        });
        showToast(t('toast.stageUpdated'));
        await loadPipelines();
      } catch {
        showToast(t('toast.error'), 'error');
      }
    },
    [activePipeline, loadPipelines, showToast, t],
  );

  const handleUpdateStaleDays = useCallback(
    async (stageId: string, staleDays: number | null) => {
      if (!activePipeline) return;
      try {
        await apiClient(`/pipelines/${activePipeline.id}/stages/${stageId}`, {
          method: 'PATCH',
          body: JSON.stringify({ staleDays }),
        });
        showToast(t('toast.stageUpdated'));
        await loadPipelines();
      } catch {
        showToast(t('toast.error'), 'error');
      }
    },
    [activePipeline, loadPipelines, showToast, t],
  );

  const handleAddStage = useCallback(
    async (data: { name: string; sortOrder: number; staleDays: number | null }) => {
      if (!activePipeline) return;
      await apiClient(`/pipelines/${activePipeline.id}/stages`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      showToast(t('toast.stageAdded'));
      await loadPipelines();
    },
    [activePipeline, loadPipelines, showToast, t],
  );

  const handleDeleteStage = useCallback(
    async (stage: PipelineStage) => {
      if (!activePipeline) return;
      try {
        await apiClient(`/pipelines/${activePipeline.id}/stages/${stage.id}`, {
          method: 'DELETE',
        });
        showToast(t('toast.stageRemoved'));
        await loadPipelines();
      } catch {
        showToast(t('toast.error'), 'error');
      }
      setDeleteTarget(null);
    },
    [activePipeline, loadPipelines, showToast, t],
  );

  // ─── RBAC ──────────────────────────────────────────────

  if (!isAdminOrGerente) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-[var(--color-muted)]">{t('rbac.noAccess')}</p>
      </div>
    );
  }

  // ─── Tabs ──────────────────────────────────────────────

  const tabs = ['Alquiler', 'Venta'] as const;

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-[color-mix(in_oklab,var(--color-success)_10%,var(--color-surface))] border border-[color-mix(in_oklab,var(--color-success)_28%,var(--color-border))] text-[var(--color-success)]'
              : 'bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] text-[var(--color-danger)]'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Encabezado */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)] tracking-tight">{t('title')}</h1>
        <p className="text-sm text-[var(--color-muted)] mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-bg)] rounded-lg p-1 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
            }`}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {loading ? (
        <StageSkeleton />
      ) : sortedStages.length === 0 ? (
        <EmptyState
          iconName="pipeline"
          title={t('noStages')}
          subtitle={t('emptyState.subtitle')}
          action={
            <button
              onClick={() => setAddModalOpen(true)}
              className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
            >
              <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
              {t('addStage')}
            </button>
          }
        />
      ) : (
        <>
          {/* Tabla de escritorio (lg+) */}
          <div className="hidden lg:block bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--color-bg)] border-b border-[var(--color-border)]">
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)] w-12">{t('table.order')}</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">{t('table.name')}</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)] w-40">{t('table.staleDays')}</th>
                  <th className="text-right px-4 py-3 font-medium text-[var(--color-muted)] w-32">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {sortedStages.map((stage, idx) => (
                  <StageRow
                    key={stage.id}
                    stage={stage}
                    isFirst={idx === 0}
                    isLast={idx === sortedStages.length - 1}
                    onMoveUp={() => handleReorder(idx, 'up')}
                    onMoveDown={() => handleReorder(idx, 'down')}
                    onRename={(name) => handleRename(stage.id, name)}
                    onUpdateStaleDays={(days) => handleUpdateStaleDays(stage.id, days)}
                    onDelete={() => setDeleteTarget(stage)}
                    t={t}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Layout móvil (<lg) */}
          <div className="lg:hidden space-y-3">
            {sortedStages.map((stage, idx) => (
              <StageCard
                key={stage.id}
                stage={stage}
                isFirst={idx === 0}
                isLast={idx === sortedStages.length - 1}
                onMoveUp={() => handleReorder(idx, 'up')}
                onMoveDown={() => handleReorder(idx, 'down')}
                onRename={(name) => handleRename(stage.id, name)}
                onUpdateStaleDays={(days) => handleUpdateStaleDays(stage.id, days)}
                onDelete={() => setDeleteTarget(stage)}
                t={t}
              />
            ))}
          </div>
        </>
      )}

      {/* Botón de agregar etapa */}
      <button
        onClick={() => setAddModalOpen(true)}
        className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
      >
        <IconPlus />
        {t('addStage')}
      </button>

      {/* Modal de nueva etapa */}
      <AddStageModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSubmit={handleAddStage}
        nextSortOrder={sortedStages.length}
        t={t}
        tCommon={tCommon}
      />

      {/* Confirmación de borrado */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t('removeStage')}
        description={deleteTarget ? t('confirmDeleteDesc') : ''}
        onConfirm={() => deleteTarget && handleDeleteStage(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        confirmLabel={tCommon('delete')}
        cancelLabel={tCommon('cancel')}
      />
    </div>
  );
}
