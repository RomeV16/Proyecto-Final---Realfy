'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { PortalLoginRequestSchema } from '@realfy/shared';
import { usePortalAuth } from '@/lib/portal-auth-context';
import { PortalApiRequestError } from '@/lib/portal-api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

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
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-500 text-white font-bold text-xl mb-5">
            R
          </div>
          <p className="eyebrow mb-2">{t('portal.common.brand')}</p>
          <h1 className="h2">{t('portal.auth.login.title')}</h1>
          <p className="lead mt-2 text-sm">
            {t('portal.auth.login.subtitle')}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-lux p-6 space-y-5"
        >
          {error && (
            <div className="bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] text-sm rounded-lg px-4 py-3 border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] animate-[fade-in_0.4s_var(--ease-luxe)]">
              {error}
            </div>
          )}

          <Input
            id="email"
            type="email"
            label={t('portal.auth.login.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nombre@email.com"
            autoComplete="email"
            autoFocus
          />
          <Input
            id="password"
            type="password"
            label={t('portal.auth.login.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading && <Spinner className="w-4 h-4 text-white" />}
            {loading ? t('common.loading') : t('portal.auth.login.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
