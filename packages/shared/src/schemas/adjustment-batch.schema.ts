import { z } from 'zod';

/** Mes de los ajustes, `YYYY-MM`. */
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM');

/** Previsualización de los ajustes que vencen hasta un mes. */
export const PreviewAdjustmentBatchSchema = z.object({ period }).strict();
export type PreviewAdjustmentBatchInput = z.infer<typeof PreviewAdjustmentBatchSchema>;

/** Aplicación de los ajustes elegidos del mes; cada contrato se aplica por separado. */
export const ApplyAdjustmentBatchSchema = z
  .object({
    period,
    contractIds: z.array(z.string().min(1)).min(1).max(500),
    /**
     * Contratos (de `contractIds`) cuyo ajuste baja el alquiler y la persona confirma expresamente.
     * Sin la confirmación el ajuste que baja el alquiler no se aplica (`RENT_DECREASE_REQUIRES_REVIEW`).
     */
    confirmRentDecrease: z.array(z.string().min(1)).max(500).optional(),
  })
  .strict();
export type ApplyAdjustmentBatchInput = z.infer<typeof ApplyAdjustmentBatchSchema>;

/** Estados de una fila de la previsualización. */
export const ADJUSTMENT_ROW_STATUSES = ['ready', 'provisional', 'fixed_initial', 'missing_data', 'error'] as const;
export type AdjustmentRowStatus = (typeof ADJUSTMENT_ROW_STATUSES)[number];

/** Un valor de índice que entra en el cálculo del ajuste. */
export interface AdjustmentIndexValue {
  indexType: string;
  period: string;
  value: string;
  isEstimate: boolean;
}

/** Fila de la previsualización: un contrato con un ajuste que vence en el mes (o antes). */
export interface AdjustmentPreviewRow {
  contractId: string;
  scheduleId: string;
  periodNumber: number;
  /** Fecha del cronograma, ISO. */
  adjustmentDate: string;
  /** Vencía antes del mes pedido: viene atrasado. */
  overdue: boolean;
  propertyTitle: string | null;
  adjustmentType: string;
  currency: string;
  currentRent: string;
  newRent: string | null;
  /** Variación del índice (no la del alquiler: con base Original pueden diferir). */
  percentage: string | null;
  /** Variación real del alquiler nuevo sobre el vigente, en %. */
  rentChangePct: string | null;
  /** El alquiler nuevo es menor que el vigente: no se elige por defecto y se aplica sólo confirmado. */
  rentDecrease: boolean;
  /** Nuevo alquiler sobre el actual. */
  factor: string | null;
  status: AdjustmentRowStatus;
  isProvisional: boolean;
  /** Meses cubiertos con un estimado. */
  estimatedPeriods: string[];
  /** Valores de índice usados. */
  indexValues: AdjustmentIndexValue[];
  /** Si faltan índices: cuáles y de qué meses. `estimatesOnly`: hay estimado pero el pago a cuenta está apagado. */
  missing: { indexTypes: string[]; missingPeriods: string[]; estimatesOnly: boolean } | null;
  /** Código de otro error que impide calcular (porcentaje sin cargar, modalidad desconocida). */
  error: string | null;
  /** Se puede elegir para aplicar. */
  selectable: boolean;
}

export interface AdjustmentPreviewBatch {
  period: string;
  rows: AdjustmentPreviewRow[];
}

/** Resultado de aplicar un contrato del lote. */
export interface AdjustmentApplyResult {
  contractId: string;
  /** `error`: falló por un motivo no previsto (por ejemplo un conflicto de base); el resto del lote sigue. */
  result: 'applied' | 'skipped' | 'error';
  /** `applied`, `provisional` o `fixed_initial` si se aplicó. */
  status: string | null;
  /** Por qué se salteó o falló: `MISSING_INDEX_DATA`, `NO_DUE_ADJUSTMENT`, `CONTRACT_NOT_FOUND`, `RENT_DECREASE_REQUIRES_REVIEW`, `CONFLICT`, etc. */
  reason: string | null;
  previousRent: string | null;
  newRent: string | null;
  /** Variación real del alquiler sobre el vigente, en %; también cuando se saltea por `RENT_DECREASE_REQUIRES_REVIEW`. */
  rentChangePct: string | null;
  estimatedPeriods: string[];
  missingPeriods: string[];
  indexTypes: string[];
}

export interface AdjustmentApplyBatch {
  period: string;
  results: AdjustmentApplyResult[];
}
