/** Variables y secretos del Worker (ver wrangler.toml y README.md). */
export interface Env {
  /** Origen de la API, sin la ruta `/api` (por ejemplo `https://api.realfy.app`). */
  API_BASE_URL: string;
  /** Secreto con que la API verifica la firma (el mismo `INBOX_EMAIL_INGEST_SECRET` del servicio `api`). */
  INBOX_EMAIL_INGEST_SECRET: string;
  /** Inmobiliaria de las casillas sin `+<slug>`. */
  DEFAULT_TENANT_SLUG?: string;
  /** Dirección verificada a la que se reenvía lo que no es boletas@ ni consultas@. */
  FALLBACK_FORWARD_TO?: string;
}

/** Lo que el Worker usa del mensaje de Email Routing (subconjunto de `ForwardableEmailMessage`). */
export interface InboundEmail {
  /** Remitente del sobre. */
  readonly from: string;
  /** Destinatario del sobre, con el `+<slug>` si lo trae. */
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
}
