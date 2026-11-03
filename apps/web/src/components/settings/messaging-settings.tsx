'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { MESSAGING_MODES, type MessageTemplateInfo, type MessagingMode, type MessagingSettings } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/cn';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiData } from '@/components/messaging/use-api-data';
import { useMessageText } from '@/components/messaging/use-message-text';

const MODE_TONE: Record<MessagingMode, BadgeVariant> = { off: 'neutral', allowlist: 'warning', live: 'success' };

/**
 * Configuración → Mensajería: el modo de envío del ambiente (de solo lectura: lo fija quien despliega), el estado
 * de los proveedores, el horario de envío y las plantillas con su texto de WhatsApp.
 */
export function MessagingSettingsPanel() {
  const t = useTranslations('messaging.settings');
  const canManage = useCan('messaging.manage');
  const settings = useApiData<MessagingSettings>(canManage ? '/messaging/settings' : null);

  if (!canManage) {
    return <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>;
  }

  const data = settings.data;
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/configuracion" className="text-sm text-[var(--color-brand-600)] hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="h1 mt-2">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>
      {settings.error != null && <ErrorNotice error={settings.error} fallback={t('loadError')} />}
      {settings.error == null && !data && <Skeleton className="h-64 w-full" />}
      {data && (
        <>
          <ModeCard mode={data.mode} allowlistCount={data.allowlistCount} />
          <ProvidersCard providers={data.providers} />
          <Card id="messaging-window" title={t('window.title')}>
            <p className="text-sm font-medium text-[var(--color-text)]">
              {t('window.range', { from: data.sendingWindow.fromHour, until: data.sendingWindow.untilHour })}
            </p>
            <p className="text-sm text-[var(--color-muted)]">{t('window.explain')}</p>
            <Link href="/configuracion/valores-por-defecto" className="text-sm text-[var(--color-brand-600)] hover:underline">
              {t('window.change')}
            </Link>
          </Card>
          <TemplatesCard templates={data.templates} />
        </>
      )}
    </div>
  );
}

function Card({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 id={id} className="text-base font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ModeCard({ mode, allowlistCount }: { mode: MessagingMode; allowlistCount: number }) {
  const t = useTranslations('messaging.settings.mode');
  return (
    <Card id="messaging-mode" title={t('title')}>
      <p className="flex items-center gap-2 text-sm text-[var(--color-text)]">
        {t('currentLabel')}
        <Badge variant={MODE_TONE[mode]} size="md" dot>
          {t(`${mode}.label`)}
        </Badge>
      </p>
      <ul className="space-y-2">
        {MESSAGING_MODES.map((m) => (
          <li
            key={m}
            aria-current={m === mode ? 'true' : undefined}
            className={cn(
              'rounded-lg border p-3 text-sm',
              m === mode
                ? 'border-[color-mix(in_oklab,var(--color-brand-500)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--color-surface))]'
                : 'border-[var(--color-border)]',
            )}
          >
            <p className="font-medium text-[var(--color-text)]">
              {t(`${m}.label`)}
              {m === mode && <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">({t('current')})</span>}
            </p>
            <p className="text-[var(--color-muted)]">{t(`${m}.description`, { count: allowlistCount })}</p>
          </li>
        ))}
      </ul>
      <p className="text-sm text-[var(--color-muted)]">{t('note')}</p>
    </Card>
  );
}

function YesNo({ value }: { value: boolean }) {
  const t = useTranslations('messaging.settings.providers');
  return (
    <Badge variant={value ? 'success' : 'neutral'} dot>
      {value ? t('yes') : t('no')}
    </Badge>
  );
}

function ProvidersCard({ providers }: { providers: MessagingSettings['providers'] }) {
  const t = useTranslations('messaging.settings.providers');
  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
      <dt className="text-sm text-[var(--color-muted)]">{label}</dt>
      <dd className="text-sm text-[var(--color-text)]">{value}</dd>
    </div>
  );
  return (
    <Card id="messaging-providers" title={t('title')}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('email')}</h3>
          <dl className="divide-y divide-[var(--color-border)]">
            {row(t('configured'), <YesNo value={providers.email.configured} />)}
            {row(t('from'), providers.email.from ?? '—')}
            {row(t('webhook'), <YesNo value={providers.email.webhook} />)}
          </dl>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('whatsapp')}</h3>
          <dl className="divide-y divide-[var(--color-border)]">
            {row(t('configured'), <YesNo value={providers.whatsapp.configured} />)}
            {row(t('webhook'), <YesNo value={providers.whatsapp.webhook} />)}
          </dl>
        </div>
      </div>
    </Card>
  );
}

function TemplatesCard({ templates }: { templates: MessageTemplateInfo[] }) {
  const t = useTranslations('messaging.settings.templates');
  const text = useMessageText();
  const columns: DataTableColumn<MessageTemplateInfo>[] = [
    {
      key: 'name',
      header: t('columns.name'),
      render: (tpl) => <span className="font-medium text-[var(--color-text)]">{text.template(tpl.key)}</span>,
    },
    { key: 'channels', header: t('columns.channels'), render: (tpl) => tpl.channels.map(text.channel).join(' · ') },
    { key: 'audience', header: t('columns.audience'), render: (tpl) => t(`audiences.${tpl.audience}`) },
    {
      key: 'whatsapp',
      header: t('columns.whatsapp'),
      render: (tpl) =>
        tpl.whatsapp ? (
          <span className="font-mono text-xs">
            {tpl.whatsapp.name} · {tpl.whatsapp.language}
          </span>
        ) : (
          t('emailOnly')
        ),
    },
    {
      key: 'text',
      header: t('columns.text'),
      render: (tpl) => (tpl.whatsappText ? <p className="max-w-md text-xs text-[var(--color-muted)]">{tpl.whatsappText}</p> : '—'),
    },
  ];
  return (
    <Card id="messaging-templates" title={t('title')}>
      <p className="text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      <DataTable items={templates} columns={columns} keyExtractor={(tpl) => tpl.key} empty={{ title: t('empty') }} />
    </Card>
  );
}
