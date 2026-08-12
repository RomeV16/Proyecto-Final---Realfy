'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { PortalLoginRequestSchema } from '@realfy/shared';
import { usePortalAuth } from '@/lib/portal-auth-context';
import { PortalApiRequestError } from '@/lib/portal-api-client';

export default function PortalLoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { login } = usePortalAuth();
  const localePrefix =
    pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const result = PortalLoginRequestSchema.safeParse({ email, password });
    if (!result.success) {
      setError(t('portal.auth.login.error'));
      return;
    }

    setLoading(true);
    try {
      await login(email, password);
      router.push(`${localePrefix}/portal`);
    } catch (err) {
      if (err instanceof PortalApiRequestError) {
        setError(t('portal.auth.login.error'));
      } else {
        setError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-500 text-white font-bold text-xl mb-4">
            R
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {t('portal.auth.login.title')}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {t('portal.auth.login.subtitle')}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-5"
        >
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3 border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              {t('portal.auth.login.email')}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="nombre@email.com"
              autoComplete="email"
              autoFocus
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              {t('portal.auth.login.password')}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-500 text-white font-medium py-2.5 px-4 rounded-lg text-sm hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? t('common.loading') : t('portal.auth.login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
