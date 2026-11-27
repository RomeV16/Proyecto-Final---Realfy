/**
 * Navegación dura del navegador (recarga completa). Vive aparte para que las
 * pantallas que la usan se puedan probar sin que jsdom intente navegar.
 */
export function replaceLocation(url: string): void {
  window.location.replace(url);
}

export function assignLocation(url: string): void {
  window.location.assign(url);
}
