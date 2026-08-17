import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LanguageModelRole = 'system' | 'user' | 'assistant';

export interface LanguageModelMessage {
  role: LanguageModelRole;
  content: string;
}

export interface LanguageModelOptions {
  /** Pide la respuesta como un único objeto JSON en lugar de texto libre. */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface LanguageModelResult {
  /** Contenido del primer mensaje devuelto, sin post-procesar. */
  text: string;
  /** Modelo que efectivamente respondió, para poder atribuir el resultado. */
  model: string;
}

const DEFAULT_BASE_URL = 'https://api.minimax.io/v1';
const DEFAULT_MODEL = 'MiniMax-M2';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1200;

/**
 * Cliente de modelo de lenguaje.
 *
 * Habla el protocolo `POST {base}/chat/completions` con `Authorization: Bearer`,
 * que es el que exponen tanto MiniMax como el resto de los proveedores
 * compatibles, así que cambiar de proveedor es cambiar `AI_BASE_URL` y
 * `AI_MODEL` sin tocar código.
 *
 * Configuración (todas opcionales):
 *   AI_BASE_URL    raíz de la API            (por defecto https://api.minimax.io/v1)
 *   AI_MODEL       identificador del modelo  (por defecto MiniMax-M2)
 *   AI_API_KEY     credencial; vacía deshabilita el cliente
 *   AI_TIMEOUT_MS  tiempo máximo de espera   (por defecto 20000)
 *
 * La credencial se resuelve en el primer uso y no en el arranque: una instancia
 * sin `AI_API_KEY` tiene que levantar igual, y quien consulte al cliente recibe
 * `null` para poder seguir por su propio camino. `complete()` nunca lanza:
 * cualquier falla de red, corte por tiempo o respuesta inesperada se registra y
 * se devuelve como `null`.
 */
@Injectable()
export class LanguageModelClient {
  private readonly logger = new Logger(LanguageModelClient.name);

  constructor(private readonly config: ConfigService) {}

  /** Hay credencial configurada, así que vale la pena intentar la llamada. */
  get isEnabled(): boolean {
    return this.apiKey().length > 0;
  }

  /** Modelo configurado, incluso si el cliente está deshabilitado. */
  get model(): string {
    return this.config.get<string>('AI_MODEL')?.trim() || DEFAULT_MODEL;
  }

  /**
   * Pide una respuesta al modelo. Devuelve `null` si el cliente está
   * deshabilitado o si la llamada no terminó en una respuesta usable.
   */
  async complete(
    messages: LanguageModelMessage[],
    options: LanguageModelOptions = {},
  ): Promise<LanguageModelResult | null> {
    const apiKey = this.apiKey();
    if (!apiKey) return null;

    const url = `${this.baseUrl()}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (options.json) {
      body.response_format = { type: 'json_object' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(
          `El modelo respondió ${res.status} ${res.statusText} en ${url}`,
        );
        return null;
      }

      const payload = (await res.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: unknown } }>;
      };

      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        this.logger.warn('El modelo respondió sin contenido utilizable');
        return null;
      }

      return { text: content, model: payload.model?.trim() || this.model };
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      this.logger.warn(
        aborted
          ? `La llamada al modelo se cortó a los ${this.timeoutMs()} ms`
          : `La llamada al modelo falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Private ──────────────────────────────────────────

  private apiKey(): string {
    return this.config.get<string>('AI_API_KEY')?.trim() ?? '';
  }

  private baseUrl(): string {
    const raw = this.config.get<string>('AI_BASE_URL')?.trim() || DEFAULT_BASE_URL;
    return raw.replace(/\/+$/, '');
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>('AI_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }
}
