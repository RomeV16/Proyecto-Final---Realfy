import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getRealtorProfile } from '@/lib/public-portal';

interface PortalLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}

/**
 * Chrome del portal público: encabezado con la marca de la inmobiliaria y
 * pie de página. El color de marca se pisa acá, en el contenedor raíz, así
 * que todo lo que cuelga de este layout hereda `--color-brand-500/600` sin
 * que cada pantalla tenga que preocuparse por el tenant.
 */
export default async function PublicPortalLayout({ children, params }: PortalLayoutProps) {
  const { locale, slug } = await params;
  const profile = await getRealtorProfile(slug);
  if (!profile) notFound();

  const t = await getTranslations('portalPublico');

  // Sin color de marca cargado, el subárbol no pisa nada y hereda la
  // paleta por defecto del tema.
  const brandStyle: CSSProperties = {};
  if (profile.brandPrimary) {
    (brandStyle as Record<string, string>)['--color-brand-500'] = profile.brandPrimary;
    (brandStyle as Record<string, string>)['--color-brand-600'] =
      profile.brandSecondary || profile.brandPrimary;
  }

  return (
    <div style={brandStyle} className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Link href={`/${locale}/p/${slug}`} className="flex min-w-0 items-center gap-3">
            {profile.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.logoUrl}
                alt={profile.name}
                className="h-9 w-auto max-w-[10rem] object-contain sm:h-10"
              />
            ) : (
              <span className="wordmark truncate text-xl text-[var(--color-brand-600)]">
                {profile.name}
              </span>
            )}
          </Link>
          {profile.province && (
            <span className="hidden shrink-0 text-sm text-[var(--color-muted)] sm:block">
              {profile.province}
            </span>
          )}
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{children}</div>
      </main>

      <footer className="border-t border-[var(--color-border)]">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-[var(--color-muted)] sm:px-6">
          {t('footer.poweredBy', { name: profile.name })}
        </div>
      </footer>
    </div>
  );
}
