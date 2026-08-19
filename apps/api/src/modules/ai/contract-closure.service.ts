import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AiClosureSummaryResponseSchema,
  ContractClosureMetricsSchema,
  type ClosureSummarySource,
  type ContractClosureMetrics,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractClosureMetricsService } from './contract-closure-metrics.service';
import {
  findUnknownFigure,
  isClosedStatus,
  toClosureFacts,
  type ContractClosureFacts,
} from './contract-closure';
import { renderClosureSummary, type ClosureSummaryText } from './closure-summary-template';
import { LanguageModelClient, parseJsonObject } from './language-model.client';

/** Resumen guardado de un contrato, con todo lo que hace falta para auditarlo. */
export interface ClosureSummaryRecord {
  summary: string;
  highlights: string[];
  /** Las métricas con las que se redactó: el resumen se lee contra ellas. */
  metrics: ContractClosureMetrics;
  /** Lo redactó el modelo de lenguaje o las plantillas propias. */
  source: ClosureSummarySource;
  /** Modelo que redactó, o `null` cuando lo hicieron las plantillas. */
  model: string | null;
  generatedAt: string;
}

export interface ClosureSummaryResult {
  contractId: string;
  /** Estado actual del contrato. */
  status: string;
  /** El contrato está cerrado, así que tiene sentido resumirlo. */
  closed: boolean;
  /** Resumen vigente, o `null` si todavía no se generó ninguno. */
  summary: ClosureSummaryRecord | null;
}

/** Una ficha abierta no tiene que ir a la base en cada pintada. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Largos que acepta el esquema compartido para el texto del resumen. */
const MAX_SUMMARY_CHARS = 1800;
const MAX_HIGHLIGHT_CHARS = 200;
const MAX_HIGHLIGHTS = 5;

/**
 * Recorta el resumen al último punto que entra dentro del largo aceptado, en
 * lugar de cortar una oración a la mitad, y deja los primeros destacados válidos.
 *
 * Es tolerancia sobre la forma, no sobre el contenido: la verificación de que no
 * haya cifras ajenas a las métricas corre después, sobre el texto ya recortado.
 */
function clampSummaryText(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const { summary, highlights, ...rest } = payload as Record<string, unknown>;

  let clampedSummary = summary;
  if (typeof summary === 'string' && summary.trim().length > MAX_SUMMARY_CHARS) {
    const recorte = summary.trim().slice(0, MAX_SUMMARY_CHARS);
    const ultimoPunto = recorte.lastIndexOf('.');
    clampedSummary = ultimoPunto > MAX_SUMMARY_CHARS / 2 ? recorte.slice(0, ultimoPunto + 1) : recorte;
  }

  const clampedHighlights = Array.isArray(highlights)
    ? highlights
        .map((h) => (typeof h === 'string' ? h.trim().slice(0, MAX_HIGHLIGHT_CHARS) : h))
        .filter((h) => typeof h !== 'string' || h.length >= 4)
        .slice(0, MAX_HIGHLIGHTS)
    : highlights;

  return { ...rest, summary: clampedSummary, highlights: clampedHighlights };
}

const SYSTEM_PROMPT = [
  'Sos el redactor de informes de gestión de una inmobiliaria argentina.',
  'Recibís las métricas de un contrato que acaba de cerrarse, ya calculadas por el sistema',
  'y sin ningún dato de las personas involucradas.',
  'Tu único trabajo es redactarlas en prosa: no calculás, no estimás y no deducís ninguna cifra.',
  'Cada número que escribís tiene que estar tal cual en la grilla que recibís.',
  'Respondés únicamente con un objeto JSON, sin texto alrededor y sin bloques de código.',
].join(' ');

function buildUserPrompt(facts: ContractClosureFacts): string {
  return [
    'Métricas del contrato cerrado:',
    JSON.stringify(facts),
    '',
    'Devolvé este JSON exacto:',
    '{"summary":"...","highlights":["...","..."]}',
    '',
    'Reglas:',
    '- "summary" es el resumen de gestión en castellano rioplatense, de tres a cinco párrafos',
    '  separados por una línea en blanco, hasta 1600 caracteres en total.',
    '- Cubrí en ese orden: vigencia y cierre, comportamiento de pago con atrasos y punitorios,',
    '  reclamos de mantenimiento y cómo se resolvieron, ajustes de alquiler y rendiciones.',
    '- "highlights" son entre dos y cuatro puntos cortos, de hasta 200 caracteres cada uno.',
    '- No inventes ni derives cifras: usá sólo los valores de la grilla, sin sumarlos,',
    '  promediarlos ni convertirlos. Si algo no está en la grilla, no lo menciones.',
    '- No nombres personas, propiedades ni domicilios: no los tenés y no hay que suponerlos.',
    '- Se puede opinar sobre lo cualitativo (si el pago fue puntual, si hubo mucho mantenimiento),',
    '  siempre apoyado en los números que están en la grilla.',
  ].join('\n');
}

/**
 * Resumen de gestión al cierre de un contrato.
 *
 * El servicio calcula las métricas de forma determinista y después las hace
 * redactar. La redacción la hace el modelo de lenguaje cuando hay uno
 * configurado y su respuesta valida; en cualquier otro caso — sin credencial,
 * sin respuesta a tiempo, con una respuesta que no cumple el esquema, o con una
 * cifra que no sale de las métricas — la hacen las plantillas propias. Las dos
 * ramas parten de los mismos hechos y `source` dice cuál corrió.
 *
 * El resultado se guarda con las métricas que lo respaldan, así que la ficha lo
 * lee en lugar de recalcularlo, y se puede regenerar a pedido.
 */
@Injectable()
export class ContractClosureService {
  private readonly logger = new Logger(ContractClosureService.name);
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: ClosureSummaryResult }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: ContractClosureMetricsService,
    private readonly languageModel: LanguageModelClient,
  ) {}

  /** Resumen vigente del contrato, tal como quedó guardado. */
  async get(tenantId: string, contractId: string): Promise<ClosureSummaryResult> {
    const key = this.cacheKey(tenantId, contractId);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      select: { id: true, status: true, closureSummary: true },
    });

    if (!contract) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    const result: ClosureSummaryResult = {
      contractId: contract.id,
      status: contract.status,
      closed: isClosedStatus(contract.status),
      summary: this.toRecord(contract.closureSummary),
    };

    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    return result;
  }

  /**
   * Genera el resumen y lo guarda, reemplazando el que hubiera.
   * Sólo tiene sentido sobre un contrato cerrado.
   */
  async generate(tenantId: string, contractId: string): Promise<ClosureSummaryResult> {
    const metrics = await this.metrics.compute(contractId);
    if (!metrics) {
      throw new NotFoundException({
        error: 'CONTRACT_NOT_FOUND',
        message: 'Contract not found',
      });
    }

    if (!isClosedStatus(metrics.closureStatus)) {
      throw new BadRequestException({
        error: 'CONTRACT_NOT_CLOSED',
        message: 'El resumen de gestión se genera sobre contratos cerrados',
      });
    }

    const record = await this.write(tenantId, contractId, metrics);
    this.cache.delete(this.cacheKey(tenantId, contractId));

    return {
      contractId,
      status: metrics.closureStatus,
      closed: true,
      summary: record,
    };
  }

  /**
   * Genera el resumen a raíz del cierre del contrato.
   *
   * Nunca lanza: el cierre de un contrato es la operación importante y no puede
   * quedar trabado porque el resumen falle. Lo que pase se registra, y el resumen
   * se puede pedir de nuevo desde la ficha.
   */
  async generateOnClosure(tenantId: string, contractId: string): Promise<void> {
    try {
      await this.generate(tenantId, contractId);
    } catch (err: unknown) {
      this.logger.warn(
        `No se pudo generar el resumen de cierre del contrato ${contractId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Descarta lo cacheado de un contrato. */
  bust(tenantId: string, contractId: string): void {
    this.cache.delete(this.cacheKey(tenantId, contractId));
  }

  // ─── Private ──────────────────────────────────────────

  private cacheKey(tenantId: string, contractId: string): string {
    return `${tenantId}:${contractId}`;
  }

  /** Redacta y persiste el resumen del contrato. */
  private async write(
    tenantId: string,
    contractId: string,
    metrics: ContractClosureMetrics,
  ): Promise<ClosureSummaryRecord> {
    const facts = toClosureFacts(metrics);
    const fromModel = await this.askModel(facts);
    const text: ClosureSummaryText = fromModel?.text ?? renderClosureSummary(facts);

    const source: ClosureSummarySource = fromModel ? 'model' : 'rules';
    const model = fromModel?.model ?? null;
    const generatedAt = new Date();

    const data = {
      summary: text.summary,
      highlights: text.highlights,
      metrics: metrics as unknown as object,
      source,
      model,
      generatedAt,
    };

    const existing = await this.prisma.client.contractClosureSummary.findFirst({
      where: { contractId },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.client.contractClosureSummary.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.client.contractClosureSummary.create({
        data: { ...data, tenantId, contractId },
      });
    }

    return {
      summary: text.summary,
      highlights: text.highlights,
      metrics,
      source,
      model,
      generatedAt: generatedAt.toISOString(),
    };
  }

  /**
   * Le pide la redacción al modelo. Devuelve `null` en cuanto algo no cierra, y
   * el resumen lo terminan escribiendo las plantillas.
   */
  private async askModel(
    facts: ContractClosureFacts,
  ): Promise<{ model: string; text: ClosureSummaryText } | null> {
    if (!this.languageModel.isEnabled) return null;

    const answer = await this.languageModel.complete(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(facts) },
      ],
      { json: true },
    );
    if (!answer) return null;

    const payload = parseJsonObject(answer.text);
    if (payload === null) {
      this.logger.warn('La respuesta del modelo no contenía un objeto JSON');
      return null;
    }

    // El modelo se sale del rango de largo cada tanto, y eso es cosmético: el
    // resumen se recorta en el último punto que entra y los destacados de sobra
    // se descartan, en lugar de tirar una redacción buena y volver a la plantilla.
    // Lo que no se puede arreglar recortando sí cae a la plantilla, con el detalle
    // de qué campo falló para no tener que adivinarlo desde afuera.
    const validated = AiClosureSummaryResponseSchema.safeParse(clampSummaryText(payload));
    if (!validated.success) {
      const issue = validated.error.issues[0];
      this.logger.warn(
        `La respuesta del modelo no cumple el esquema en ${
          issue.path.join('.') || 'la raíz'
        }: ${issue.message}; redactan las plantillas`,
      );
      return null;
    }

    // Contracara verificable de "el modelo no calcula": si el texto trae una
    // cifra que no está en las métricas, no se publica.
    const invented = [validated.data.summary, ...validated.data.highlights]
      .map((text) => findUnknownFigure(text, facts))
      .find((figure) => figure !== null);

    if (invented) {
      this.logger.warn(
        `El modelo citó una cifra que no sale de las métricas (${invented}); redactan las plantillas`,
      );
      return null;
    }

    return { model: answer.model, text: validated.data };
  }

  /** Convierte la fila guardada al resumen que se expone, validando el JSON. */
  private toRecord(row: {
    summary: string;
    highlights: string[];
    metrics: unknown;
    source: ClosureSummarySource;
    model: string | null;
    generatedAt: Date;
  } | null): ClosureSummaryRecord | null {
    if (!row) return null;

    const metrics = ContractClosureMetricsSchema.safeParse(row.metrics);
    if (!metrics.success) {
      // Un resumen guardado contra una grilla que ya no valida no se muestra:
      // la ficha lo trata como ausente y ofrece generarlo de nuevo.
      this.logger.warn('El resumen guardado tiene métricas que no validan');
      return null;
    }

    return {
      summary: row.summary,
      highlights: row.highlights,
      metrics: metrics.data,
      source: row.source,
      model: row.model,
      generatedAt: row.generatedAt.toISOString(),
    };
  }
}
