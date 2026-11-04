'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ContractType, TEMPLATE_LIST_NAMES, TemplateSyntaxError, validateTemplate } from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { useCan } from '@/lib/permissions';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PaginationBar } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ContractTemplateCatalog } from './contract-template-catalog';

interface ContractTemplate {
  id: string;
  name: string;
  contractType: string;
  body: string;
  isActive: boolean;
  isDefault: boolean;
}

interface TemplatePage {
  items: ContractTemplate[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Draft {
  id: string | null;
  name: string;
  contractType: string;
  body: string;
  isActive: boolean;
  isDefault: boolean;
}

const PAGE_SIZE = 10;
const CONTRACT_TYPES = Object.values(ContractType);
const EMPTY_DRAFT: Draft = { id: null, name: '', contractType: ContractType.Alquiler, body: '', isActive: true, isDefault: false };

/** Mensaje del primer error de sintaxis del cuerpo, o `null` si está bien formado. */
function syntaxMessage(body: string): string | null {
  try {
    validateTemplate(body, { lists: TEMPLATE_LIST_NAMES });
    return null;
  } catch (err) {
    if (err instanceof TemplateSyntaxError) return err.message;
    throw err;
  }
}

/** Línea y columna que informa la API en un 400 `TEMPLATE_SYNTAX_ERROR`. */
function apiSyntaxPosition(error: unknown): { line: number; column: number } | null {
  if (!(error instanceof ApiRequestError) || error.errorCode !== 'TEMPLATE_SYNTAX_ERROR') return null;
  const d = error.details.details as { line?: number; column?: number } | undefined;
  return d?.line && d?.column ? { line: d.line, column: d.column } : null;
}

/** Administración de las plantillas de contrato: lista, alta, edición y baja, con el catálogo de variables al lado del texto. */
export function ContractTemplatesManager() {
  const t = useTranslations('contractTemplates');
  const tCommon = useTranslations('common');
  const confirm = useConfirm();
  const canManage = useCan('settings.manage');

  const [data, setData] = useState<TemplatePage | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [touched, setTouched] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursor = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiClient<TemplatePage>(`/contract-templates?page=${page}&limit=${PAGE_SIZE}`));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [page]);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  // Después de insertar texto, el cursor se pone al final de lo insertado.
  useEffect(() => {
    if (pendingCursor.current === null || !bodyRef.current) return;
    bodyRef.current.focus();
    bodyRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
    pendingCursor.current = null;
  }, [draft?.body]);

  const liveError = useMemo(() => (draft ? syntaxMessage(draft.body) : null), [draft]);

  if (!canManage) {
    return <p className="text-sm text-[var(--color-muted)]">{t('noPermission')}</p>;
  }

  function open(next: Draft) {
    setDraft(next);
    setSaveError(null);
    setTouched(false);
  }

  function edit(template: ContractTemplate) {
    open({ ...template });
  }

  function change(patch: Partial<Draft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function insert(text: string) {
    if (!draft) return;
    const el = bodyRef.current;
    const start = el?.selectionStart ?? draft.body.length;
    const end = el?.selectionEnd ?? start;
    pendingCursor.current = start + text.length;
    change({ body: draft.body.slice(0, start) + text + draft.body.slice(end) });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setTouched(true);
    if (!draft.name.trim() || !draft.body.trim() || liveError) return;
    setSaving(true);
    setSaveError(null);
    const payload = {
      name: draft.name.trim(),
      contractType: draft.contractType,
      body: draft.body,
      isActive: draft.isActive,
      isDefault: draft.isDefault,
    };
    try {
      await apiClient(draft.id ? `/contract-templates/${draft.id}` : '/contract-templates', {
        method: draft.id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(t(draft.id ? 'form.updated' : 'form.created'));
      setDraft(null);
      await load();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  }

  async function remove(template: ContractTemplate) {
    const ok = await confirm({
      title: t('deleteConfirm.title'),
      body: t('deleteConfirm.body', { name: template.name }),
      confirmLabel: t('deleteConfirm.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiClient(`/contract-templates/${template.id}`, { method: 'DELETE' });
      toast.success(t('deleteConfirm.done'));
      if (data && data.items.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch {
      toast.error(t('deleteConfirm.error'));
    }
  }

  const position = apiSyntaxPosition(saveError);

  if (draft) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="h1">{draft.id ? t('form.editTitle') : t('form.createTitle')}</h1>
          <Button variant="secondary" size="sm" onClick={() => setDraft(null)} disabled={saving}>
            {t('back')}
          </Button>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            {saveError != null && (
              <div className="space-y-2">
                <ErrorNotice error={saveError} fallback={t('form.saveError')} />
                {position && <p className="text-sm text-[var(--color-danger)]">{t('form.apiSyntaxError', position)}</p>}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={t('form.name')} required error={touched && !draft.name.trim() ? t('form.required') : undefined}>
                {(c) => <Input {...c} value={draft.name} maxLength={200} onChange={(e) => change({ name: e.target.value })} />}
              </FormField>
              <FormField label={t('form.contractType')}>
                {(c) => (
                  <Select {...c} value={draft.contractType} onChange={(e) => change({ contractType: e.target.value })}>
                    {CONTRACT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`contractTypes.${type}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            </div>
            <FormField
              label={t('form.body')}
              hint={t('form.bodyHint')}
              required
              error={touched && !draft.body.trim() ? t('form.required') : undefined}
            >
              {(c) => (
                <Textarea
                  {...c}
                  ref={bodyRef}
                  rows={22}
                  spellCheck={false}
                  className="resize-y font-mono text-xs leading-relaxed"
                  value={draft.body}
                  maxLength={200000}
                  onChange={(e) => change({ body: e.target.value })}
                />
              )}
            </FormField>
            {draft.body.trim() &&
              (liveError ? (
                <p role="alert" className="text-sm text-[var(--color-danger)]">
                  {t('form.syntaxError', { message: liveError })}
                </p>
              ) : (
                <p role="status" className="text-sm text-[var(--color-muted)]">
                  {t('form.syntaxOk')}
                </p>
              ))}
            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.isActive} onChange={(e) => change({ isActive: e.target.checked })} />
                {t('form.isActive')}
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.isDefault} onChange={(e) => change({ isDefault: e.target.checked })} />
                {t('form.isDefault')}
              </label>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={saving || Boolean(liveError)}>
                {saving ? t('form.saving') : t(draft.id ? 'form.save' : 'form.create')}
              </Button>
            </div>
          </form>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 lg:max-h-[80vh] lg:overflow-y-auto">
            <ContractTemplateCatalog onInsert={insert} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <Button onClick={() => open(EMPTY_DRAFT)}>{t('newTemplate')}</Button>
      </div>

      {loadError && <ErrorNotice error={null} fallback={t('loadError')} />}

      {data && data.items.length === 0 && <EmptyState title={t('empty.title')} subtitle={t('empty.subtitle')} />}

      {data && data.items.length > 0 && (
        <ul className="space-y-3">
          {data.items.map((template) => (
            <li
              key={template.id}
              className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1.5">
                <p className="truncate font-semibold text-[var(--color-text)]">{template.name}</p>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-muted)]">
                  <span>{t(`contractTypes.${template.contractType}`)}</span>
                  <Badge variant={template.isActive ? 'success' : 'neutral'} dot>
                    {template.isActive ? t('status.active') : t('status.inactive')}
                  </Badge>
                  {template.isDefault && <Badge variant="brand">{t('status.default')}</Badge>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" size="sm" onClick={() => edit(template)} aria-label={`${t('edit')}: ${template.name}`}>
                  {t('edit')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void remove(template)} aria-label={`${t('delete')}: ${template.name}`}>
                  {t('delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {data && <PaginationBar page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPageChange={setPage} />}
    </div>
  );
}
