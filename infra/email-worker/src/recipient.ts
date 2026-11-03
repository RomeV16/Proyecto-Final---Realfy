export type RouteKind = 'bills' | 'inbox';

export interface Route {
  kind: RouteKind;
  /** `<slug>` de `boletas+<slug>@` / `consultas+<slug>@`; null si la casilla no lo trae. */
  slug: string | null;
}

const LOCAL_PART = /^(boletas|consultas)(?:\+([a-z0-9-]+))?$/;

/** Qué circuito corresponde a la dirección de destino; null si no es boletas@ ni consultas@. */
export function parseRecipient(address: string): Route | null {
  const at = address.trim().toLowerCase().lastIndexOf('@');
  if (at < 1) return null;
  const match = LOCAL_PART.exec(address.trim().toLowerCase().slice(0, at));
  if (!match) return null;
  return { kind: match[1] === 'boletas' ? 'bills' : 'inbox', slug: match[2] ?? null };
}
