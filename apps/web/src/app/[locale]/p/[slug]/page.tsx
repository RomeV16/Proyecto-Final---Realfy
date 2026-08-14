import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getRealtorProfile, getPublicProperties } from '@/lib/public-portal';
import { PropertyFilters } from '@/components/portal-publico/property-filters';
import { PublicPropertyGrid } from '@/components/portal-publico/property-grid';
import { InquiryForm } from '@/components/portal-publico/inquiry-form';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

const LIMIT = 12;

interface PortalHomeProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ operation?: string; type?: string; city?: string; page?: string }>;
}

export default async function PublicPortalHomePage({ params, searchParams }: PortalHomeProps) {
  const { locale, slug } = await params;
  const sp = await searchParams;

  const profile = await getRealtorProfile(slug);
  if (!profile) notFound();

  const page = Number(sp.page) > 0 ? Number(sp.page) : 1;
  const data = await getPublicProperties(slug, {
    operation: sp.operation,
    type: sp.type,
    city: sp.city,
    page,
    limit: LIMIT,
  });

  const t = await getTranslations('portalPublico');
  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
  const filtered = Boolean(sp.operation || sp.type || sp.city);

  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (sp.operation) params.set('operation', sp.operation);
    if (sp.type) params.set('type', sp.type);
    if (sp.city) params.set('city', sp.city);
    if (target > 1) params.set('page', String(target));
    const query = params.toString();
    return `/${locale}/p/${slug}${query ? `?${query}` : ''}`;
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        {profile.province && <p className="eyebrow">{profile.province}</p>}
        <h1 className="h1">{t('hero.title', { name: profile.name })}</h1>
        <p className="max-w-2xl text-[var(--color-muted)]">{t('hero.subtitle')}</p>
      </section>

      <section id="propiedades" className="space-y-5">
        <div>
          <h2 className="h3">{t('list.title')}</h2>
          <p className="text-sm text-[var(--color-muted)]">{t('list.subtitle', { count: data.total })}</p>
        </div>

        <PropertyFilters
          initialOperation={sp.operation || ''}
          initialType={sp.type || ''}
          initialCity={sp.city || ''}
        />

        <PublicPropertyGrid items={data.items} locale={locale} slug={slug} filtered={filtered} />

        {totalPages > 1 && (
          <nav
            className="flex items-center justify-center gap-2 pt-2"
            aria-label={t('pagination.label')}
          >
            <Link
              href={pageHref(Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]',
                page <= 1 && 'pointer-events-none opacity-40',
              )}
            >
              <Icon name="chevronLeft" className="h-4 w-4" strokeWidth={2} />
              {t('pagination.prev')}
            </Link>
            <span className="px-2 text-sm text-[var(--color-muted)]">
              {t('pagination.pageOf', { page, total: totalPages })}
            </span>
            <Link
              href={pageHref(Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-sunken)]',
                page >= totalPages && 'pointer-events-none opacity-40',
              )}
            >
              {t('pagination.next')}
              <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2} />
            </Link>
          </nav>
        )}
      </section>

      <section id="consulta" className="scroll-mt-20 border-t border-[var(--color-border)] pt-8">
        <div className="mx-auto w-full max-w-xl space-y-4">
          <h2 className="h3">{t('inquiry.title')}</h2>
          <p className="text-sm text-[var(--color-muted)]">{t('inquiry.subtitle')}</p>
          <InquiryForm slug={slug} />
        </div>
      </section>
    </div>
  );
}
