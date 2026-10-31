'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { PasswordFields, validateNewPassword, type PasswordErrors } from './password-fields';
import { AuthNotice } from './auth-notice';

const ERROR_KEYS: Record<string, 'INVALID' | 'USED' | 'EXPIRED'> = {
  PASSWORD_RESET_INVALID: 'INVALID',
  PASSWORD_RESET_USED: 'USED',
  PASSWORD_RESET_EXPIRED: 'EXPIRED',
};

const BACK_LINK = 'link-underline font-medium text-[var(--color-text)]';

/** Pedido de instrucciones por correo: la respuesta es siempre la misma, exista o no la cuenta. */
function ForgotPasswordForm() {
  const t = useTranslations('auth.forgot');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const value = email.trim();
    if (!value || !/^\S+@\S+\.\S+$/.test(value)) {
      setEmailError(value ? 'invalid' : 'required');
      return;
    }
    setEmailError('');
    setLoading(true);
    try {
      await apiClient('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email: value }),
      });
      setSent(true);
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-9">
        <h1 className="h1">{t('title')}</h1>
        <p className="lead mt-3 text-base">{t('subtitle')}</p>
      </div>
      {sent ? (
        <AuthNotice tone="success">{t('sent')}</AuthNotice>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {error && <AuthNotice tone="danger">{error}</AuthNotice>}
          <Input
            id="forgot-email"
            type="email"
            label={t('email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError ? (emailError === 'required' ? t('emailRequired') : t('emailInvalid')) : undefined}
            autoComplete="email"
            autoFocus
          />
          <Button type="submit" size="lg" disabled={loading} className="w-full mt-2">
            {loading && <Spinner className="w-4 h-4 text-white" />}
            {loading ? t('sending') : t('submit')}
          </Button>
        </form>
      )}
      <p className="mt-8 text-sm text-[var(--color-muted)]">
        <Link href="/auth/login" className={BACK_LINK}>
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  );
}

function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth.passwordReset');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const found = validateNewPassword(password, confirm);
    setErrors(found);
    if (found.password || found.confirm) return;

    setLoading(true);
    try {
      await apiClient('/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
    } catch (err) {
      const key = err instanceof ApiRequestError ? ERROR_KEYS[err.errorCode] : undefined;
      setError(key ? t(key) : t('error'));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-6">
        <h1 className="h1">{t('title')}</h1>
        <AuthNotice tone="success">{t('success')}</AuthNotice>
        <Link href="/auth/login" className={BACK_LINK}>
          {t('loginLink')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-9">
        <h1 className="h1">{t('title')}</h1>
        <p className="lead mt-3 text-base">{t('subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && <AuthNotice tone="danger">{error}</AuthNotice>}
        <PasswordFields
          idPrefix="reset"
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          errors={errors}
          passwordLabel={t('password')}
          confirmLabel={t('confirmPassword')}
        />
        <Button type="submit" size="lg" disabled={loading} className="w-full mt-2">
          {loading && <Spinner className="w-4 h-4 text-white" />}
          {loading ? t('submitting') : t('submit')}
        </Button>
      </form>
    </div>
  );
}

/** `/auth/password-reset`: con `?token=` elige la contraseña nueva; sin token pide las instrucciones. */
export function PasswordResetForm({ token }: { token: string | null }) {
  return token ? <ResetPasswordForm token={token} /> : <ForgotPasswordForm />;
}
