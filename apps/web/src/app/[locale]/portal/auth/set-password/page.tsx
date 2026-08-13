'use client';

import { Suspense, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useRouter,
  usePathname,
  useSearchParams,
} from 'next/navigation';
import { PortalSetPasswordRequestSchema } from '@realfy/shared';
import type { PortalAuthResponse } from '@realfy/shared';
import {
  portalApiClient,
  setPortalTokens,
  PortalApiRequestError,
} from '@/lib/portal-api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

function SetPasswordForm() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const localePrefix =
    pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');

    const fieldErrors: Record<string, string> = {};
    if (password.length < 8) {
      fieldErrors.password = t('portal.auth.setPassword.passwordMin');
    }
    if (password !== confirmPassword) {
      fieldErrors.confirmPassword = t(
        'portal.auth.setPassword.passwordMismatch',
      );
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    const parsed = PortalSetPasswordRequestSchema.safeParse({ token, password });
    if (!parsed.success) {
      setServerError(t('portal.auth.setPassword.invalidToken'));
      return;
    }

    setLoading(true);
    try {
      const res = await portalApiClient<PortalAuthResponse>(
        '/portal/auth/set-password',
        {
          method: 'POST',
          body: JSON.stringify({ token, password }),
        },
      );
      setPortalTokens(res.tokens.accessToken, res.tokens.refreshToken);
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'portalPerson',
          JSON.stringify({
            id: res.person.id,
            email: res.person.email,
            firstName: res.person.firstName,
            lastName: res.person.lastName,
            tenantId: res.person.tenantId,
          }),
        );
      }
      // Full navigation so the auth provider rehydrates from storage.
      window.location.href = `${localePrefix}/portal`;
    } catch (err) {
      if (err instanceof PortalApiRequestError) {
        if (err.errorCode === 'INVITATION_EXPIRED') {
          setServerError(t('portal.auth.setPassword.tokenExpired'));
        } else if (err.errorCode === 'INVITATION_ALREADY_ACCEPTED') {
          setServerError(t('portal.auth.setPassword.tokenUsed'));
        } else if (err.errorCode === 'INVITATION_INVALID') {
          setServerError(t('portal.auth.setPassword.invalidToken'));
        } else {
          setServerError(t('portal.auth.setPassword.error'));
        }
      } else {
        setServerError(t('common.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  const missingToken = !token;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-brand-500 text-white font-bold text-xl mb-5">
            R
          </div>
          <p className="eyebrow mb-2">{t('portal.common.brand')}</p>
          <h1 className="h2">{t('portal.auth.setPassword.title')}</h1>
          <p className="lead mt-2 text-sm">
            {t('portal.auth.setPassword.subtitle')}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="card-lux p-6 space-y-5"
        >
          {(serverError || missingToken) && (
            <div className="bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] text-sm rounded-lg px-4 py-3 border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]">
              {serverError || t('portal.auth.setPassword.invalidToken')}
            </div>
          )}

          <Input
            id="password"
            type="password"
            label={t('portal.auth.setPassword.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            placeholder="••••••••"
            autoComplete="new-password"
            autoFocus
            disabled={missingToken}
          />
          <Input
            id="confirmPassword"
            type="password"
            label={t('portal.auth.setPassword.confirmPassword')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={errors.confirmPassword}
            placeholder="••••••••"
            autoComplete="new-password"
            disabled={missingToken}
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={loading || missingToken}
          >
            {loading && <Spinner className="w-4 h-4 text-white" />}
            {loading
              ? t('common.loading')
              : t('portal.auth.setPassword.submit')}
          </Button>
        </form>

        <p className="mt-8 text-center text-sm text-[var(--color-muted)]">
          <button
            type="button"
            onClick={() => router.push(`${localePrefix}/portal/auth/login`)}
            className="link-underline font-medium text-[var(--color-text)]"
          >
            {t('portal.auth.setPassword.loginLink')}
          </button>
        </p>
      </div>
    </div>
  );
}

export default function PortalSetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}
