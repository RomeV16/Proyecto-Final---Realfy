import { z } from 'zod';
import { ListingStatus, PropertyOperationType } from '../enums';

export { ListingStatus };

/** Clave del portal propio: el micrositio de la inmobiliaria. Siempre existe y no se configura. */
export const MICROSITE_PORTAL_KEY = 'micrositio';

const portalKey = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{1,29}$/, { message: 'portal key must be lowercase letters, digits or dashes' });

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), { message: 'must be an http(s) URL' });

export const PortalConfigSchema = z
  .object({
    key: portalKey.refine((k) => k !== MICROSITE_PORTAL_KEY, {
      message: 'micrositio is the built-in portal',
    }),
    name: z.string().trim().min(1).max(60),
    /** Dirección del aviso en el portal; `{code}` se reemplaza por el código del aviso. */
    urlTemplate: z
      .string()
      .trim()
      .max(300)
      .refine((v) => /^https?:\/\/[^\s]+$/i.test(v), { message: 'must be an http(s) URL' })
      .nullable()
      .default(null),
    enabled: z.boolean().default(true),
  })
  .strict();

export type PortalConfig = z.infer<typeof PortalConfigSchema>;

export const DEFAULT_PORTALS: PortalConfig[] = [
  { key: 'zonaprop', name: 'Zonaprop', urlTemplate: null, enabled: true },
  { key: 'argenprop', name: 'Argenprop', urlTemplate: null, enabled: true },
  { key: 'mercadolibre', name: 'MercadoLibre', urlTemplate: null, enabled: true },
  { key: 'lavoz', name: 'Clasificados La Voz', urlTemplate: null, enabled: true },
];

/**
 * Publicación de la inmobiliaria (dentro de Tenant.operationalDefaults.publication).
 * Los portales son una lista configurable; el micrositio propio se suma siempre.
 */
export const PublicationSettingsSchema = z
  .object({
    portals: z
      .array(PortalConfigSchema)
      .max(20)
      .default(DEFAULT_PORTALS)
      .refine((list) => new Set(list.map((p) => p.key)).size === list.length, {
        message: 'portal keys must be unique',
      }),
    /** Los avisos y el micrositio muestran sólo la zona, nunca calle ni altura. */
    hideExactAddress: z.boolean().default(true),
    /** El micrositio muestra un mapa de la zona (coordenadas redondeadas). */
    showMap: z.boolean().default(false),
    /** Días antes del vencimiento en que un aviso aparece como "por vencer". */
    expiryWarnDays: z.number().int().min(1).max(60).default(7),
  })
  .strict();

export type PublicationSettings = z.infer<typeof PublicationSettingsSchema>;

export const DEFAULT_PUBLICATION_SETTINGS: PublicationSettings = PublicationSettingsSchema.parse({});

/** Un aviso a guardar: operación + portal + estado. */
export const ListingEntrySchema = z
  .object({
    operationType: z.nativeEnum(PropertyOperationType),
    portal: portalKey,
    status: z.nativeEnum(ListingStatus),
    externalUrl: httpUrl.nullable().optional(),
    externalCode: z.string().trim().max(80).nullable().optional(),
    publishedAt: z.coerce.date().nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((e) => !e.publishedAt || !e.expiresAt || e.expiresAt >= e.publishedAt, {
    message: 'expiresAt must not be before publishedAt',
    path: ['expiresAt'],
  });

export type ListingEntryInput = z.infer<typeof ListingEntrySchema>;

export const UpsertListingsSchema = z
  .object({ listings: z.array(ListingEntrySchema).min(1).max(40) })
  .strict();

export const AdCopyQuerySchema = z.object({
  portal: portalKey.default(MICROSITE_PORTAL_KEY),
  operation: z.nativeEnum(PropertyOperationType).optional(),
});

/** Reemplaza `{code}` de la plantilla por el código del aviso (codificado). */
export function listingUrlFromTemplate(
  template: string | null | undefined,
  code: string | null | undefined,
): string | null {
  if (!template || !code) return null;
  return template.replaceAll('{code}', encodeURIComponent(code));
}
