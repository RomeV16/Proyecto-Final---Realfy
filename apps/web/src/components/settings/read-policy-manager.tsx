'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_READ_POLICY, READ_RESOURCES, UserRole, type ReadPolicy, type ReadResource } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { invalidateReadAccess } from '@/lib/read-access';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { useRoleLabel } from '@/components/users/role-select';

const ROLES = Object.values(UserRole) as UserRole[];

/** Las claves de i18n no admiten puntos: `persons.bankAccounts` es `persons_bankAccounts`. */
const resourceKey = (resource: ReadResource) => resource.replace('.', '_');

function samePolicy(a: ReadPolicy, b: ReadPolicy): boolean {
  return READ_RESOURCES.every((r) => ROLES.every((role) => a[r].includes(role) === b[r].includes(role)));
}

/** Configuración → Permisos: qué roles leen cada recurso sensible (solo el Admin la cambia). */
export function ReadPolicyManager() {
  const t = useTranslations('permissions');
  const roleLabel = useRoleLabel();
  const confirm = useConfirm();
  const canManage = useCan('permissions.manage');

  const [saved, setSaved] = useState<ReadPolicy | null>(null);
  const [draft, setDraft] = useState<ReadPolicy | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const policy = await apiClient<ReadPolicy>('/tenants/me/read-policy');
      setSaved(policy);
      setDraft(policy);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }, []);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  if (!canManage) {
    return <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>;
  }

  const dirty = saved !== null && draft !== null && !samePolicy(saved, draft);

  function toggle(resource: ReadResource, role: UserRole) {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev[resource].includes(role);
      const roles = has ? prev[resource].filter((r) => r !== role) : [...prev[resource], role];
      return { ...prev, [resource]: roles };
    });
  }

  async function save() {
    if (!draft) return;
    const ok = await confirm({
      title: t('confirm.title'),
      body: t('confirm.body'),
      confirmLabel: t('confirm.confirm'),
    });
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      const policy = await apiClient<ReadPolicy>('/tenants/me/read-policy', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      setSaved(policy);
      setDraft(policy);
      invalidateReadAccess();
      toast.success(t('saved'));
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function openAll() {
    const ok = await confirm({
      title: t('confirm.resetTitle'),
      body: t('confirm.resetBody'),
      confirmLabel: t('confirm.resetConfirm'),
    });
    if (ok) setDraft(DEFAULT_READ_POLICY);
  }

  const columns: DataTableColumn<ReadResource>[] = [
    {
      key: 'resource',
      header: t('table.resource'),
      render: (resource) => (
        <div>
          <p className="font-medium text-[var(--color-text)]">{t(`resources.${resourceKey(resource)}.label`)}</p>
          <p className="text-xs text-[var(--color-muted)]">{t(`resources.${resourceKey(resource)}.hint`)}</p>
        </div>
      ),
    },
    ...ROLES.map<DataTableColumn<ReadResource>>((role) => ({
      key: role,
      header: roleLabel(role),
      render: (resource) => (
        <input
          type="checkbox"
          checked={draft?.[resource].includes(role) ?? false}
          disabled={busy || role === UserRole.Admin}
          onChange={() => toggle(resource, role)}
          title={role === UserRole.Admin ? t('table.adminLocked') : undefined}
          aria-label={`${t(`resources.${resourceKey(resource)}.label`)} — ${roleLabel(role)}`}
          className="h-4 w-4 rounded border-[var(--color-border)] text-brand-500 focus:ring-2 focus:ring-brand-400/50"
        />
      ),
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={openAll} disabled={busy || draft === null}>
            {t('reset')}
          </Button>
          <Button onClick={save} disabled={!dirty || busy}>
            {busy ? t('saving') : t('save')}
          </Button>
        </div>
      </div>

      {dirty && <p className="text-sm text-[var(--color-muted)]">{t('dirty')}</p>}
      {actionError != null && <ErrorNotice error={actionError} />}

      <DataTable
        items={[...READ_RESOURCES]}
        columns={columns}
        keyExtractor={(resource) => resource}
        loading={draft === null && loadError == null}
        error={loadError}
        empty={{ title: t('loadError') }}
      />
    </div>
  );
}
