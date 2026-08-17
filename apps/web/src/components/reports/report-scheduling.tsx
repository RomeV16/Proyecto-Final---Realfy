'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';

/* ──────────── Types ──────────── */

interface ReportSchedule {
  id: string;
  reportType: string;
  frequency: string;
  recipients: string[];
  format: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface ReportSchedulingSectionProps {
  reportTypes: readonly string[];
}

const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
const FORMATS = ['excel', 'pdf'] as const;

const SELECT_CLASS =
  'h-11 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)]';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ──────────── Component ──────────── */

export function ReportSchedulingSection({ reportTypes }: ReportSchedulingSectionProps) {
  const t = useTranslations('reports.scheduling');
  const tTypes = useTranslations('reports.types');
  const tCommon = useTranslations('common');

  const [isOpen, setIsOpen] = useState(false);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formReportType, setFormReportType] = useState(reportTypes[0]);
  const [formFrequency, setFormFrequency] = useState<string>('monthly');
  const [formRecipients, setFormRecipients] = useState('');
  const [formFormat, setFormFormat] = useState<string>('excel');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient<ReportSchedule[]>('/report-schedules');
      setSchedules(Array.isArray(data) ? data : []);
    } catch {
      // Silently handle — section is optional
      setSchedules([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchSchedules();
    }
  }, [isOpen, fetchSchedules]);

  function resetForm() {
    setEditingId(null);
    setFormReportType(reportTypes[0]);
    setFormFrequency('monthly');
    setFormRecipients('');
    setFormFormat('excel');
    setFormActive(true);
    setFormError('');
  }

  function openCreateForm() {
    resetForm();
    setShowForm(true);
  }

  function openEditForm(schedule: ReportSchedule) {
    setEditingId(schedule.id);
    setFormReportType(schedule.reportType);
    setFormFrequency(schedule.frequency);
    setFormRecipients(schedule.recipients.join(', '));
    setFormFormat(schedule.format);
    setFormActive(schedule.isActive);
    setFormError('');
    setShowForm(true);
  }

  async function handleSubmit() {
    setFormError('');
    const recipients = formRecipients
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      setFormError(t('recipientsRequired'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        reportType: formReportType,
        frequency: formFrequency,
        recipients,
        format: formFormat,
      };
      if (editingId) {
        payload.isActive = formActive;
        await apiClient(`/report-schedules/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiClient('/report-schedules', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      resetForm();
      await fetchSchedules();
      toast.success(t('saved'));
    } catch {
      setFormError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    try {
      await apiClient(`/report-schedules/${id}`, { method: 'DELETE' });
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      if (editingId === id) {
        setShowForm(false);
        resetForm();
      }
      toast.success(t('deleted'));
    } catch {
      toast.error(t('deleteFailed'));
    }
  }

  return (
    <div className="rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between rounded-[var(--radius-2xl)] px-6 py-4 text-left transition-colors hover:bg-[var(--color-bg)]"
      >
        <div>
          <h2 className="h4">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <Icon
          name="chevronDown"
          className={cn('h-5 w-5 text-[var(--color-muted)] transition-transform duration-200', isOpen && 'rotate-180')}
          strokeWidth={2}
        />
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="space-y-4 border-t border-[var(--color-border)] px-6 pb-6">
          {/* Create button */}
          <div className="flex justify-end pt-4">
            <Button
              size="sm"
              onClick={() => (showForm ? setShowForm(false) : openCreateForm())}
            >
              <Icon name="plus" className="h-4 w-4" strokeWidth={2} />
              {t('create')}
            </Button>
          </div>

          {/* Create / edit form */}
          {showForm && (
            <div className="space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Report type */}
                <div className="flex flex-col gap-1">
                  <label className="text-[0.8rem] font-medium text-[var(--color-text)]">{t('reportType')}</label>
                  <select
                    value={formReportType}
                    onChange={(e) => setFormReportType(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {reportTypes.map((rt) => (
                      <option key={rt} value={rt}>{tTypes(rt)}</option>
                    ))}
                  </select>
                </div>

                {/* Frequency */}
                <div className="flex flex-col gap-1">
                  <label className="text-[0.8rem] font-medium text-[var(--color-text)]">{t('frequency')}</label>
                  <select
                    value={formFrequency}
                    onChange={(e) => setFormFrequency(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {FREQUENCIES.map((freq) => (
                      <option key={freq} value={freq}>{t(`frequencies.${freq}`)}</option>
                    ))}
                  </select>
                </div>

                {/* Format */}
                <div className="flex flex-col gap-1">
                  <span className="text-[0.8rem] font-medium text-[var(--color-text)]">{t('format')}</span>
                  <div className="flex h-11 items-center gap-4">
                    {FORMATS.map((fmt) => (
                      <label key={fmt} className="flex items-center gap-1.5 text-sm text-[var(--color-text)]">
                        <input
                          type="radio"
                          name="schedule-format"
                          value={fmt}
                          checked={formFormat === fmt}
                          onChange={(e) => setFormFormat(e.target.value)}
                          className="text-brand-500 focus:ring-brand-500"
                        />
                        {t(`formats.${fmt}`)}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Recipients */}
                <Input
                  label={t('recipients')}
                  value={formRecipients}
                  onChange={(e) => setFormRecipients(e.target.value)}
                  placeholder="cobranzas@inmobiliaria.com, gerencia@inmobiliaria.com"
                />

                {/* Active toggle — only meaningful when editing an existing schedule */}
                {editingId && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.8rem] font-medium text-[var(--color-text)]">{t('active')}</span>
                    <label className="flex h-11 items-center gap-2 text-sm text-[var(--color-text)]">
                      <input
                        type="checkbox"
                        checked={formActive}
                        onChange={(e) => setFormActive(e.target.checked)}
                        className="rounded border-[var(--color-border)] text-brand-500 focus:ring-brand-500"
                      />
                      {formActive ? t('active') : t('inactive')}
                    </label>
                  </div>
                )}
              </div>

              {formError && <p className="text-xs text-[var(--color-danger)]">{formError}</p>}

              <div className="flex gap-2">
                <Button size="sm" onClick={handleSubmit} disabled={saving}>
                  {editingId ? t('edit') : t('create')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setShowForm(false); resetForm(); }}
                >
                  {tCommon('cancel')}
                </Button>
              </div>
            </div>
          )}

          {/* Schedules list */}
          <RowList
            items={schedules}
            loading={loading && !loaded}
            busy={loading && loaded}
            skeletonCount={2}
            keyOf={(s) => s.id}
            empty={<EmptyState variant="filtered" iconName="calendarClock" title={t('noSchedules')} />}
            renderItem={(schedule) => {
              const nextRunLabel = schedule.nextRunAt
                ? `${t('nextRun')}: ${formatDate(schedule.nextRunAt)}`
                : null;
              return (
                <EntityRow
                  accent={schedule.isActive ? 'brand' : 'none'}
                  leading={
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-full"
                      style={{
                        backgroundColor: schedule.isActive
                          ? 'color-mix(in oklab, var(--color-brand-500) 14%, var(--color-surface))'
                          : 'var(--color-bg)',
                        color: schedule.isActive ? 'var(--color-brand-600)' : 'var(--color-muted)',
                      }}
                    >
                      <Icon name="calendarClock" className="h-4.5 w-4.5" strokeWidth={1.75} />
                    </span>
                  }
                  title={tTypes(schedule.reportType)}
                  subtitle={`${t(`frequencies.${schedule.frequency}`)} · ${t(`formats.${schedule.format}`)}${nextRunLabel ? ` · ${nextRunLabel}` : ''}`}
                  meta={
                    <EntityRow.Meta items={[{ icon: 'mail', label: schedule.recipients.join(', ') }]} />
                  }
                  trailing={
                    <Badge variant={schedule.isActive ? 'success' : 'neutral'} dot>
                      {schedule.isActive ? t('active') : t('inactive')}
                    </Badge>
                  }
                  actions={
                    <>
                      <EntityRow.Action onClick={() => openEditForm(schedule)} icon="edit" variant="quiet">
                        {t('edit')}
                      </EntityRow.Action>
                      <EntityRow.Action
                        onClick={() => handleDelete(schedule.id)}
                        variant="quiet"
                        className="hover:text-[var(--color-danger)]"
                      >
                        {t('delete')}
                      </EntityRow.Action>
                    </>
                  }
                />
              );
            }}
          />
        </div>
      )}
    </div>
  );
}
