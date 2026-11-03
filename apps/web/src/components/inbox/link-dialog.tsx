'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { ConversationDetail } from '@/lib/inbox';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

type Kind = 'person' | 'property' | 'contract';

interface Candidate {
  id: string;
  label: string;
  detail?: string;
}

interface Props {
  conversation: ConversationDetail;
  onClose: () => void;
  onLinked: () => void;
}

const SEARCH_MIN = 2;

interface PersonRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}
interface PropertyRow {
  id: string;
  title: string;
  city: string | null;
}
interface ContractRow {
  id: string;
  status: string;
  property?: { title?: string | null } | null;
}

/**
 * Vincula la consulta con una persona, una propiedad o un contrato. La persona y la propiedad se buscan por texto; los
 * contratos son los de la persona ya vinculada. Desvincular es mandar null.
 */
export function LinkDialog({ conversation, onClose, onLinked }: Props) {
  const t = useTranslations('inbox.link');
  const [kind, setKind] = useState<Kind>('person');
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const personId = conversation.person?.id ?? null;

  useEffect(() => {
    const text = query.trim();
    const needsText = kind !== 'contract';
    if ((needsText && text.length < SEARCH_MIN) || (kind === 'contract' && !personId)) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await search(kind, text, personId);
          if (!cancelled) {
            setCandidates(found);
            setError(null);
          }
        } catch (err) {
          if (!cancelled) setError(err);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query, personId]);

  async function link(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      await apiClient(`/conversations/${conversation.id}/links`, { method: 'PUT', body: JSON.stringify(body) });
      toast.success(t('saved'));
      onLinked();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  const pick = (id: string) => {
    if (kind === 'person') return link({ personId: id });
    return link({ related: { type: kind === 'property' ? 'Property' : 'Contract', id } });
  };

  let hint = t('noResults');
  if (kind === 'contract' && !personId) hint = t('contractNeedsPerson');
  else if (kind !== 'contract' && query.trim().length < SEARCH_MIN) hint = t('typeToSearch');

  return (
    <Dialog open onClose={onClose} busy={saving} size="md">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {error != null && <ErrorNotice error={error} fallback={t('error')} />}
        <div className="flex flex-wrap gap-2">
          <Select aria-label={t('kind')} value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="w-auto">
            <option value="person">{t('kinds.person')}</option>
            <option value="property">{t('kinds.property')}</option>
            <option value="contract">{t('kinds.contract')}</option>
          </Select>
          {kind !== 'contract' && (
            <Input
              aria-label={t('search')}
              placeholder={t('search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1"
            />
          )}
        </div>
        {candidates.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{hint}</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
            {candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void pick(c.id)}
                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-sunken)]"
                >
                  <span className="font-medium text-[var(--color-text)]">{c.label}</span>
                  {c.detail && <span className="text-xs text-[var(--color-muted)]">{c.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-3">
          {conversation.person && (
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void link({ personId: null })}>
              {t('unlinkPerson')}
            </Button>
          )}
          {conversation.lead && (
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void link({ leadId: null })}>
              {t('unlinkLead')}
            </Button>
          )}
          {conversation.related && (
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void link({ related: null })}>
              {t('unlinkRelated')}
            </Button>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
          {t('close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

async function search(kind: Kind, text: string, personId: string | null): Promise<Candidate[]> {
  const q = encodeURIComponent(text);
  if (kind === 'person') {
    const res = await apiClient<{ items: PersonRow[] }>(`/persons?search=${q}&limit=8`);
    return res.items.map((p) => ({
      id: p.id,
      label: `${p.firstName} ${p.lastName}`.trim(),
      detail: [p.email, p.phone].filter(Boolean).join(' · ') || undefined,
    }));
  }
  if (kind === 'property') {
    const res = await apiClient<{ items: PropertyRow[] }>(`/properties?search=${q}&limit=8`);
    return res.items.map((p) => ({ id: p.id, label: p.title, detail: p.city ?? undefined }));
  }
  const res = await apiClient<{ items: ContractRow[] }>(`/contracts?personId=${personId}&limit=20`);
  return res.items.map((c) => ({ id: c.id, label: c.property?.title ?? c.id.slice(0, 8), detail: c.status }));
}
