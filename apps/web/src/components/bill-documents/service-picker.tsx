'use client';

import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface PickerService {
  id: string;
  serviceType: string;
  providerName: string | null;
  accountNumber: string | null;
  property: { id: string; title: string } | null;
}

const PAGE = 100;
const MAX_PAGES = 10;

/** Todos los servicios activos (la API no busca por texto: se piden por páginas y se filtran acá). */
async function loadServices(): Promise<PickerService[]> {
  const all: PickerService[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await apiClient<{ items: PickerService[]; totalPages: number }>(
      `/services?isActive=true&limit=${PAGE}&page=${page}`,
    );
    all.push(...res.items);
    if (page >= res.totalPages) break;
  }
  return all;
}

interface ServicePickerProps {
  value: string;
  onChange: (serviceId: string) => void;
}

/**
 * Selector de servicio con búsqueda: un campo de texto que filtra (por propiedad, proveedor, tipo o cuenta) la lista
 * de servicios activos. La lista es un `<select>` nativo, así que se maneja con teclado y lector de pantalla.
 */
export function ServicePicker({ value, onChange }: ServicePickerProps) {
  const t = useTranslations('billDocuments.servicePicker');
  const tTypes = useTranslations('services.serviceTypes');
  const id = useId();
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: ['bill-documents', 'services'], queryFn: loadServices, staleTime: 60_000 });

  const label = (s: PickerService) =>
    t('option', {
      property: s.property?.title ?? '—',
      type: tTypes(s.serviceType),
      provider: s.providerName ? ` · ${s.providerName}` : '',
      account: s.accountNumber ? ` · ${s.accountNumber}` : '',
    });

  const options = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const items = (query.data ?? []).map((s) => ({ id: s.id, text: label(s) }));
    return needle ? items.filter((o) => o.text.toLowerCase().includes(needle) || o.id === value) : items;
    // `label` depende sólo de las traducciones, que no cambian mientras el selector está abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, search, value]);

  return (
    <div className="space-y-2">
      <label htmlFor={`${id}-search`} className="text-sm font-medium text-[var(--color-text)]">
        {t('label')} <span aria-hidden="true">*</span>
      </label>
      <Input
        id={`${id}-search`}
        type="search"
        value={search}
        placeholder={t('search')}
        aria-label={t('search')}
        aria-describedby={`${id}-hint`}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p id={`${id}-hint`} className="text-xs text-[var(--color-muted)]">
        {query.isPending ? t('loading') : t('searchHint')}
      </p>
      {query.error != null && <p role="alert" className="text-sm text-[var(--color-danger)]">{t('loadError')}</p>}
      <Select
        aria-label={t('list')}
        aria-required="true"
        size={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-auto"
      >
        {options.length === 0 && !query.isPending && <option disabled value="">{t('none')}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.text}
          </option>
        ))}
      </Select>
    </div>
  );
}
