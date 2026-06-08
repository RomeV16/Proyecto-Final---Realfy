'use client';

import { useTranslations } from 'next-intl';

/**
 * Header básico de la app autenticada. Muestra el nombre de la app y un
 * botón de logout placeholder (la lógica de auth se conecta en items posteriores).
 */
export function Header() {
  const t = useTranslations('common');

  return (
    <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
      <span className="text-sm font-medium text-slate-500">Realfy</span>
      <button
        type="button"
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        {t('logout')}
      </button>
    </header>
  );
}
