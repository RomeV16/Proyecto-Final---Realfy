'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { AUTOREPLY_CHANNELS, InboxSettingsSchema, type InboxSettings, type QuickReply } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { useStaffUsers } from '@/components/fees/use-staff-users';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

function Card({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <div>
        <h2 id={id} className="text-base font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        {hint && <p className="text-sm text-[var(--color-muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Identificador de una respuesta rápida a partir de su título: minúsculas, sin tildes, con guiones. */
function quickReplyId(title: string, taken: readonly string[]): string {
  const base =
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'respuesta';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * Configuración → Bandeja de consultas: plazo de primera respuesta, horario de atención, responsable por defecto,
 * autorrespuesta por canal y respuestas rápidas. Sólo Admin y Gerente.
 */
export function InboxSettingsPanel() {
  const t = useTranslations('inbox.settings');
  const tChannels = useTranslations('inbox.channels');
  const tDays = useTranslations('inbox.settings.days');
  const canConfigure = useCan('inbox.configure');
  const staff = useStaffUsers(canConfigure);
  const [form, setForm] = useState<InboxSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canConfigure) return;
    void (async () => {
      try {
        setForm(await apiClient<InboxSettings>('/conversations/settings'));
      } catch (err) {
        setError(err);
      }
    })();
  }, [canConfigure]);

  if (!canConfigure) {
    return <p className="text-sm text-[var(--color-muted)]">{t('readOnly')}</p>;
  }

  const update = (patch: Partial<InboxSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updateHours = (patch: Partial<InboxSettings['businessHours']>) =>
    setForm((f) => (f ? { ...f, businessHours: { ...f.businessHours, ...patch } } : f));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const parsed = InboxSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? t('invalid'));
      return;
    }
    setProblem(null);
    setSaving(true);
    setError(null);
    try {
      setForm(await apiClient<InboxSettings>('/conversations/settings', { method: 'PUT', body: JSON.stringify(parsed.data) }));
      toast.success(t('saved'));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const setQuickReply = (index: number, patch: Partial<QuickReply>) =>
    setForm((f) => (f ? { ...f, quickReplies: f.quickReplies.map((q, i) => (i === index ? { ...q, ...patch } : q)) } : f));

  return (
    <form onSubmit={(e) => void save(e)} className="max-w-4xl space-y-6" noValidate>
      <div>
        <Link href="/configuracion" className="text-sm text-[var(--color-brand-600)] hover:underline">
          ← {t('back')}
        </Link>
        <h1 className="h1 mt-2">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>
      {error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
      {problem && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {problem}
        </p>
      )}
      {error == null && !form && <Skeleton className="h-64 w-full" />}
      {form && (
        <>
          <Card id="inbox-sla" title={t('sla.title')} hint={t('sla.hint')}>
            <FormField label={t('sla.minutes')}>
              {(control) => (
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={form.slaMinutes}
                  onChange={(e) => update({ slaMinutes: Number(e.target.value) })}
                  className="w-32"
                  {...control}
                />
              )}
            </FormField>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.businessHours.enabled}
                onChange={(e) => updateHours({ enabled: e.target.checked })}
              />
              {t('hours.enabled')}
            </label>
            {form.businessHours.enabled && (
              <div className="space-y-3">
                <fieldset className="flex flex-wrap gap-3">
                  <legend className="mb-1 text-sm text-[var(--color-muted)]">{t('hours.days')}</legend>
                  {WEEKDAYS.map((d) => (
                    <label key={d} className="flex items-center gap-1.5 text-sm text-[var(--color-text)]">
                      <input
                        type="checkbox"
                        checked={form.businessHours.days.includes(d)}
                        onChange={(e) =>
                          updateHours({
                            days: e.target.checked
                              ? [...form.businessHours.days, d].sort((a, b) => a - b)
                              : form.businessHours.days.filter((x) => x !== d),
                          })
                        }
                      />
                      {tDays(String(d))}
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap gap-3">
                  <FormField label={t('hours.from')}>
                    {(control) => (
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={form.businessHours.fromHour}
                        onChange={(e) => updateHours({ fromHour: Number(e.target.value) })}
                        className="w-24"
                        {...control}
                      />
                    )}
                  </FormField>
                  <FormField label={t('hours.until')}>
                    {(control) => (
                      <Input
                        type="number"
                        min={1}
                        max={24}
                        value={form.businessHours.untilHour}
                        onChange={(e) => updateHours({ untilHour: Number(e.target.value) })}
                        className="w-24"
                        {...control}
                      />
                    )}
                  </FormField>
                </div>
              </div>
            )}
          </Card>

          <Card id="inbox-routing" title={t('routing.title')}>
            <FormField label={t('routing.threadWindow')} hint={t('routing.threadWindowHint')}>
              {(control) => (
                <Input
                  type="number"
                  min={1}
                  max={720}
                  value={form.threadWindowHours}
                  onChange={(e) => update({ threadWindowHours: Number(e.target.value) })}
                  className="w-32"
                  {...control}
                />
              )}
            </FormField>
            <FormField label={t('routing.defaultAssignee')} hint={t('routing.defaultAssigneeHint')}>
              {(control) => (
                <Select
                  value={form.defaultAssigneeUserId ?? ''}
                  onChange={(e) => update({ defaultAssigneeUserId: e.target.value || null })}
                  {...control}
                >
                  <option value="">{t('routing.noDefault')}</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </Card>

          <Card id="inbox-autoreply" title={t('autoreply.title')} hint={t('autoreply.hint')}>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.autoreply.enabled}
                onChange={(e) => update({ autoreply: { ...form.autoreply, enabled: e.target.checked } })}
              />
              {t('autoreply.enabled')}
            </label>
            {form.autoreply.enabled &&
              AUTOREPLY_CHANNELS.map((channel) => (
                <FormField key={channel} label={t('autoreply.text', { channel: tChannels(channel) })}>
                  {(control) => (
                    <Textarea
                      rows={3}
                      maxLength={1000}
                      value={form.autoreply.texts[channel]}
                      onChange={(e) =>
                        update({
                          autoreply: { ...form.autoreply, texts: { ...form.autoreply.texts, [channel]: e.target.value } },
                        })
                      }
                      {...control}
                    />
                  )}
                </FormField>
              ))}
            <p className="text-xs text-[var(--color-muted)]">{t('autoreply.variables')}</p>
          </Card>

          <Card id="inbox-quick" title={t('quick.title')} hint={t('quick.hint')}>
            <ul className="space-y-3">
              {form.quickReplies.map((q, i) => (
                <li key={q.id} className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                  <FormField label={t('quick.name')}>
                    {(control) => (
                      <Input value={q.title} maxLength={60} onChange={(e) => setQuickReply(i, { title: e.target.value })} {...control} />
                    )}
                  </FormField>
                  <FormField label={t('quick.body')}>
                    {(control) => (
                      <Textarea rows={3} maxLength={1000} value={q.body} onChange={(e) => setQuickReply(i, { body: e.target.value })} {...control} />
                    )}
                  </FormField>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => update({ quickReplies: form.quickReplies.filter((_, j) => j !== i) })}
                  >
                    {t('quick.remove')}
                  </Button>
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                update({
                  quickReplies: [
                    ...form.quickReplies,
                    {
                      id: quickReplyId(
                        t('quick.newTitle'),
                        form.quickReplies.map((q) => q.id),
                      ),
                      title: t('quick.newTitle'),
                      body: t('quick.newBody'),
                    },
                  ],
                })
              }
            >
              {t('quick.add')}
            </Button>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
