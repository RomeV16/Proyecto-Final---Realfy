'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AuthResponse } from '@realfy/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { apiClient, ApiRequestError, setStoredUser } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { PasswordFields, validateNewPassword, type PasswordErrors } from './password-fields';
import { AuthNotice } from './auth-notice';

const ERROR_KEYS: Record<string, 'NOT_FOUND' | 'EXPIRED' | 'USED'> = {
  INVITATION_NOT_FOUND: 'NOT_FOUND',
  INVITATION_EXPIRED: 'EXPIRED',
  INVITATION_ALREADY_ACCEPTED: 'USED',
};

/** Pantalla pública a la que llega quien recibió el enlace de invitación. */
export function AcceptInvitationForm({ token }: { token: string | null }) {
  const t = useTranslations('auth.acceptInvitation');
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [nameErrors, setNameErrors] = useState<{ firstName?: boolean; lastName?: boolean }>({});
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="space-y-5">
        <h1 className="h1">{t('title')}</h1>
        <AuthNotice tone="danger">{t('missingToken')}</AuthNotice>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const names = { firstName: !firstName.trim(), lastName: !lastName.trim() };
    const pw = validateNewPassword(password, confirm);
    setNameErrors(names);
    setPasswordErrors(pw);
    if (names.firstName || names.lastName || pw.password || pw.confirm) return;

    setLoading(true);
    let email: string;
    try {
      const created = await apiClient<{ email: string }>('/users/accept-invitation', {
        method: 'POST',
        body: JSON.stringify({
          token,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      });
      email = created.email;
    } catch (err) {
      const key = err instanceof ApiRequestError ? ERROR_KEYS[err.errorCode] : undefined;
      setError(key ? t(key) : t('error'));
      setLoading(false);
      return;
    }

    try {
      const session = await apiClient<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredUser(session.user);
      router.push('/');
    } catch {
      setError(t('loginFailed'));
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-9">
        <h1 className="h1">{t('title')}</h1>
        <p className="lead mt-3 text-base">{t('subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AuthNotice tone="danger">{error}</AuthNotice>}
        <Input
          id="accept-firstName"
          label={t('firstName')}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          error={nameErrors.firstName ? t('firstNameRequired') : undefined}
          autoComplete="given-name"
          autoFocus
        />
        <Input
          id="accept-lastName"
          label={t('lastName')}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          error={nameErrors.lastName ? t('lastNameRequired') : undefined}
          autoComplete="family-name"
        />
        <PasswordFields
          idPrefix="accept"
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          errors={passwordErrors}
          passwordLabel={t('password')}
          confirmLabel={t('confirmPassword')}
        />
        <Button type="submit" size="lg" disabled={loading} className="w-full mt-2">
          {loading && <Spinner className="w-4 h-4 text-white" />}
          {loading ? t('submitting') : t('submit')}
        </Button>
      </form>
      <p className="mt-8 text-sm text-[var(--color-muted)]">
        <Link href="/auth/login" className="link-underline font-medium text-[var(--color-text)]">
          {t('loginLink')}
        </Link>
      </p>
    </div>
  );
}
