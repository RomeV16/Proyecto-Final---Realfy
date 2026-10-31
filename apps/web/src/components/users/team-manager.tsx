'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ShareableLink, TeamMember, UserStatus } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { useOptionalAuth } from '@/lib/auth-context';
import { formatDate, formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';
import { InviteDialog } from './invite-dialog';
import { memberName } from './member-name';
import { RoleDialog } from './role-dialog';
import { useRoleLabel } from './role-select';
import { ShareLinkDialog, type SharedLink } from './share-link-dialog';
import { useActionError } from './use-action-error';

const STATUS_VARIANT: Record<UserStatus, 'info' | 'success' | 'neutral'> = {
  invited: 'info',
  active: 'success',
  inactive: 'neutral',
};

/** Equipo de la inmobiliaria: lista con estado y, para el Admin, las acciones de alta, rol, baja y enlaces. */
export function TeamManager() {
  const t = useTranslations('users');
  const locale = useLocale();
  const roleLabel = useRoleLabel();
  const actionError = useActionError();
  const confirm = useConfirm();
  const canManage = useCan('users.manage');
  const canView = useCan('users.view');
  const currentUserId = useOptionalAuth()?.user?.id;

  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleTarget, setRoleTarget] = useState<TeamMember | null>(null);
  const [shared, setShared] = useState<SharedLink | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers(await apiClient<TeamMember[]>('/users'));
      setLoadError(false);
    } catch {
      setLoadError(true);
      setMembers((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load]);

  /** Corre una acción del Admin: avisa el resultado, recarga la lista y devuelve lo que respondió la API. */
  async function run<T>(path: string, init: RequestInit, success?: string): Promise<T | null> {
    try {
      const result = await apiClient<T>(path, init);
      if (success) toast.success(success);
      await load();
      return result;
    } catch (err) {
      toast.error(actionError(err));
      return null;
    }
  }

  async function toggleActive(member: TeamMember) {
    const deactivating = member.status === 'active';
    const key = deactivating ? 'deactivate' : 'reactivate';
    const ok = await confirm({
      title: t(`confirm.${key}Title`),
      body: t(`confirm.${key}Body`, { name: memberName(member) }),
      confirmLabel: t(`confirm.${key}Confirm`),
      tone: deactivating ? 'danger' : 'default',
    });
    if (!ok) return;
    await run(`/users/${member.id}/${key}`, { method: 'POST' }, t(`confirm.${deactivating ? 'deactivated' : 'reactivated'}`));
  }

  async function share(kind: SharedLink['kind'], member: TeamMember) {
    const path = kind === 'invitation' ? `/users/${member.id}/invitation/resend` : `/users/${member.id}/password-reset-link`;
    const data = await run<ShareableLink>(path, { method: 'POST' });
    if (data) setShared({ kind, data });
  }

  if (!canView) {
    return <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>;
  }

  const columns: Column<TeamMember>[] = [
    {
      key: 'name',
      header: t('table.name'),
      render: (m) => (
        <span className="font-medium text-[var(--color-text)]">
          {m.status === 'invited' ? t('pendingName') : memberName(m)}
        </span>
      ),
    },
    { key: 'email', header: t('table.email'), render: (m) => m.email },
    { key: 'role', header: t('table.role'), render: (m) => roleLabel(m.role) },
    {
      key: 'status',
      header: t('table.status'),
      render: (m) => (
        <Badge variant={m.invitationExpired ? 'warning' : STATUS_VARIANT[m.status]} dot>
          {m.invitationExpired ? t('invitationExpired') : t(`status.${m.status}`)}
        </Badge>
      ),
    },
    {
      key: 'lastLogin',
      header: t('table.lastLogin'),
      render: (m) => {
        if (m.status === 'invited') {
          return t('invitationExpires', { date: formatDate(m.invitationExpiresAt, undefined, locale) });
        }
        return m.lastLoginAt ? formatDateTime(m.lastLoginAt, undefined, locale) : t('neverLoggedIn');
      },
    },
  ];

  if (canManage) {
    columns.push({
      key: 'actions',
      header: t('table.actions'),
      render: (m) => (
        <div className="flex flex-wrap gap-1.5">
          {m.status === 'invited' ? (
            <Button size="sm" variant="secondary" onClick={() => share('invitation', m)}>
              {t('actions.resendInvitation')}
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setRoleTarget(m)}>
                {t('actions.changeRole')}
              </Button>
              {m.status === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => share('reset', m)}>
                  {t('actions.resetLink')}
                </Button>
              )}
              {m.id !== currentUserId && (
                <Button size="sm" variant="ghost" onClick={() => toggleActive(m)}>
                  {m.status === 'active' ? t('actions.deactivate') : t('actions.activate')}
                </Button>
              )}
            </>
          )}
        </div>
      ),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
        </div>
        {canManage && <Button onClick={() => setInviteOpen(true)}>{t('invite')}</Button>}
      </div>

      {!canManage && <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>}
      {loadError && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {t('loadError')}
        </p>
      )}

      <ResponsiveTable
        items={members ?? []}
        columns={columns}
        keyExtractor={(m) => m.id}
        loading={members === null}
        empty={{ title: t('noUsers') }}
      />

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={(data) => {
          setInviteOpen(false);
          toast.success(t('modal.success'));
          setShared({ kind: 'invitation', data });
          void load();
        }}
      />
      <RoleDialog
        member={roleTarget}
        onClose={() => setRoleTarget(null)}
        onSaved={() => {
          setRoleTarget(null);
          toast.success(t('roleDialog.success'));
          void load();
        }}
      />
      <ShareLinkDialog shared={shared} onClose={() => setShared(null)} />
    </div>
  );
}
