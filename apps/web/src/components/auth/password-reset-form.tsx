'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PasswordResetFormSchema, PasswordResetRequestSchema } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { PasswordFields } from './password-fields';
import { AuthSuccess } from './auth-notice';

const BACK_LINK = 'link-underline font-medium text-[var(--color-text)]';

/** Pedido de instrucciones por correo: la respuesta es siempre la misma, exista o no la cuenta. */
function ForgotPasswordForm() {
  const t = useTranslations('auth.forgot');
  const [sent, setSent] = useState(false);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: PasswordResetRequestSchema,
    initialValues: { email: '' },
    translate: useSchemaMessages(),
  });

  const handleSubmit = submit(async (data) => {
    await apiClient('/auth/password-reset/request', { method: 'POST', body: JSON.stringify(data) });
    setSent(true);
  });

  return (
    <div>
      <div className="mb-9">
        <h1 className="h1">{t('title')}</h1>
        <p className="lead mt-3 text-base">{t('subtitle')}</p>
      </div>
      {sent ? (
        <AuthSuccess>{t('sent')}</AuthSuccess>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
          <FormField label={t('email')} error={errors.email} required>
            {(c) => (
              <Input {...c} type="email" value={values.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" autoFocus />
            )}
          </FormField>
          <Button type="submit" size="lg" disabled={submitting} className="w-full mt-2">
            {submitting && <Spinner className="w-4 h-4 text-white" />}
            {submitting ? t('sending') : t('submit')}
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
  const [done, setDone] = useState(false);
  const { values, set, errors, formError, submitting, submit } = useZodForm({
    schema: PasswordResetFormSchema,
    initialValues: { newPassword: '', confirmPassword: '' },
    translate: useSchemaMessages(),
  });

  const handleSubmit = submit(async (data) => {
    await apiClient('/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword: data.newPassword }),
    });
    setDone(true);
  });

  if (done) {
    return (
      <div className="space-y-6">
        <h1 className="h1">{t('title')}</h1>
        <AuthSuccess>{t('success')}</AuthSuccess>
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
        {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
        <PasswordFields
          password={values.newPassword}
          confirm={values.confirmPassword}
          onPassword={(v) => set('newPassword', v)}
          onConfirm={(v) => set('confirmPassword', v)}
          passwordError={errors.newPassword}
          confirmError={errors.confirmPassword}
          passwordLabel={t('password')}
          confirmLabel={t('confirmPassword')}
        />
        <Button type="submit" size="lg" disabled={submitting} className="w-full mt-2">
          {submitting && <Spinner className="w-4 h-4 text-white" />}
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </form>
    </div>
  );
}

/** `/auth/password-reset`: con `?token=` elige la contraseña nueva; sin token pide las instrucciones. */
export function PasswordResetForm({ token }: { token: string | null }) {
  return token ? <ResetPasswordForm token={token} /> : <ForgotPasswordForm />;
}
