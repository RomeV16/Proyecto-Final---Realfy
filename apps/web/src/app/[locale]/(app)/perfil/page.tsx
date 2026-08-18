'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { UserRole } from '@realfy/shared';
import { useAuth } from '@/lib/auth-context';
import { apiClient } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface UpdatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
}

/**
 * Los rótulos de rol viven en `users.roles`, que es la misma fuente que usa la
 * pantalla de usuarios. Se valida contra el enum antes de traducir para que un
 * valor inesperado se muestre tal cual en lugar de romper la clave.
 */
const KNOWN_ROLES = Object.values(UserRole) as string[];

export default function PerfilPage() {
  const t = useTranslations('perfil');
  const tRoles = useTranslations('users.roles');
  const { user, updateUser } = useAuth();

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Auth context hydrates from storage after mount — sync fields once the user loads.
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const dirty =
    firstName.trim() !== (user?.firstName ?? '') ||
    lastName.trim() !== (user?.lastName ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError(t('nameRequired'));
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const updated = await apiClient<UpdatedUser>('/users/me', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });
      updateUser({
        firstName: updated.firstName,
        lastName: updated.lastName,
      });
      setSaved(true);
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  const initials = user
    ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
    : '';

  const roleLabel = user
    ? KNOWN_ROLES.includes(user.role)
      ? tRoles(user.role)
      : user.role
    : '';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle')}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-4 pb-6 mb-6 border-b border-slate-100">
          <div className="w-14 h-14 rounded-full bg-brand-500 flex items-center justify-center text-white text-lg font-semibold">
            {initials}
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">
              {user ? `${user.firstName} ${user.lastName}` : ''}
            </p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('firstName')}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value);
                setSaved(false);
              }}
              disabled={saving}
            />
            <Input
              label={t('lastName')}
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value);
                setSaved(false);
              }}
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('email')} value={user?.email ?? ''} disabled readOnly />
            <Input label={t('role')} value={roleLabel} disabled readOnly />
          </div>

          {error && (
            <p className="text-sm text-[var(--color-danger)]">{error}</p>
          )}
          {saved && (
            <p className="text-sm text-emerald-600">{t('saved')}</p>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
