'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { loginSchema } from '@realfy/shared/schemas';
import { setStoredUser, ApiRequestError } from '@/lib/api-client';
import type { AuthResponse } from '@realfy/shared';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

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

  return (
    <div className="w-full">
      <div className="mb-9">
        <p className="eyebrow mb-3">Bienvenido de vuelta</p>
        <h1 className="h1">{t('auth.login.title')}</h1>
        <p className="lead mt-3 text-base">
          Administrá propiedades, contratos y liquidaciones desde un solo lugar.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {serverError && (
          <div className="bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] text-sm rounded-lg px-4 py-3 border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] animate-[fade-in_0.4s_var(--ease-luxe)]">
            {serverError}
          </div>
        )}
        <Input
          id="email"
          type="email"
          label={t('auth.login.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          placeholder="nombre@inmobiliaria.com"
          autoComplete="email"
          autoFocus
        />
        <Input
          id="password"
          type="password"
          label={t('auth.login.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="••••••••"
          autoComplete="current-password"
        />
        <Button type="submit" size="lg" disabled={loading} className="w-full mt-2">
          {loading && <Spinner className="w-4 h-4 text-white" />}
          {loading ? t('common.loading') : t('auth.login.submit')}
        </Button>
      </form>

      <p className="mt-8 text-sm text-[var(--color-muted)]">
        <a
          href={`${localePrefix}/auth/register`}
          className="link-underline font-medium text-[var(--color-text)]"
        >
          {t('auth.login.registerLink')}
        </a>
      </p>
    </div>
  );
}
