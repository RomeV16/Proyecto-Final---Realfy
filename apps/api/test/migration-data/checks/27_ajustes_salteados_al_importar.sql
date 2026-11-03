-- migracion: 20261103215011_ajustes_salteados_al_importar
-- ajustes_salteados_al_importar: las versiones de reglas existentes quedan con la convención de fábrica (no recuperar la
-- inflación de los períodos salteados al importar). Devuelve filas SOLO si algo salió mal.

SELECT 'versión de reglas con una convención de ajustes salteados distinta de la de fábrica' AS problema, v."id" AS detalle
FROM "contract_terms_versions" v
WHERE v."skippedAdjustmentsMode" <> 'NoRecuperar';
