'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { TeamMember } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { RoleSelect } from './role-select';
import { memberName } from './member-name';

interface RoleDialogProps {
  member: TeamMember | null;
  onClose: () => void;
  onSaved: () => void;
}

export function RoleDialog({ member, onClose, onSaved }: RoleDialogProps) {
  const t = useTranslations('users.roleDialog');
  const tCommon = useTranslations('common');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setRole(member?.role ?? '');
    setError(null);
  }, [member]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient(`/users/${member.id}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={member !== null} onClose={onClose} busy={saving}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <RoleSelect
            label={member ? t('body', { name: memberName(member) }) : ''}
            value={role}
            onChange={setRole}
            disabled={saving}
          />
          {error != null && <ErrorNotice error={error} fallback={t('error')} />}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={saving || !member || role === member.role}>
            {t('submit')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
