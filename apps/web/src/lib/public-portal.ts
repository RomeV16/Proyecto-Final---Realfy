import { cache } from 'react';

/**
 * Cliente para el portal público de una inmobiliaria. Corre en el servidor:
 * las páginas de `/[locale]/p/[slug]` son Server Components y resuelven sus
 * datos acá antes de renderizar, sin pasar por el navegador.
 */

const API_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:3001';
const PUBLIC_API_BASE = `${API_TARGET}/api/public`;

export interface RealtorProfile {
  id: string;
  name: string;
  slug: string;
  province?: string | null;
  logoUrl?: string | null;
  brandPrimary?: string | null;
  brandSecondary?: string | null;
}

export interface PublicPropertyListItem {
  id: string;
  title: string;
  type: string;
  /** Nula solo en teoría: el listado siempre filtra por operaciones disponibles. */
  operationType: string | null;
  price?: number | string | null;
  currency?: string | null;
  city?: string | null;
  province?: string | null;
  street?: string | null;
  area?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  garages?: number | null;
  coverUrl?: string | null;
  mediaCount: number;
}

export interface PublicPropertyMedia {
  url: string;
  thumbnailUrl?: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

export interface PublicPropertyDetail extends PublicPropertyListItem {
  description?: string | null;
  amenities: string[];
  media: PublicPropertyMedia[];
}

export interface PublicPropertyPage {
  items: PublicPropertyListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface PublicPropertyFilters {
  operation?: string;
  type?: string;
  city?: string;
  page?: number;
  limit?: number;
}

/**
 * Se memoiza con `cache()` porque el layout y la página del mismo request
 * piden el mismo perfil — así queda un único fetch por render en vez de dos.
 */
export const getRealtorProfile = cache(async (slug: string): Promise<RealtorProfile | null> => {
  const res = await fetch(`${PUBLIC_API_BASE}/${slug}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`No se pudo obtener el perfil de la inmobiliaria (${res.status})`);
  }
  return res.json();
});

export async function getPublicProperties(
  slug: string,
  filters: PublicPropertyFilters,
): Promise<PublicPropertyPage> {
  const limit = filters.limit || 12;
  const page = filters.page || 1;

  const params = new URLSearchParams();
  if (filters.operation) params.set('operation', filters.operation);
  if (filters.type) params.set('type', filters.type);
  if (filters.city) params.set('city', filters.city);
  params.set('page', String(page));
  params.set('limit', String(limit));

  const res = await fetch(`${PUBLIC_API_BASE}/${slug}/properties?${params.toString()}`, {
    cache: 'no-store',
  });

  // Un slug válido pero con un error transitorio del lado de la API no
  // debería tirar abajo toda la portada: se muestra la grilla vacía.
  if (!res.ok) {
    return { items: [], total: 0, page, limit };
  }

  return res.json();
}

export async function getPublicProperty(
  slug: string,
  id: string,
): Promise<PublicPropertyDetail | null> {
  const res = await fetch(`${PUBLIC_API_BASE}/${slug}/properties/${id}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`No se pudo obtener la propiedad (${res.status})`);
  }
  return res.json();
}
