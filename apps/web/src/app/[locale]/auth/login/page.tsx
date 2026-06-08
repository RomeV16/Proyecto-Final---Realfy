'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { loginSchema } from '@realfy/shared/schemas';
import { setStoredUser, ApiRequestError } from '@/lib/api-client';
import type { AuthResponse } from '@realfy/shared';
import { FormShell } from '@/components/ui/form-shell';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const result = loginSchema.safeParse({ email, password });
    if (result.success) { setErrors({}); return true; }
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as string;
      if (!fieldErrors[field]) fieldErrors[field] = t(issue.message as Parameters<typeof t>[0]);
    }
    setErrors(fieldErrors);
    return false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;
    setLoading(true);
    try {
      // Use raw fetch for login so the apiClient refresh-redirect logic
      // (triggered on 401) does not intercept invalid-credentials responses.
      const loginRes = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        throw new ApiRequestError(loginRes.status, 'INVALID_CREDENTIALS', 'Invalid credentials');
      }
      const res = await loginRes.json() as AuthResponse;
      setStoredUser(res.user);
      localStorage.setItem('user', JSON.stringify(res.user));
      router.push(`${localePrefix}`);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? t('auth.login.error') : t('common.error'));
    } finally { setLoading(false); }
  };

  const inputCls = (hasError: boolean) =>
    `w-full px-3.5 py-2.5 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 ${
      hasError ? 'border-red-300 focus:border-red-500 focus:ring-red-200' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200'
    }`;

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-500 text-white font-bold text-xl mb-4">R</div>
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{t('auth.login.title')}</h1>
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <FormShell
          onSubmit={handleSubmit}
          submitLabel={loading ? t('common.loading') : t('auth.login.submit')}
          submitBusy={loading}
          className="max-w-none"
        >
          {serverError && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 border border-red-200">{serverError}</div>
          )}
          <FormShell.Section>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1.5">{t('auth.login.email')}</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                className={inputCls(!!errors.email)} placeholder="nombre@inmobiliaria.com" autoComplete="email" autoFocus />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">{t('auth.login.password')}</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className={inputCls(!!errors.password)} placeholder="••••••••" autoComplete="current-password" />
              {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
            </div>
          </FormShell.Section>
        </FormShell>
      </div>
      <p className="text-center mt-6 text-sm text-slate-600">
        <a href={`${localePrefix}/auth/register`} className="text-brand-600 hover:text-brand-700 font-medium transition-colors">
          {t('auth.login.registerLink')}
        </a>
      </p>
    </div>
  );
}
