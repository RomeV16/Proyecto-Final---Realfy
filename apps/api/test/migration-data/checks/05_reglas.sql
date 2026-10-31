-- migracion: 20261031080100_reglas_del_contrato
-- reglas_del_contrato: backfill de períodos y versiones de reglas.
-- Devuelve filas SOLO si algo salió mal.

-- Cada contrato tiene exactamente un período, el 1, original, con sus fechas.
SELECT 'contrato sin exactamente un período 1' AS problema, c."id" AS detalle
FROM "contracts" c
WHERE (SELECT count(*) FROM "contract_periods" p WHERE p."contractId" = c."id") <> 1
   OR NOT EXISTS (
     SELECT 1 FROM "contract_periods" p
     WHERE p."contractId" = c."id" AND p."seq" = 1 AND p."kind" = 'Original'
       AND p."startDate" = c."startDate" AND p."endDate" = c."endDate" AND p."tenantId" = c."tenantId")

UNION ALL
-- Cada contrato tiene al menos una versión de reglas, la primera desde su inicio.
SELECT 'contrato sin versión de reglas inicial', c."id"
FROM "contracts" c
WHERE NOT EXISTS (
  SELECT 1 FROM "contract_terms_versions" v
  WHERE v."contractId" = c."id" AND v."validFrom" = c."startDate")

UNION ALL
-- La versión inicial reproduce las columnas del contrato.
SELECT 'versión inicial distinta del contrato', v."id"
FROM "contract_terms_versions" v
JOIN "contracts" c ON c."id" = v."contractId"
WHERE v."validFrom" = c."startDate"
  AND (v."adjustmentType" <> c."adjustmentType"
    OR v."adjustmentPeriod" <> c."adjustmentPeriod"
    OR v."customPct" IS DISTINCT FROM c."customAdjustmentPct"
    OR v."adjustmentBase" <> 'Vigente'
    OR v."indexLagMonths" <> 0
    OR v."dueDay" <> 10
    OR v."paymentFlow" <> 'Partido'
    OR v."tenantId" <> c."tenantId")

UNION ALL
-- No hay versiones huérfanas (todas pertenecen a un contrato de su inmobiliaria).
SELECT 'versión huérfana', v."id"
FROM "contract_terms_versions" v
LEFT JOIN "contracts" c ON c."id" = v."contractId"
WHERE c."id" IS NULL

UNION ALL
-- El alquiler inicial de con-2 es el anterior al ajuste aplicado, y el de con-1
-- (sin ajustes) es el actual.
SELECT 'alquiler inicial inesperado', p."contractId" || ' ' || p."initialRent"
FROM "contract_periods" p
WHERE (p."contractId" = 'con-2' AND p."initialRent" <> 120000.00)
   OR (p."contractId" = 'con-1' AND p."initialRent" <> 100000.00)

UNION ALL
-- Las columnas nuevas arrancan vacías.
SELECT 'columnas nuevas con valor inesperado', c."id"
FROM "contracts" c
WHERE c."actualEndDate" IS NOT NULL OR c."previousContractId" IS NOT NULL

UNION ALL
SELECT 'ajuste provisional inesperado', a."id"
FROM "contract_adjustments" a
WHERE a."isProvisional" OR a."trueUpOfId" IS NOT NULL

UNION ALL
SELECT 'índice estimado inesperado', i."id"
FROM "index_data" i
WHERE i."isEstimate" OR i."estimateSource" IS NOT NULL

UNION ALL
SELECT 'acuerdos inesperados', count(*)::text
FROM "contract_agreements" HAVING count(*) > 0

UNION ALL
SELECT 'valores por defecto inesperados', t."id"
FROM "tenants" t
WHERE t."operationalDefaults" IS NOT NULL;
