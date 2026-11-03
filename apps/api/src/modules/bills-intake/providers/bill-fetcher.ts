import type { BillProviderKey } from '@realfy/shared';

/** El servicio que se consulta: lo que un conector necesita saber de él. */
export interface BillFetchTarget {
  id: string;
  propertyId: string;
  providerKey: string;
  /** Identificador de cuenta normalizado según el catálogo. */
  accountNumber: string;
}

export interface BillFetchContext {
  tenantId: string;
  now: Date;
}

/** Un PDF que un conector trajo del proveedor. */
export interface FetchedDocument {
  fileName: string;
  content: Buffer;
}

/**
 * Conector de consulta (canal `Consulta`, ADR-0018): trae los documentos de un servicio
 * de su proveedor. No interpreta nada: lo que devuelve entra al mismo circuito que un
 * archivo subido. Lanza `BillFetchBlockedError` si el proveedor lo bloquea (captcha,
 * filtro por país, límite de uso): el intento queda registrado como `Bloqueado`.
 */
export interface BillFetcher {
  providerKey: BillProviderKey;
  fetch(target: BillFetchTarget, ctx: BillFetchContext): Promise<FetchedDocument[]>;
}

/** El proveedor rechazó la consulta; no es un error del conector. */
export class BillFetchBlockedError extends Error {
  constructor(
    message: string,
    readonly code = 'BLOCKED',
  ) {
    super(message);
    this.name = 'BillFetchBlockedError';
  }
}
