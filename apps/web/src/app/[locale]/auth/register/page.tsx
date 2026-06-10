'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { registerSchema } from '@realfy/shared/schemas';
import { apiClient, setStoredUser, ApiRequestError } from '@/lib/api-client';
import type { AuthResponse } from '@realfy/shared';

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
    <div className="w-full max-w-sm">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-500 text-white font-bold text-xl mb-4">
          R
        </div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
          {t('auth.register.title')}
        </h1>
      </div>

      {/* Form card */}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4"
      >
        {serverError && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 border border-red-200">
            {serverError}
          </div>
        )}

        {/* Name row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="firstName"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              {t('auth.register.firstName')}
            </label>
            <input
              id="firstName"
              type="text"
              value={form.firstName}
              onChange={handleChange('firstName')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors ${
                errors.firstName
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
              } focus:outline-none focus:ring-2`}
              autoFocus
            />
            {errors.firstName && (
              <p className="mt-1 text-xs text-red-600">{errors.firstName}</p>
            )}
          </div>
          <div>
            <label
              htmlFor="lastName"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              {t('auth.register.lastName')}
            </label>
            <input
              id="lastName"
              type="text"
              value={form.lastName}
              onChange={handleChange('lastName')}
              className={`w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors ${
                errors.lastName
                  ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                  : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
              } focus:outline-none focus:ring-2`}
            />
            {errors.lastName && (
              <p className="mt-1 text-xs text-red-600">{errors.lastName}</p>
            )}
          </div>
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t('auth.register.email')}
          </label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={handleChange('email')}
            className={`w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors ${
              errors.email
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
            } focus:outline-none focus:ring-2`}
            placeholder="nombre@inmobiliaria.com"
            autoComplete="email"
          />
          {errors.email && (
            <p className="mt-1 text-xs text-red-600">{errors.email}</p>
          )}
        </div>

        {/* Password */}
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t('auth.register.password')}
          </label>
          <input
            id="password"
            type="password"
            value={form.password}
            onChange={handleChange('password')}
            className={`w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors ${
              errors.password
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
            } focus:outline-none focus:ring-2`}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          {errors.password && (
            <p className="mt-1 text-xs text-red-600">{errors.password}</p>
          )}
        </div>

        {/* Confirm password */}
        <div>
          <label
            htmlFor="confirmPassword"
            className="block text-sm font-medium text-slate-700 mb-1.5"
          >
            {t('auth.register.confirmPassword')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={form.confirmPassword}
            onChange={handleChange('confirmPassword')}
            className={`w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors ${
              errors.confirmPassword
                ? 'border-red-300 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
            } focus:outline-none focus:ring-2`}
            placeholder="••••••••"
            autoComplete="new-password"
          />
          {errors.confirmPassword && (
            <p className="mt-1 text-xs text-red-600">
              {errors.confirmPassword}
            </p>
          )}
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-500 text-white font-medium py-2.5 px-4 rounded-lg text-sm hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('common.loading') : t('auth.register.submit')}
        </button>
      </form>

      {/* Login link */}
      <p className="text-center mt-6 text-sm text-slate-600">
        <a
          href={`${localePrefix}/auth/login`}
          className="text-brand-600 hover:text-brand-700 font-medium transition-colors"
        >
          {t('auth.register.loginLink')}
        </a>
      </p>
    </div>
  );
}
