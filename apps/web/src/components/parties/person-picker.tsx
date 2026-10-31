'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { personName, type PartyPerson } from './parties';

interface PersonPickerProps {
  label: string;
  value: PartyPerson | null;
  onChange: (person: PartyPerson | null) => void;
  error?: string;
  disabled?: boolean;
  /** Personas que no se ofrecen (por ejemplo, el propio poderdante). */
  excludeIds?: string[];
}

/** Selector de persona con búsqueda: escribe, elige un resultado y queda fijada hasta que se cambia. */
export function PersonPicker({ label, value, onChange, error, disabled, excludeIds = [] }: PersonPickerProps) {
  const t = useTranslations('parties.picker');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PartyPerson[] | null>(null);
  const [searching, setSearching] = useState(false);
  const request = useRef(0);

  async function search(text: string) {
    setQuery(text);
    const current = ++request.current;
    if (text.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await apiClient<{ items: PartyPerson[] }>(
        `/persons?search=${encodeURIComponent(text.trim())}&limit=8`,
      );
      if (current === request.current) setResults(res.items ?? []);
    } catch {
      if (current === request.current) setResults([]);
    } finally {
      if (current === request.current) setSearching(false);
    }
  }

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3.5 py-2 text-sm">
          <span className="font-medium text-[var(--color-text)]">{personName(value)}</span>
          {!disabled && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label={t('change', { name: personName(value) })}>
              {t('changeShort')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const visible = (results ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <div>
      <FormField label={label} error={error} hint={t('hint')}>
        {(c) => (
          <Input
            {...c}
            value={query}
            onChange={(e) => void search(e.target.value)}
            placeholder={t('placeholder')}
            autoComplete="off"
            disabled={disabled}
          />
        )}
      </FormField>
      {searching && <p className="mt-1 text-xs text-[var(--color-muted)]">{t('searching')}</p>}
      {results && !searching && visible.length === 0 && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{t('noResults')}</p>
      )}
      {visible.length > 0 && (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm" aria-label={t('results')}>
          {visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(p);
                  setQuery('');
                  setResults(null);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-sunken)] focus-visible:outline-2 focus-visible:outline-brand-500"
              >
                <span className="font-medium text-[var(--color-text)]">{personName(p)}</span>
                {(p.cuit || p.dni) && <span className="ml-2 text-xs text-[var(--color-muted)]">{p.cuit || p.dni}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
