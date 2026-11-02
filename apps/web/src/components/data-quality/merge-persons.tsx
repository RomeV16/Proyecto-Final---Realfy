'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { MergePersonsPlan, MergePersonsPlanItem, MergePersonsResult } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirm-dialog';

export interface MergeMember {
  id: string;
  label: string;
}

const KNOWN_ENTITIES = new Set([
  'personBankAccount', 'personDocument', 'lead', 'contractLessor', 'powerOfAttorney', 'propertyOwnership',
  'pendingCharge', 'ticket', 'ticketComment', 'portalRefreshToken', 'portalInvitation', 'personRoleAssignment',
  'contractPerson', 'ownerRendicion', 'tenantScore', 'providerProfile', 'inquilinoCredential',
  'cashMovement', 'compensation', 'financialAccount', 'ownerLedgerEntry', 'ownerStatement',
]);

/** Lo que se mueve y lo que se descarta, por tabla, agrupado para que lo lea una persona. */
function PlanList({ title, items }: { title: string; items: MergePersonsPlanItem[] }) {
  const t = useTranslations('dataQuality.plan');
  if (items.length === 0) return null;
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.entity, (totals.get(item.entity) ?? 0) + item.count);
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-[var(--color-muted)]">
        {[...totals.entries()].map(([entity, count]) => (
          <li key={entity}>
            {t(KNOWN_ENTITIES.has(entity) ? (entity as 'lead') : 'other')}: {count}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Unir personas repetidas: elegir a quién se conserva, ver qué se mueve y
 * confirmar. La API calcula la vista previa con las mismas reglas con las que
 * después une, así que lo que se muestra es lo que va a pasar.
 */
export function MergePersonsDialog({
  members,
  open,
  onClose,
  onMerged,
}: {
  members: MergeMember[];
  open: boolean;
  onClose: () => void;
  onMerged: () => void;
}) {
  const t = useTranslations('dataQuality.merge');
  const confirm = useConfirm();
  const [keepId, setKeepId] = useState<string>(members[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  function fail(err: unknown) {
    if (err instanceof ApiRequestError && err.errorCode === 'MERGE_CONFLICT') {
      const conflicts = (err.body?.conflicts ?? []) as MergePersonsPlanItem[];
      const entities = [...new Set(conflicts.map((c) => c.entity))].join(', ');
      toast.error(t('conflict', { entities }));
    } else {
      toast.error(err instanceof ApiRequestError ? err.message : t('error'));
    }
  }

  async function review() {
    const mergeIds = members.map((m) => m.id).filter((id) => id !== keepId);
    const payload = JSON.stringify({ keepId, mergeIds });
    setBusy(true);
    try {
      const plan = await apiClient<MergePersonsPlan>('/data-quality/persons/merge/preview', {
        method: 'POST',
        body: payload,
      });
      onClose();
      const keep = members.find((m) => m.id === keepId)!;
      const ok = await confirm({
        title: t('confirmTitle'),
        confirmLabel: t('confirmLabel'),
        tone: 'danger',
        body: (
          <div className="space-y-3">
            <p>{t('confirmBody', { keep: keep.label, count: mergeIds.length })}</p>
            <PlanList title={t('moves')} items={plan.items} />
            <PlanList title={t('discards')} items={plan.discarded} />
            {plan.items.length === 0 && plan.discarded.length === 0 && <p>{t('nothing')}</p>}
            <p className="text-xs text-[var(--color-muted)]">{t('undo')}</p>
          </div>
        ),
      });
      if (!ok) return;
      await apiClient<MergePersonsResult>('/data-quality/persons/merge', { method: 'POST', body: payload });
      toast.success(t('done'));
      onMerged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} busy={busy} initialFocusRef={firstRef} size="md">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
      </DialogHeader>
      <DialogBody>
        <p className="mb-3 text-sm text-[var(--color-muted)]">{t('intro')}</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">{t('keep')}</legend>
          {members.map((m, i) => (
            <label key={m.id} className="flex items-center gap-2 text-sm">
              <input
                ref={i === 0 ? firstRef : undefined}
                type="radio"
                name="keep-person"
                className="h-4 w-4 accent-[var(--color-brand-500)]"
                checked={keepId === m.id}
                onChange={() => setKeepId(m.id)}
              />
              <span>
                {t('keep')}: <strong>{m.label}</strong>
              </span>
            </label>
          ))}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('cancel')}
        </Button>
        <Button onClick={() => void review()} disabled={busy || !keepId}>
          {busy && <Spinner className="h-4 w-4" />}
          {busy ? t('loadingPlan') : t('continue')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
