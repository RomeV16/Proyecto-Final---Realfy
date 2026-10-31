'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ApiRequestError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';

/** Motivo de rechazo que devuelve POST /contracts/:id/activate (o el alta ya activa). */
export interface ActivationProblem {
  code: string;
  contractId?: string;
  startDate?: string;
  endDate?: string;
}

/**
 * Extrae los motivos de un rechazo de activación. Devuelve null si el error no
 * es de activación, para que quien llama muestre su mensaje habitual.
 */
export function activationProblemsOf(err: unknown): ActivationProblem[] | null {
  if (!(err instanceof ApiRequestError)) return null;
  if (err.errorCode !== 'CONTRACT_NOT_ACTIVATABLE') return null;
  const problems = err.body?.problems;
  return Array.isArray(problems) ? (problems as ActivationProblem[]) : [];
}

const KNOWN_CODES = new Set([
  'PROPERTY_NOT_FOUND',
  'PROPERTY_INACTIVE',
  'MISSING_INQUILINO',
  'LESSOR_SHARES_INVALID',
  'INVALID_DATES',
  'OVERLAPPING_CONTRACT',
  'RENTAL_OPERATION_ARCHIVED',
]);


/** Lista, en lenguaje llano, de lo que impide activar el contrato. */
export function ActivationProblems({ problems }: { problems: ActivationProblem[] }) {
  const t = useTranslations('contracts.activation');

  return (
    <div
      role="alert"
      className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-2"
    >
      <p className="text-sm font-medium text-red-800">{t('problemsTitle')}</p>
      <ul className="list-disc pl-5 space-y-1">
        {problems.length === 0 && (
          <li className="text-sm text-red-700">{t('problems.UNKNOWN')}</li>
        )}
        {problems.map((p, i) => (
          <li key={`${p.code}-${p.contractId ?? i}`} className="text-sm text-red-700">
            {KNOWN_CODES.has(p.code)
              ? t(`problems.${p.code}`, {
                  start: formatDate(p.startDate, 'medium'),
                  end: formatDate(p.endDate, 'medium'),
                })
              : t('problems.UNKNOWN')}
            {p.code === 'OVERLAPPING_CONTRACT' && p.contractId && (
              <>
                {' '}
                <Link
                  href={`/contracts/${p.contractId}`}
                  className="font-medium underline hover:text-red-900"
                >
                  {t('viewContract')}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
