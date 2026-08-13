'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  portalApiClient,
  PortalApiRequestError,
} from '@/lib/portal-api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

interface PortalTicket {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  createdAt: string;
  property: {
    id: string;
    title: string | null;
    street: string | null;
    number: string | null;
    city: string | null;
  } | null;
  category: { id: string; name: string; color: string | null } | null;
}

interface TicketsResponse {
  data: PortalTicket[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface PortalContract {
  id: string;
  propertyId: string;
  property: { id: string; name: string | null; address: string | null } | null;
}

interface PortalCategory {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

const STATUS_VARIANT: Record<
  string,
  'neutral' | 'success' | 'warning' | 'danger' | 'info'
> = {
  Abierto: 'info',
  Asignado: 'info',
  EnProgreso: 'warning',
  ProveedorAsignado: 'warning',
  ProveedorEnCamino: 'warning',
  TrabajoRealizado: 'info',
  Resuelto: 'success',
  Cerrado: 'success',
  Cancelado: 'neutral',
  Reabierto: 'warning',
};

export default function PortalTicketsPage() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError } = useQuery<TicketsResponse>({
    queryKey: ['portal', 'tickets'],
    queryFn: () =>
      portalApiClient<TicketsResponse>('/portal/tickets?page=1&limit=20'),
  });

  const statusLabel = (status: string) => {
    const key = `portal.tickets.statuses.${status}`;
    const label = t(key as Parameters<typeof t>[0]);
    return label === key ? status : label;
  };

  const propertyLabel = (p: PortalTicket['property']) => {
    if (!p) return '—';
    const line = [p.street, p.number].filter(Boolean).join(' ');
    return line || p.title || p.city || '—';
  };

  const formatDate = (dateStr: string) =>
    new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(new Date(dateStr));

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{t('portal.common.brand')}</p>
          <h1 className="h2">{t('portal.tickets.title')}</h1>
          <p className="lead mt-2 text-sm">{t('portal.tickets.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setShowForm(true)} className="shrink-0">
          {t('portal.tickets.newTicket')}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : isError ? (
        <div className="card-lux p-6 text-center">
          <p className="text-sm text-[var(--color-muted)]">
            {t('common.error')}
          </p>
        </div>
      ) : data && data.data.length > 0 ? (
        <div className="space-y-3">
          {data.data.map((ticket) => (
            <div key={ticket.id} className="card-lux p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-[var(--color-text)]">
                    {ticket.title}
                  </p>
                  <p className="text-sm text-[var(--color-muted)] mt-0.5 truncate">
                    {propertyLabel(ticket.property)}
                  </p>
                </div>
                <Badge variant={STATUS_VARIANT[ticket.status] ?? 'neutral'}>
                  {statusLabel(ticket.status)}
                </Badge>
              </div>
              {ticket.description && (
                <p className="text-sm text-[var(--color-text)] mt-3 line-clamp-2">
                  {ticket.description}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                {ticket.category && (
                  <span className="micro">{ticket.category.name}</span>
                )}
                {ticket.category && <span className="micro">·</span>}
                <span className="micro">{formatDate(ticket.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-lux p-8 text-center">
          <p className="text-sm text-[var(--color-muted)] mb-4">
            {t('portal.tickets.empty')}
          </p>
          <Button size="sm" onClick={() => setShowForm(true)}>
            {t('portal.tickets.newTicket')}
          </Button>
        </div>
      )}

      {showForm && (
        <NewTicketDialog
          onClose={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ['portal', 'tickets'] });
          }}
        />
      )}
    </div>
  );
}

function NewTicketDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useTranslations();

  const { data: contracts } = useQuery<PortalContract[]>({
    queryKey: ['portal', 'contract'],
    queryFn: () => portalApiClient<PortalContract[]>('/portal/contract'),
  });
  const { data: categories } = useQuery<PortalCategory[]>({
    queryKey: ['portal', 'categories'],
    queryFn: () => portalApiClient<PortalCategory[]>('/portal/categories'),
  });

  const [propertyId, setPropertyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const properties = (contracts ?? []).filter((c) => c.propertyId);
  // Preselect the only property when there's exactly one.
  const effectivePropertyId =
    propertyId || (properties.length === 1 ? properties[0].propertyId : '');

  const mutation = useMutation({
    mutationFn: (payload: {
      propertyId: string;
      title: string;
      description?: string;
      categoryId?: string;
    }) =>
      portalApiClient('/portal/tickets', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: onCreated,
    onError: (err) => {
      setError(
        err instanceof PortalApiRequestError
          ? t('portal.tickets.form.error')
          : t('common.error'),
      );
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!effectivePropertyId) {
      setError(t('portal.tickets.form.propertyRequired'));
      return;
    }
    if (!title.trim()) {
      setError(t('portal.tickets.form.titleRequired'));
      return;
    }
    mutation.mutate({
      propertyId: effectivePropertyId,
      title: title.trim(),
      description: description.trim() || undefined,
      categoryId: categoryId || undefined,
    });
  };

  const selectClass =
    'h-11 w-full rounded-lg border border-[var(--color-border)] px-3.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] focus:border-brand-500';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-[var(--color-surface)] rounded-t-2xl sm:rounded-2xl border border-[var(--color-border)] p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5">
          <h2 className="h3">{t('portal.tickets.newTicket')}</h2>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div className="bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] text-sm rounded-lg px-4 py-3 border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)]">
              {error}
            </div>
          )}

          {properties.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-[0.8rem] font-medium text-[var(--color-text)]">
                {t('portal.tickets.form.property')}
              </label>
              <select
                className={selectClass}
                value={effectivePropertyId}
                onChange={(e) => setPropertyId(e.target.value)}
              >
                <option value="">
                  {t('portal.tickets.form.propertyPlaceholder')}
                </option>
                {properties.map((c) => (
                  <option key={c.id} value={c.propertyId}>
                    {c.property?.address || c.property?.name || c.propertyId}
                  </option>
                ))}
              </select>
            </div>
          )}

          {categories && categories.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[0.8rem] font-medium text-[var(--color-text)]">
                {t('portal.tickets.form.category')}
              </label>
              <select
                className={selectClass}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">
                  {t('portal.tickets.form.categoryPlaceholder')}
                </option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input
            id="ticket-title"
            label={t('portal.tickets.form.title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('portal.tickets.form.titlePlaceholder')}
            maxLength={500}
            autoFocus
          />

          <div className="flex flex-col gap-1">
            <label
              htmlFor="ticket-description"
              className="text-[0.8rem] font-medium text-[var(--color-text)]"
            >
              {t('portal.tickets.form.description')}
            </label>
            <textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('portal.tickets.form.descriptionPlaceholder')}
              rows={4}
              maxLength={10000}
              className="w-full rounded-lg border border-[var(--color-border)] px-3.5 py-2.5 text-sm bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--color-brand-500)_15%,transparent)] focus:border-brand-500 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              {t('portal.tickets.backToList')}
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Spinner className="w-4 h-4 text-white" />}
              {mutation.isPending
                ? t('portal.tickets.form.submitting')
                : t('portal.tickets.form.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
