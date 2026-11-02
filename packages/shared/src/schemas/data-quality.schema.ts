import { z } from 'zod';

/** Controles del panel de calidad de datos, agrupados por el tipo de problema. */
export const DATA_QUALITY_CHECKS = [
  { id: 'duplicate-cuit', group: 'duplicates' },
  { id: 'duplicate-dni', group: 'duplicates' },
  { id: 'duplicate-cbu', group: 'duplicates' },
  { id: 'duplicate-phone', group: 'duplicates' },
  { id: 'duplicate-email', group: 'duplicates' },
  { id: 'duplicate-name', group: 'duplicates' },
  { id: 'lessors-sum', group: 'lessors' },
  { id: 'ownership-sum', group: 'ownerships' },
  { id: 'property-no-owner', group: 'ownerships' },
  { id: 'owner-no-bank-account', group: 'ownerships' },
  { id: 'lessor-no-tax-id', group: 'ownerships' },
  { id: 'contract-expired-undecided', group: 'contracts' },
  { id: 'contract-essentials', group: 'contracts' },
] as const;

export type DataQualityCheckId = (typeof DATA_QUALITY_CHECKS)[number]['id'];
export type DataQualityGroup = (typeof DATA_QUALITY_CHECKS)[number]['group'];

export const DATA_QUALITY_CHECK_IDS = DATA_QUALITY_CHECKS.map((c) => c.id) as DataQualityCheckId[];

export type DataQualitySeverity = 'error' | 'warning';
export type DataQualityEntityType = 'Person' | 'Property' | 'Contract';

export interface DataQualityFinding {
  /** Estable entre consultas: `<control>:<entidad o grupo>`. */
  id: string;
  check: DataQualityCheckId;
  severity: DataQualitySeverity;
  entityType: DataQualityEntityType;
  entityId: string;
  label: string;
  /** Campos o datos involucrados (por ejemplo `cuit`, `lessors`, `tenant`). */
  fields: string[];
  /** Ruta de la web (sin idioma) donde se corrige. */
  link: string;
  /** En los duplicados, todas las personas del grupo. */
  members?: { id: string; label: string }[];
  /** Datos del hallazgo: suma encontrada, fecha de fin, valor repetido. */
  details?: Record<string, string | number>;
}

export interface DataQualitySummaryItem {
  check: DataQualityCheckId;
  group: DataQualityGroup;
  severity: DataQualitySeverity;
  count: number;
}

export interface DataQualitySummary {
  generatedAt: string;
  total: number;
  checks: DataQualitySummaryItem[];
}

export interface DataQualityPage {
  check: DataQualityCheckId;
  items: DataQualityFinding[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const DataQualityFindingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

export const MergePersonsSchema = z
  .object({
    keepId: z.string().uuid(),
    mergeIds: z.array(z.string().uuid()).min(1).max(10),
  })
  .refine((v) => !v.mergeIds.includes(v.keepId), {
    message: 'keepId must not be in mergeIds',
    path: ['mergeIds'],
  })
  .refine((v) => new Set(v.mergeIds).size === v.mergeIds.length, {
    message: 'mergeIds must not repeat',
    path: ['mergeIds'],
  });

export type MergePersonsInput = z.infer<typeof MergePersonsSchema>;

/** Qué se mueve a la persona que se conserva, por tabla y campo. */
export interface MergePersonsPlanItem {
  entity: string;
  field: string;
  count: number;
}

export interface MergePersonsPlan {
  keepId: string;
  mergeIds: string[];
  items: MergePersonsPlanItem[];
  /** Filas de la persona unida que ya existen en la conservada y se descartan (rol repetido, cuenta idéntica). */
  discarded: MergePersonsPlanItem[];
}

export interface MergePersonsResult extends MergePersonsPlan {
  merged: number;
}
