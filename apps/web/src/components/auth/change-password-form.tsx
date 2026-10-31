'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChangePasswordFormSchema } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { PasswordFields } from './password-fields';

const INITIAL = { currentPassword: '', newPassword: '', confirmPassword: '' };

/** Cambio de contraseña desde el perfil: pide la actual y cierra las sesiones de otros dispositivos. */
export function ChangePasswordForm() {
  const t = useTranslations('perfil.password');
  const [saved, setSaved] = useState(false);
  const { values, set, setValues, errors, formError, submitting, submit } = useZodForm({
    schema: ChangePasswordFormSchema,
    initialValues: INITIAL,
    translate: useSchemaMessages(),
  });

  const handleSubmit = submit(async (data) => {
    setSaved(false);
    await apiClient('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
    });
    setValues(INITIAL);
    setSaved(true);
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <h2 className="text-base font-semibold text-slate-900">{t('title')}</h2>
      <p className="mt-1 mb-5 text-sm text-slate-500">{t('subtitle')}</p>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <FormField label={t('current')} error={errors.currentPassword} required>
          {(c) => (
            <Input
              {...c}
              type="password"
              value={values.currentPassword}
              onChange={(e) => {
                set('currentPassword', e.target.value);
                setSaved(false);
              }}
              autoComplete="current-password"
              disabled={submitting}
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PasswordFields
            password={values.newPassword}
            confirm={values.confirmPassword}
            onPassword={(v) => set('newPassword', v)}
            onConfirm={(v) => set('confirmPassword', v)}
            passwordError={errors.newPassword}
            confirmError={errors.confirmPassword}
            passwordLabel={t('new')}
            confirmLabel={t('confirm')}
            disabled={submitting}
          />
        </div>
        {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
        {saved && (
          <p role="status" className="text-sm text-emerald-600">
            {t('saved')}
          </p>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? t('saving') : t('submit')}
        </Button>
      </form>
    </div>
  );
}
