'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { DragDropProvider } from '@dnd-kit/react';
import { move } from '@dnd-kit/helpers';
import type { UniqueIdentifier } from '@dnd-kit/abstract';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { KanbanColumn } from './kanban-column';
import { KanbanCard } from './kanban-card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListTransition, type ListState } from '@/components/ui/motion';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import type { KanbanLead } from './kanban-card';

/* ──────────── Types ──────────── */

interface Pipeline {
  id: string;
  name: string;
  type: string;
  stages: Stage[];
}

interface Stage {
  id: string;
  name: string;
  sortOrder: number;
  staleDays?: number | null;
}

interface PaginatedLeads {
  items: KanbanLead[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Helpers ──────────── */

function daysAgo(dateStr: string): number {
  const now = new Date();
  const d = new Date(dateStr);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

/** Suma los presupuestos de la etapa agrupados por moneda (etapas con monedas mezcladas son raras, pero no deben informarse mal). */
function stageValueLabel(leadIds: string[], leadMap: Map<string, KanbanLead>): string | null {
  const sums: Record<string, number> = {};
  for (const id of leadIds) {
    const lead = leadMap.get(id);
    if (!lead || lead.budget == null) continue;
    const n = Number(lead.budget);
    if (!Number.isFinite(n) || n === 0) continue;
    const currency = lead.budgetCurrency || 'ARS';
    sums[currency] = (sums[currency] || 0) + n;
  }
  const parts = Object.entries(sums).map(([currency, total]) => {
    const symbol = currency === 'USD' ? 'US$' : '$';
    return `${symbol} ${total.toLocaleString('es-AR')}`;
  });
  return parts.length ? parts.join(' + ') : null;
}

/* ──────────── Skeletons ──────────── */

function ColumnSkeleton() {
  return (
    <div className="flex min-w-[280px] w-[280px] max-w-[320px] shrink-0 flex-col" aria-hidden="true">
      <div className="mb-2 flex items-center justify-between px-3 py-2.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-5 w-7 rounded-full" />
      </div>
      <div
        className="flex-1 space-y-2 rounded-[var(--radius-xl)] bg-[var(--color-bg)] p-2"
        style={{ minHeight: '120px' }}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="space-y-2 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          >
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
            <Skeleton className="h-3 w-1/2" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-14 rounded-full" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="rail-scroll -mx-2 flex gap-4 overflow-x-auto px-2 pb-4">
      {Array.from({ length: count }).map((_, i) => (
        <ColumnSkeleton key={i} />
      ))}
    </div>
  );
}

/* ──────────── Component ──────────── */

export function KanbanBoard() {
  const t = useTranslations('kanban');
  const tSources = useTranslations('leads.sources');

  // ─── Datos de pipelines ─────────────────────────
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>('');
  const [pipelinesLoading, setPipelinesLoading] = useState(true);

  // ─── Datos de leads ─────────────────────────────
  const [leadsLoading, setLeadsLoading] = useState(true);
  const [leadMap, setLeadMap] = useState<Map<string, KanbanLead>>(new Map());

  // ─── Estado de dnd-kit: Record<stageId, leadId[]> ──
  const [items, setItems] = useState<Record<UniqueIdentifier, UniqueIdentifier[]>>({});
  const snapshotRef = useRef<Record<UniqueIdentifier, UniqueIdentifier[]>>({});

  // ─── Error de movimiento, para el toast ─────────
  const [moveError, setMoveError] = useState<string | null>(null);

  // Derivado: pipeline seleccionado
  const selectedPipeline = useMemo(
    () => pipelines.find(p => p.id === selectedPipelineId),
    [pipelines, selectedPipelineId],
  );

  // Grupos del toggle: Alquiler vs Venta
  const alquilerPipelines = useMemo(() => pipelines.filter(p => p.type === 'Alquiler'), [pipelines]);
  const ventaPipelines = useMemo(() => pipelines.filter(p => p.type === 'Venta'), [pipelines]);

  // ─── Carga de pipelines ─────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setPipelinesLoading(true);
      try {
        const data = await apiClient<Pipeline[]>('/pipelines');
        const list = Array.isArray(data) ? data : [];
        if (!cancelled) {
          setPipelines(list);
          if (list.length > 0) {
            setSelectedPipelineId(list[0].id);
          }
        }
      } catch (err) {
        console.error('[KanbanBoard] pipeline fetch error:', err);
        if (!cancelled) setPipelines([]);
      } finally {
        if (!cancelled) setPipelinesLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ─── Carga de leads al cambiar de pipeline ──────
  useEffect(() => {
    if (!selectedPipelineId) return;
    let cancelled = false;

    async function loadLeads() {
      setLeadsLoading(true);
      try {
        const params = new URLSearchParams({
          pipelineId: selectedPipelineId,
          limit: '500',
          isActive: 'true',
        });
        const data = await apiClient<PaginatedLeads>(`/leads?${params.toString()}`);
        if (cancelled) return;

        const leads = data.items || [];

        const newLeadMap = new Map<string, KanbanLead>();
        for (const lead of leads) {
          newLeadMap.set(lead.id, lead);
        }
        setLeadMap(newLeadMap);

        const pipeline = pipelines.find(p => p.id === selectedPipelineId);
        if (!pipeline) return;

        const grouped: Record<string, string[]> = {};
        for (const stage of pipeline.stages) {
          grouped[stage.id] = [];
        }
        for (const lead of leads) {
          const stageId = lead.currentStage?.id;
          if (stageId && grouped[stageId]) {
            grouped[stageId].push(lead.id);
          }
        }
        setItems(grouped);
      } catch (err) {
        console.error('[KanbanBoard] leads fetch error:', err);
        if (!cancelled) {
          setLeadMap(new Map());
          setItems({});
        }
      } finally {
        if (!cancelled) setLeadsLoading(false);
      }
    }
    loadLeads();
    return () => { cancelled = true; };
  }, [selectedPipelineId, pipelines]);

  // ─── Mutación de cambio de etapa ────────────────
  const stageMoveMutation = useMutation({
    mutationFn: async ({ leadId, newStageId }: { leadId: string; newStageId: string }) => {
      return apiClient(`/leads/${leadId}/stage`, {
        method: 'PATCH',
        body: JSON.stringify({ newStageId }),
      });
    },
    onError: (error, variables) => {
      // Vuelve al snapshot ante un error
      setItems(snapshotRef.current);

      const stageName = selectedPipeline?.stages.find(s => s.id === variables.newStageId)?.name || variables.newStageId;
      const errorMsg = error instanceof ApiRequestError
        ? `[KanbanBoard] Stage move failed: ${error.statusCode} ${error.errorCode} — lead=${variables.leadId} stage=${variables.newStageId}`
        : `[KanbanBoard] Stage move failed — lead=${variables.leadId} stage=${variables.newStageId}`;
      console.error(errorMsg, error);

      setMoveError(t('drag.rollback', { stage: stageName }));
      setTimeout(() => setMoveError(null), 4000);
    },
  });

  // ─── Handlers de dnd ─────────────────────────────
  // El estado ordenable vive en `items` (Record<stageId, leadId[]>), el
  // helper `move` de dnd-kit lo reordena durante el arrastre y la mutación
  // solo se dispara cuando una tarjeta efectivamente cambia de columna.

  const handleDragStart = useCallback(() => {
    snapshotRef.current = { ...items };
    for (const key of Object.keys(snapshotRef.current)) {
      snapshotRef.current[key] = [...snapshotRef.current[key]];
    }
  }, [items]);

  const handleDragOver = useCallback((event: any) => {
    // No maneja arrastres de columna (las columnas no son arrastrables)
    if (event.source?.type === 'column') return;
    setItems(currentItems => move(currentItems, event));
  }, []);

  const handleDragEnd = useCallback((event: any) => {
    if (event.canceled) {
      setItems(snapshotRef.current);
      return;
    }

    const leadId = String(event.source?.id || '');
    if (!leadId) return;

    let newStageId = '';
    for (const [stageId, leadIds] of Object.entries(items)) {
      if ((leadIds as string[]).includes(leadId)) {
        newStageId = stageId;
        break;
      }
    }

    let originalStageId = '';
    for (const [stageId, leadIds] of Object.entries(snapshotRef.current)) {
      if ((leadIds as string[]).includes(leadId)) {
        originalStageId = stageId;
        break;
      }
    }

    if (newStageId && newStageId !== originalStageId) {
      stageMoveMutation.mutate({ leadId, newStageId });
    }
  }, [items, stageMoveMutation]);

  const handlePipelineSelect = useCallback((pipelineId: string) => {
    setSelectedPipelineId(pipelineId);
  }, []);

  const sortedStages = selectedPipeline
    ? [...selectedPipeline.stages].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const pipelinesState: ListState = pipelinesLoading ? 'loading' : pipelines.length === 0 ? 'empty' : 'ready';
  const boardState: ListState = leadsLoading ? 'loading' : 'ready';

  return (
    <div className="space-y-4">
      <ListTransition
        state={pipelinesState}
        skeleton={
          <div className="space-y-6" aria-hidden="true">
            <Skeleton className="h-8 w-48" />
            <BoardSkeleton />
          </div>
        }
        empty={
          <EmptyState
            iconName="pipeline"
            title={t('empty.title')}
            subtitle={t('empty.noPipelines')}
            steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
          />
        }
      >
        <div className="space-y-4">
          {/* Toggle de pipeline */}
          <div className="flex items-center gap-2">
            {alquilerPipelines.length > 0 && ventaPipelines.length > 0 ? (
              <div className="flex gap-1 rounded-[var(--radius-lg)] bg-[var(--color-bg)] p-1">
                {pipelines.map(pipeline => (
                  <button
                    key={pipeline.id}
                    onClick={() => handlePipelineSelect(pipeline.id)}
                    className={cn(
                      'rounded-[var(--radius-md)] px-4 py-1.5 text-sm font-medium transition-colors',
                      selectedPipelineId === pipeline.id
                        ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-[var(--shadow-sm)]'
                        : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
                    )}
                  >
                    {pipeline.name}
                  </button>
                ))}
              </div>
            ) : (
              /* Un solo pipeline — solo muestra el nombre */
              <h2 className="text-sm font-medium text-[var(--color-muted)]">{selectedPipeline?.name}</h2>
            )}
          </div>

          {/* Toast de error */}
          {moveError && (
            <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] px-4 py-2.5 text-sm text-[color-mix(in_oklab,var(--color-danger)_75%,var(--color-text))] animate-slide-down">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              {moveError}
            </div>
          )}

          {/* Tablero Kanban de escritorio */}
          <div className="hidden lg:block">
            <ListTransition state={boardState} skeleton={<BoardSkeleton count={sortedStages.length || 4} />} empty={null}>
              <DragDropProvider
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
              >
                <div className="rail-scroll -mx-2 flex gap-4 overflow-x-auto px-2 pb-4">
                  {sortedStages.map(stage => {
                    const stageLeadIds = (items[stage.id] || []) as string[];
                    return (
                      <KanbanColumn
                        key={stage.id}
                        id={stage.id}
                        stageName={stage.name}
                        leadCount={stageLeadIds.length}
                        totalValueLabel={stageValueLabel(stageLeadIds, leadMap)}
                      >
                        {stageLeadIds.map((leadId, index) => {
                          const lead = leadMap.get(leadId);
                          if (!lead) return null;
                          return (
                            <KanbanCard
                              key={leadId}
                              id={leadId}
                              index={index}
                              column={stage.id}
                              lead={lead}
                              staleDays={stage.staleDays}
                            />
                          );
                        })}
                      </KanbanColumn>
                    );
                  })}
                </div>
              </DragDropProvider>
            </ListTransition>
          </div>

          {/* Fallback móvil: lista agrupada por acordeón */}
          <div className="lg:hidden space-y-3">
            {leadsLoading ? (
              <div className="space-y-3" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <Skeleton className="mb-3 h-5 w-40" />
                    <div className="space-y-2">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              sortedStages.map(stage => {
                const stageLeadIds = (items[stage.id] || []) as string[];
                return (
                  <details key={stage.id} open={stageLeadIds.length > 0} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 transition-colors hover:bg-[var(--color-bg)] [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-[var(--color-muted)] transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                        <span className="text-sm font-semibold text-[var(--color-text)]">{stage.name}</span>
                      </div>
                      <span className="inline-flex h-5 min-w-[28px] items-center justify-center rounded-full bg-[var(--color-bg)] px-1.5 text-xs font-medium tabular-nums text-[var(--color-muted)]">
                        {stageLeadIds.length}
                      </span>
                    </summary>
                    <div className="mt-2 space-y-2 pl-2 pr-1">
                      {stageLeadIds.length === 0 ? (
                        <p className="py-3 text-center text-xs text-[var(--color-muted)]">{t('column.empty')}</p>
                      ) : (
                        stageLeadIds.map(leadId => {
                          const lead = leadMap.get(leadId);
                          if (!lead) return null;
                          return (
                            <MobileLeadCard key={leadId} lead={lead} tSources={tSources} staleDays={stage.staleDays} />
                          );
                        })
                      )}
                    </div>
                  </details>
                );
              })
            )}
          </div>
        </div>
      </ListTransition>
    </div>
  );
}

/* ──────────── Tarjeta móvil (simplificada) ──────────── */

function MobileLeadCard({ lead, tSources, staleDays }: { lead: KanbanLead; tSources: any; staleDays?: number | null }) {
  const t = useTranslations('kanban.card');

  const fullName = `${lead.person.firstName} ${lead.person.lastName}`;
  const propertyName = lead.property?.title || t('noProperty');
  const days = daysAgo(lead.updatedAt);

  const contactDays = daysAgo(lead.lastContactAt ?? lead.updatedAt);
  const isStale = staleDays != null && contactDays > staleDays;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-lg)] border bg-[var(--color-surface)] p-3',
        isStale ? 'border-[color-mix(in_oklab,var(--color-warning)_45%,var(--color-border))]' : 'border-[var(--color-border)]',
      )}
    >
      <Avatar name={fullName} seed={lead.person.id || fullName} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-text)]">{fullName}</p>
        <p className="truncate text-xs text-[var(--color-muted)]">{propertyName}</p>
      </div>
      <div className="shrink-0 text-right">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-muted)]">
          {tSources(lead.source as any)}
        </span>
        <div className="mt-0.5 flex items-center justify-end gap-1">
          {isStale && (
            <span
              className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold"
              style={{
                backgroundColor: 'color-mix(in oklab, var(--color-warning) 16%, var(--color-surface))',
                color: 'color-mix(in oklab, var(--color-warning) 75%, var(--color-text))',
              }}
            >
              {t('stale')}
            </span>
          )}
          <p className="text-[11px] tabular-nums text-[var(--color-muted)]">
            {t('daysInStage', { days })}
          </p>
        </div>
      </div>
    </div>
  );
}
