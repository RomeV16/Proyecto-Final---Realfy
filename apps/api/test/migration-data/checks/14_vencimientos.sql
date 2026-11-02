-- migracion: 20261102210100_vencimientos
-- vencimientos: la migración no crea seguimientos y deja los períodos existentes
-- sin honorarios ni garantes. Devuelve filas SOLO si algo salió mal.

SELECT 'tabla nueva con filas' AS problema, t.tabla || ': ' || t.hay AS detalle
FROM (
  SELECT 'contract_follow_ups' AS tabla, (SELECT count(*) FROM "contract_follow_ups") AS hay
  UNION ALL SELECT 'follow_up_tasks', (SELECT count(*) FROM "follow_up_tasks")
) t
WHERE t.hay <> 0

UNION ALL
SELECT 'período existente con datos de renovación', p."id"
FROM "contract_periods" p
WHERE p."feeAmount" IS NOT NULL
   OR p."feeCurrency" IS NOT NULL
   OR cardinality(p."guarantorPersonIds") <> 0

UNION ALL
-- Los períodos de los contratos no se pierden.
SELECT 'contrato sin período', c."id"
FROM "contracts" c
WHERE NOT EXISTS (SELECT 1 FROM "contract_periods" p WHERE p."contractId" = c."id")
  AND EXISTS (SELECT 1 FROM "contract_periods");
