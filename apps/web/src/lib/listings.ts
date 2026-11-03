import type { ListingStatus } from '@realfy/shared';

/** Portal del catálogo de la inmobiliaria (el micrositio propio siempre va primero). */
export interface PortalEntry {
  key: string;
  name: string;
  urlTemplate: string | null;
  enabled: boolean;
  builtin: boolean;
}

export interface ListingRow {
  id: string;
  operationType: string;
  portal: string;
  status: ListingStatus;
  effectiveStatus: ListingStatus;
  externalUrl: string | null;
  externalCode: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PropertyListings {
  settings: { expiryWarnDays: number };
  micrositePath: string | null;
  portals: PortalEntry[];
  operations: { operationType: string; state: string }[];
  listings: ListingRow[];
}

export interface PublicationSettings {
  portals: { key: string; name: string; urlTemplate: string | null; enabled: boolean }[];
  hideExactAddress: boolean;
  showMap: boolean;
  expiryWarnDays: number;
  catalog: PortalEntry[];
}

export interface AdCopy {
  propertyId: string;
  portal: string;
  portalName: string;
  operationType: string;
  title: string;
  description: string;
  limits: { title: number; description: number; photos: number };
  photos: { id: string; url: string; position: number }[];
  omittedPhotos: number;
  warnings: string[];
}

export interface OverviewListing {
  listingId: string;
  propertyId: string;
  title: string;
  operationType: string;
  portal: string;
  portalName: string;
  status: ListingStatus;
  expiresAt: string | null;
  externalUrl: string | null;
  operationState: string | null;
}

export interface ListingsOverview {
  expiryWarnDays: number;
  counts: { notPublished: number; expiring: number; expired: number; shouldPause: number; published: number };
  perPortal: { portal: string; portalName: string; count: number }[];
  notPublished: { propertyId: string; title: string; type: string; city: string | null; operationType: string }[];
  expiring: OverviewListing[];
  expired: OverviewListing[];
  shouldPause: OverviewListing[];
}

/** Sólo http(s): una dirección de aviso cargada a mano no se linkea si trae otro esquema. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

/** `2026-11-30T00:00:00.000Z` -> `2026-11-30` (lo que espera un input de fecha). */
export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** Copia al portapapeles; devuelve false si el navegador no lo permite. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
