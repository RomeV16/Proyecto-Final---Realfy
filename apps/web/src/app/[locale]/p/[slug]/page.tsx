import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getRealtorProfile, getPublicProperties } from '@/lib/public-portal';
import { getSiteContext } from '@/lib/microsite-site';
import { PropertyFilters } from '@/components/portal-publico/property-filters';
import { PublicPropertyGrid } from '@/components/portal-publico/property-grid';
import { InquiryForm } from '@/components/portal-publico/inquiry-form';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

const LIMIT = 12;

interface PortalHomeProps {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{
    operation?: string;
    type?: string;
    city?: string;
    minPrice?: string;
    maxPrice?: string;
    page?: string;
  }>;
}

export async function generateMetadata({ params }: Pick<PortalHomeProps, 'params'>): Promise<Metadata> {
  const { locale, slug } = await params;
  const profile = await getRealtorProfile(slug);
  if (!profile) return {};
  const t = await getTranslations({ locale, namespace: 'portalPublico.seo' });
  const site = await getSiteContext(slug, locale);
  const title = t('homeTitle', { name: profile.name });
  const description = t('homeDescription', { name: profile.name });
  const url = `${site.origin}${site.base || '/'}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      siteName: profile.name,
      ...(profile.logoUrl ? { images: [profile.logoUrl] } : {}),
    },
  };
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
    minPrice: sp.minPrice,
    maxPrice: sp.maxPrice,
    page,
    limit: LIMIT,
  });

  const t = await getTranslations('portalPublico');
  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
  const filtered = Boolean(sp.operation || sp.type || sp.city || sp.minPrice || sp.maxPrice);

  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (sp.operation) params.set('operation', sp.operation);
    if (sp.type) params.set('type', sp.type);
    if (sp.city) params.set('city', sp.city);
    if (sp.minPrice) params.set('minPrice', sp.minPrice);
    if (sp.maxPrice) params.set('maxPrice', sp.maxPrice);
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
          initialMinPrice={sp.minPrice || ''}
          initialMaxPrice={sp.maxPrice || ''}
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
