import { apiBlob } from './api-client';
import { portalApiBlob } from './portal-api-client';
import type { BlobResult } from './create-api-client';

export interface DownloadOptions {
  /** Método y cuerpo del pedido (p. ej. POST para generar un documento). */
  init?: RequestInit;
  /** Usa la sesión del portal en lugar de la del personal. */
  portal?: boolean;
  /** Si el servidor manda `Content-Disposition`, su nombre pisa al sugerido. */
  preferServerName?: boolean;
}

/** Entrega el blob al navegador con un enlace temporal. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Descarga un archivo de la API con la sesión vigente: pasa por el mismo
 * cliente que el resto de las llamadas, así que renueva el token ante un 401
 * y devuelve errores normalizados. Lanza `ApiRequestError` si falla.
 */
export async function downloadFile(
  path: string,
  filename: string,
  options: DownloadOptions = {},
): Promise<void> {
  const { init = {}, portal = false, preferServerName = false } = options;
  const result: BlobResult = portal
    ? await portalApiBlob(path, init)
    : await apiBlob(path, init);
  saveBlob(result.blob, preferServerName ? (result.filename ?? filename) : filename);
}
