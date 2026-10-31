'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordFields, validateNewPassword, type PasswordErrors } from './password-fields';

/** Cambio de contraseña desde el perfil: pide la actual y cierra las sesiones de otros dispositivos. */
export function ChangePasswordForm() {
  const t = useTranslations('perfil.password');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentError, setCurrentError] = useState('');
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError('');
    const found = validateNewPassword(password, confirm);
    const missingCurrent = !current;
    setErrors(found);
    setCurrentError(missingCurrent ? t('currentRequired') : '');
    if (missingCurrent || found.password || found.confirm) return;

    setSaving(true);
    try {
      await apiClient('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: password }),
      });
      setCurrent('');
      setPassword('');
      setConfirm('');
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiRequestError && err.errorCode === 'INVALID_CURRENT_PASSWORD') {
        setCurrentError(t('wrongCurrent'));
      } else {
        setError(t('error'));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-base font-semibold text-slate-900">{t('title')}</h2>
      <p className="mt-1 mb-5 text-sm text-slate-500">{t('subtitle')}</p>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Input
          id="current-password"
          type="password"
          label={t('current')}
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            setSaved(false);
          }}
          error={currentError || undefined}
          autoComplete="current-password"
          disabled={saving}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PasswordFields
            idPrefix="profile"
            password={password}
            confirm={confirm}
            onPassword={setPassword}
            onConfirm={setConfirm}
            errors={errors}
            passwordLabel={t('new')}
            confirmLabel={t('confirm')}
            disabled={saving}
          />
        </div>
        {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
        {saved && (
          <p role="status" className="text-sm text-emerald-600">
            {t('saved')}
          </p>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? t('saving') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
