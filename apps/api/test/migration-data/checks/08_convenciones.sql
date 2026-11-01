-- migracion: 20261101090100_convenciones_de_liquidacion
-- convenciones_de_liquidacion: las versiones existentes conservan el comportamiento actual.
-- Devuelve filas SOLO si algo salió mal.

SELECT 'versión con una convención distinta de la original' AS problema, v."id" AS detalle
FROM "contract_terms_versions" v
WHERE v."prorationMode" <> 'DiasReales'
   OR v."midMonthAdjustmentMode" <> 'DesdePeriodoSiguiente'
   OR v."firstDueMode" <> 'DiaDeInicio'
   OR v."fixedDiscountProration" <> 'Proporcional'

UNION ALL
-- Ninguna versión quedó sin alguna de las cuatro.
SELECT 'versión con una convención nula', v."id"
FROM "contract_terms_versions" v
WHERE v."prorationMode" IS NULL
   OR v."midMonthAdjustmentMode" IS NULL
   OR v."firstDueMode" IS NULL
   OR v."fixedDiscountProration" IS NULL;
