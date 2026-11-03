-- migracion: 20261103193256_ajuste_tardio
-- ajuste_tardio: las versiones existentes quedan con la convención de fábrica.
-- Devuelve filas SOLO si algo salió mal.

SELECT 'versión sin la convención de fábrica' AS problema, v."id" AS detalle
FROM "contract_terms_versions" v
WHERE v."lateAdjustmentBilling" IS DISTINCT FROM 'Retroactivo';
