-- migracion: 20261102200200_reparto_directo_por_contrato
-- reparto_directo_por_contrato: ninguna versión de reglas existente pacta lo que debe
-- el locador que cobra directamente; todas siguen con el valor de la inmobiliaria.
-- Devuelve filas SOLO si algo salió mal.
SELECT 'versión de reglas con lessorDirectOwes propio' AS problema, v."id" AS detalle
FROM "contract_terms_versions" v
WHERE v."lessorDirectOwes" IS NOT NULL;
