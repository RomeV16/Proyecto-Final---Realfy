'use client';

import { useTranslations } from 'next-intl';
import { ApiRequestError } from '@/lib/api-client';

const KNOWN = [
  'LAST_ADMIN',
  'CANNOT_DEACTIVATE_SELF',
  'USER_NOT_FOUND',
  'INVITATION_NOT_FOUND',
  'USER_INACTIVE',
] as const;

type KnownCode = (typeof KNOWN)[number];

const isKnown = (code: string): code is KnownCode => (KNOWN as readonly string[]).includes(code);

/** Mensaje para un error de la API de usuarios: el del código si lo conocemos, o el de respaldo. */
export function useActionError(): (err: unknown, fallback?: string) => string {
  const t = useTranslations('users.errors');
  return (err, fallback) =>
    err instanceof ApiRequestError && isKnown(err.errorCode)
      ? t(err.errorCode)
      : (fallback ?? t('generic'));
}
