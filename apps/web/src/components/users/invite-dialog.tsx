'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserRole, type ShareableLink } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { RoleSelect } from './role-select';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (link: ShareableLink) => void;
}

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function InviteDialog({ open, onClose, onCreated }: InviteDialogProps) {
  const t = useTranslations('users.modal');
  const tCommon = useTranslations('common');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>(UserRole.Ventas);
  const [emailError, setEmailError] = useState('');
  const [roleError, setRoleError] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setEmail('');
    setRole(UserRole.Ventas);
    setEmailError('');
    setRoleError('');
    setError('');
  }

  function close() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const value = email.trim();
    const emailProblem = !value ? t('emailRequired') : EMAIL_RE.test(value) ? '' : t('emailInvalid');
    const roleProblem = role ? '' : t('roleRequired');
    setEmailError(emailProblem);
    setRoleError(roleProblem);
    if (emailProblem || roleProblem) return;

    setSaving(true);
    try {
      const link = await apiClient<ShareableLink>('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: value, role }),
      });
      reset();
      onCreated(link);
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.errorCode : '';
      setError(
        code === 'USER_ALREADY_EXISTS' || code === 'INVITATION_ALREADY_PENDING'
          ? t(code)
          : t('error'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} busy={saving}>
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Input
            id="invite-email"
            type="email"
            label={t('email')}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError || undefined}
            autoComplete="off"
            disabled={saving}
          />
          <RoleSelect
            id="invite-role"
            label={t('role')}
            placeholder={t('rolePlaceholder')}
            value={role}
            onChange={setRole}
            error={roleError || undefined}
            disabled={saving}
          />
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={saving}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
