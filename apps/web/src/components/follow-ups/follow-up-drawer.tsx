'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { KINDS, OUTCOMES, type FollowUp } from '@/lib/follow-ups';
import { useCan } from '@/lib/permissions';
import { useOptionalAuth } from '@/lib/auth-context';
import { toast } from '@/lib/toast';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DateText } from '@/components/ui/date-text';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Textarea } from '@/components/ui/textarea';

interface StaffOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  followUp: FollowUp;
  onClose: () => void;
  /** Recibe el seguimiento actualizado para refrescar la lista. */
  onChanged: (updated: FollowUp) => void;
}

/** Texto de un paso del checklist: la traducción por tipo y código, o la etiqueta que guardó la API. */
export function useTaskLabel() {
  const t = useTranslations('followUps');
  return (kind: string, code: string, fallback: string) => (t.has(`tasks.${kind}.${code}`) ? t(`tasks.${kind}.${code}`) : fallback);
}

/**
 * Seguimiento de un vencimiento: el checklist para marcar, el responsable, el tipo (renovación o devolución),
 * las notas y el resultado con el que se cierra.
 */
export function FollowUpDrawer({ followUp, onClose, onChanged }: Props) {
  const t = useTranslations('followUps');
  const tCommon = useTranslations('common');
  const taskLabel = useTaskLabel();
  const canManage = useCan('followUps.manage');
  const canListUsers = useCan('users.view');
  const user = useOptionalAuth()?.user ?? null;
  const [current, setCurrent] = useState(followUp);
  const [notes, setNotes] = useState(followUp.notes ?? '');
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const closed = current.status === 'Cerrado';

  useEffect(() => {
    if (!canListUsers) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiClient<{ items: StaffOption[] }>('/users');
        if (!cancelled) setStaff(res?.items ?? []);
      } catch {
        if (!cancelled) setStaff([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canListUsers]);

  async function send(path: string, body: Record<string, unknown>, success?: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await apiClient<FollowUp>(`/follow-ups/${current.id}${path}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setCurrent(updated);
      setNotes(updated.notes ?? '');
      onChanged(updated);
      if (success) toast.success(success);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const options = [...staff];
  if (user && !options.some((s) => s.id === user.id)) {
    options.unshift({ id: user.id, firstName: user.firstName, lastName: user.lastName });
  }
  const assignee = current.assigneeId ?? '';

  return (
    <Dialog open onClose={onClose} busy={busy} size="lg">
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--color-text)]">{current.property ?? t('drawer.contract')}</h2>
          {current.light && <StatusBadge domain="vencimiento" status={current.light} />}
        </div>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          {current.tenantName ?? '—'} · {t('drawer.endsOn')} <DateText value={current.effectiveEnd} />
          {current.effectiveEnd !== current.signedEnd && (
            <>
              {' '}
              ({t('drawer.signedEnd')} <DateText value={current.signedEnd} />)
            </>
          )}
        </p>
      </DialogHeader>
      <DialogBody className="space-y-5">
        {error != null && <ErrorNotice error={error} fallback={t('actionError')} />}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField label={t('drawer.assignee')}>
            {(c) => (
              <Select
                {...c}
                value={assignee}
                disabled={busy || closed || !canManage}
                onChange={(e) => void send('', { assigneeId: e.target.value || null }, t('drawer.assigned'))}
              >
                <option value="">{t('drawer.unassigned')}</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>
                    {`${s.firstName} ${s.lastName}`.trim()}
                    {s.id === user?.id ? ` (${t('drawer.me')})` : ''}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t('drawer.kind')}>
            {(c) => (
              <Select
                {...c}
                value={current.kind}
                disabled={busy || closed || !canManage}
                onChange={(e) => void send('', { kind: e.target.value }, t('drawer.kindChanged'))}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`kinds.${kind}`)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold text-[var(--color-text)]">
            {t('drawer.checklist')}{' '}
            <span className="font-normal text-[var(--color-muted)]">
              ({current.progress.done}/{current.progress.total})
            </span>
          </legend>
          <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {current.tasks.map((task) => (
              <li key={task.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={task.done}
                    disabled={busy || closed || !canManage}
                    onChange={(e) => void send(`/tasks/${task.id}`, { done: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <span className={task.done ? 'text-[var(--color-muted)] line-through' : 'text-[var(--color-text)]'}>
                    {taskLabel(current.kind, task.code, task.label)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <FormField label={t('drawer.notes')}>
          {(c) => (
            <Textarea {...c} rows={3} value={notes} disabled={busy || !canManage} onChange={(e) => setNotes(e.target.value)} />
          )}
        </FormField>
        {canManage && notes !== (current.notes ?? '') && (
          <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void send('', { notes: notes.trim() || null }, t('drawer.notesSaved'))}>
            {t('drawer.saveNotes')}
          </Button>
        )}

        <FormField label={t('drawer.outcome')} hint={t('drawer.outcomeHint')}>
          {(c) => (
            <Select
              {...c}
              value={current.outcome}
              disabled={busy || !canManage}
              onChange={(e) => void send('', { outcome: e.target.value }, t('drawer.outcomeSaved'))}
            >
              {OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {t(`outcomes.${outcome}`)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Link href={`/contracts/${current.contractId}`} className="mr-auto text-sm font-medium text-[var(--color-brand)] hover:underline">
          {t('drawer.openContract')}
        </Link>
        <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
          {tCommon('close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
