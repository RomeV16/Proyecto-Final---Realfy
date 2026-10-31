'use client';

import { useTranslations } from 'next-intl';
import { AcceptInvitationFormSchema, type AuthResponse } from '@realfy/shared';
import { Link, useRouter } from '@/i18n/navigation';
import { apiClient, setStoredUser } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { PasswordFields } from './password-fields';

const INITIAL = { firstName: '', lastName: '', password: '', confirmPassword: '' };

/** Pantalla pública a la que llega quien recibió el enlace de invitación. */
export function AcceptInvitationForm({ token }: { token: string | null }) {
  const t = useTranslations('auth.acceptInvitation');
  const router = useRouter();
  const { values, set, errors, formError, setFormError, submitting, submit } = useZodForm({
    schema: AcceptInvitationFormSchema,
    initialValues: INITIAL,
    translate: useSchemaMessages(),
  });

  if (!token) {
    return (
      <div className="space-y-5">
        <h1 className="h1">{t('title')}</h1>
        <ErrorNotice error={null} fallback={t('missingToken')} />
      </div>
    );
  }

  const handleSubmit = submit(async (data) => {
    const created = await apiClient<{ email: string }>('/users/accept-invitation', {
      method: 'POST',
      body: JSON.stringify({
        token,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
      }),
    });
    try {
      const session = await apiClient<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: created.email, password: data.password }),
      });
      setStoredUser(session.user);
      router.push('/');
    } catch {
      // La cuenta ya existe: solo falló el ingreso automático.
      setFormError(t('loginFailed'));
    }
  });

  return (
    <div>
      <div className="mb-9">
        <h1 className="h1">{t('title')}</h1>
        <p className="lead mt-3 text-base">{t('subtitle')}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {formError != null && (
          <ErrorNotice error={formError} fallback={typeof formError === 'string' ? undefined : t('error')} />
        )}
        <FormField label={t('firstName')} error={errors.firstName} required>
          {(c) => (
            <Input {...c} value={values.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="given-name" autoFocus />
          )}
        </FormField>
        <FormField label={t('lastName')} error={errors.lastName} required>
          {(c) => (
            <Input {...c} value={values.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="family-name" />
          )}
        </FormField>
        <PasswordFields
          password={values.password}
          confirm={values.confirmPassword}
          onPassword={(v) => set('password', v)}
          onConfirm={(v) => set('confirmPassword', v)}
          passwordError={errors.password}
          confirmError={errors.confirmPassword}
          passwordLabel={t('password')}
          confirmLabel={t('confirmPassword')}
        />
        <Button type="submit" size="lg" disabled={submitting} className="w-full mt-2">
          {submitting && <Spinner className="w-4 h-4 text-white" />}
          {submitting ? t('submitting') : t('submit')}
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
