import { Injectable, Logger } from '@nestjs/common';
import {
  AiPrioritiesResponseSchema,
  type AiPriorityItem,
  type AiPriorityUrgency,
} from '@realfy/shared';
import { DailyContextService } from './daily-context.service';
import {
  toModelFacts,
  type DailyContext,
  type DailyContextFact,
  type DailyContextItem,
  type DailyContextTotals,
  type PriorityKind,
} from './daily-context';
import { LanguageModelClient } from './language-model.client';
import { rankByRules } from './priority-rules';

/** Quién decidió el orden de la lista. */
export type PrioritySource = 'model' | 'rules';

export interface DailyPriority {
  ref: string;
  kind: PriorityKind;
  entityId: string;
  title: string;
  subtitle: string | null;
  urgency: AiPriorityUrgency;
  reason: string;
  action: string;
  amount: number | null;
  currency: string | null;
  daysOverdue: number | null;
  daysToDue: number | null;
  slaHoursOverdue: number | null;
  unassigned: boolean;
  ticketPriority: string | null;
  status: string | null;
  daysSinceContact: number | null;
}

export interface DailyPrioritiesResult {
  generatedAt: string;
  /** Se expone a propósito: la interfaz tiene que poder decir de dónde salió el orden. */
  source: PrioritySource;
  /** Modelo que ordenó la lista, o `null` cuando la ordenaron las reglas. */
  model: string | null;
  totals: DailyContextTotals;
  priorities: DailyPriority[];
}

/** Cuántas prioridades se devuelven como máximo. */
const MAX_PRIORITIES = 10;

/** El contexto se recalcula seguido, pero no una vez por pintada de panel. */
const CACHE_TTL_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = [
  'Sos el asistente de priorización de una inmobiliaria argentina.',
  'Recibís los pendientes del día ya anonimizados: cada uno llega con una referencia',
  'opaca y datos objetivos, sin ningún dato de las personas involucradas.',
  'Tu tarea es ordenarlos de más a menos urgente y explicar cada uno en una línea.',
  'Respondés únicamente con un objeto JSON, sin texto alrededor y sin bloques de código.',
].join(' ');

/** Instrucciones y hechos del día, en el formato que después valida Zod. */
function buildUserPrompt(facts: DailyContextFact[], totals: DailyContextTotals): string {
  return [
    'Pendientes del día:',
    JSON.stringify(facts),
    '',
    'Totales de la cartera:',
    JSON.stringify(totals),
    '',
    'Devolvé este JSON exacto:',
    '{"priorities":[{"ref":"C1","urgency":"alta","reason":"...","action":"..."}]}',
    '',
    'Reglas:',
    '- Usá sólo las referencias que aparecen arriba; no inventes ninguna.',
    '- Incluí todos los pendientes, del más urgente al menos urgente.',
    '- "urgency" es exactamente "alta", "media" o "baja".',
    '- "reason" explica por qué es urgente, en castellano rioplatense, hasta 240 caracteres.',
    '- "action" es el próximo paso concreto, en infinitivo, hasta 160 caracteres.',
    '- No repitas la referencia en el texto ni intentes nombrar a las personas.',
  ].join('\n');
}

/** Aísla el objeto JSON de la respuesta, tolerando cercos de código o preámbulos. */
function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Prioridades del día.
 *
 * El orden lo propone el modelo de lenguaje cuando hay uno configurado y su
 * respuesta valida; en cualquier otro caso — sin credencial, sin respuesta a
 * tiempo, o con una respuesta que no cumple el esquema — lo resuelven las reglas
 * propias. Las dos ramas devuelven la misma estructura y `source` dice cuál
 * corrió.
 *
 * Lo que sale del servidor hacia el modelo pasa antes por `toModelFacts`, que
 * deja únicamente la referencia opaca y los datos objetivos de cada pendiente.
 * Los títulos y las contrapartes se reponen acá, contra el contexto local, una
 * vez que la respuesta volvió.
 */
@Injectable()
export class AiPrioritiesService {
  private readonly logger = new Logger(AiPrioritiesService.name);
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: DailyPrioritiesResult }
  >();

  constructor(
    private readonly context: DailyContextService,
    private readonly languageModel: LanguageModelClient,
  ) {}

  async getDailyPriorities(tenantId: string): Promise<DailyPrioritiesResult> {
    const cached = this.cache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const context = await this.context.build();
    const result = await this.resolve(context);

    this.cache.set(tenantId, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    return result;
  }

  /** Descarta lo cacheado de una inmobiliaria. */
  bust(tenantId: string): void {
    this.cache.delete(tenantId);
  }

  // ─── Private ──────────────────────────────────────────

  private async resolve(context: DailyContext): Promise<DailyPrioritiesResult> {
    const base = {
      generatedAt: context.generatedAt,
      totals: context.totals,
    };

    // Un día sin pendientes no necesita que nadie lo ordene.
    if (context.items.length === 0) {
      return { ...base, source: 'rules', model: null, priorities: [] };
    }

    const fromModel = await this.askModel(context);
    if (fromModel) {
      const priorities = this.rehydrate(fromModel.priorities, context.items);
      if (priorities.length > 0) {
        return { ...base, source: 'model', model: fromModel.model, priorities };
      }
      this.logger.warn(
        'El modelo no devolvió ninguna referencia del contexto; se ordena por reglas',
      );
    }

    return {
      ...base,
      source: 'rules',
      model: null,
      priorities: this.rehydrate(rankByRules(context.items), context.items),
    };
  }

  private async askModel(
    context: DailyContext,
  ): Promise<{ model: string; priorities: AiPriorityItem[] } | null> {
    if (!this.languageModel.isEnabled) return null;

    const facts = toModelFacts(context.items);
    const answer = await this.languageModel.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(facts, context.totals) },
      ],
      { json: true },
    );
    if (!answer) return null;

    const payload = extractJson(answer.text);
    if (payload === null) {
      this.logger.warn('La respuesta del modelo no contenía un objeto JSON');
      return null;
    }

    const validated = AiPrioritiesResponseSchema.safeParse(payload);
    if (!validated.success) {
      this.logger.warn('La respuesta del modelo no cumple el esquema esperado');
      return null;
    }

    return { model: answer.model, priorities: validated.data.priorities };
  }

  /**
   * Repone los datos locales de cada referencia.
   * Una referencia que no salió de este contexto se descarta en silencio: el
   * orden puede venir de afuera, los datos nunca.
   */
  private rehydrate(
    entries: Array<{ ref: string; urgency: AiPriorityUrgency; reason: string; action: string }>,
    items: DailyContextItem[],
  ): DailyPriority[] {
    const byRef = new Map(items.map((item) => [item.ref, item]));
    const seen = new Set<string>();
    const priorities: DailyPriority[] = [];

    for (const entry of entries) {
      const item = byRef.get(entry.ref);
      if (!item || seen.has(entry.ref)) continue;
      seen.add(entry.ref);

      priorities.push({
        ref: item.ref,
        kind: item.kind,
        entityId: item.entityId,
        title: item.title,
        subtitle: item.subtitle,
        urgency: entry.urgency,
        reason: entry.reason,
        action: entry.action,
        amount: item.amount,
        currency: item.currency,
        daysOverdue: item.daysOverdue,
        daysToDue: item.daysToDue,
        slaHoursOverdue: item.slaHoursOverdue,
        unassigned: item.unassigned,
        ticketPriority: item.ticketPriority,
        status: item.status,
        daysSinceContact: item.daysSinceContact,
      });

      if (priorities.length === MAX_PRIORITIES) break;
    }

    return priorities;
  }
}
