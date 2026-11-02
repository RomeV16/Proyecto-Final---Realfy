-- migracion: 20261102090100_centro_de_carga
-- centro_de_carga: la tabla nace vacía (sin backfill) y las versiones de reglas existentes quedan
-- con el comportamiento de antes: umbral de anticipo sin fijar (el de la inmobiliaria) y la comisión
-- pactada como base. Devuelve filas SOLO si algo salió mal.

SELECT 'cargo pendiente previo a la migración' AS problema, c."id" AS detalle
FROM "pending_charges" c

UNION ALL
SELECT 'versión de reglas con umbral de anticipo propio o base distinta de la pactada', v."id"
FROM "contract_terms_versions" v
WHERE v."upfrontThresholdFees" IS NOT NULL OR v."upfrontBasis" <> 'ComisionPactada';
