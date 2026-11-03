import type { z } from 'zod';
import type { BillChannel, ServiceType } from '@realfy/shared';
import type { BillProviderKey, FetchedBillData } from '@realfy/shared';

/**
 * Un proveedor del catálogo de boletas (ADR-0018). Sumar uno es agregar un archivo a
 * `providers/` con su definición, registrarlo en `providers/index.ts` y escribir su prueba.
 */
export interface BillProviderDefinition {
  key: BillProviderKey;
  name: string;
  serviceTypes: ServiceType[];
  /** Formato del identificador de cuenta; el resultado es el valor normalizado. */
  accountSchema: z.ZodType<string, z.ZodTypeDef, unknown>;
  /** Canales por los que el proveedor entrega boletas. */
  channels: BillChannel[];
  /** Expresiones que reconocen un documento del proveedor por su texto. */
  signatures: RegExp[];
  /** Lee el texto del documento; `null` si no hay nada que leer. */
  parse(text: string): FetchedBillData | null;
}
