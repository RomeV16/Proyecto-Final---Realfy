'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { registerSchema } from '@realfy/shared/schemas';
import { apiClient, setStoredUser, ApiRequestError } from '@/lib/api-client';
import type { AuthResponse } from '@realfy/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

export default function RegisterPage() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    // Clear field error on change
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validate = () => {
    const result = registerSchema.safeParse({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      password: form.password,
      confirmPassword: form.confirmPassword,
    });

    if (result.success) {
      setErrors({});
      return true;
    }

    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as string;
      if (!fieldErrors[field]) {
        fieldErrors[field] = t(issue.message as Parameters<typeof t>[0]);
      }
    }

    setErrors(fieldErrors);
    return Object.keys(fieldErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');

    if (!validate()) return;

    setLoading(true);
    try {
      const res = await apiClient<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
        }),
      });

      setStoredUser(res.user);
      localStorage.setItem('user', JSON.stringify(res.user));

      // Redirect to onboarding (future) or dashboard
      router.push(`${localePrefix}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.errorCode === 'EMAIL_EXISTS') {
          setServerError(t('auth.register.emailExists'));
        } else {
          setServerError(t('auth.register.error'));
        }
      } else {
        setServerError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <p className="eyebrow mb-3">Creá tu cuenta</p>
        <h1 className="h1">{t('auth.register.title')}</h1>
        <p className="lead mt-3 text-base">
          Empezá a administrar tu cartera en minutos.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {serverError && (
          <div className="bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] text-sm rounded-lg px-4 py-3 border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]">
            {serverError}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Input
            id="firstName"
            label={t('auth.register.firstName')}
            value={form.firstName}
            onChange={handleChange('firstName')}
            error={errors.firstName}
            autoFocus
          />
          <Input
            id="lastName"
            label={t('auth.register.lastName')}
            value={form.lastName}
            onChange={handleChange('lastName')}
            error={errors.lastName}
          />
        </div>

        <Input
          id="email"
          type="email"
          label={t('auth.register.email')}
          value={form.email}
          onChange={handleChange('email')}
          error={errors.email}
          placeholder="nombre@inmobiliaria.com"
          autoComplete="email"
        />

        <Input
          id="password"
          type="password"
          label={t('auth.register.password')}
          value={form.password}
          onChange={handleChange('password')}
          error={errors.password}
          placeholder="••••••••"
          autoComplete="new-password"
        />

        <Input
          id="confirmPassword"
          type="password"
          label={t('auth.register.confirmPassword')}
          value={form.confirmPassword}
          onChange={handleChange('confirmPassword')}
          error={errors.confirmPassword}
          placeholder="••••••••"
          autoComplete="new-password"
        />

        <Button type="submit" size="lg" disabled={loading} className="w-full mt-2">
          {loading && <Spinner className="w-4 h-4 text-white" />}
          {loading ? t('common.loading') : t('auth.register.submit')}
        </Button>
      </form>

      <p className="mt-8 text-sm text-[var(--color-muted)]">
        <a
          href={`${localePrefix}/auth/login`}
          className="link-underline font-medium text-[var(--color-text)]"
        >
          {t('auth.register.loginLink')}
        </a>
      </p>
    </div>
  );
}
