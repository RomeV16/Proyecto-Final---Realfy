-- Ninguna migración nueva debe perder, duplicar ni tocar datos que no le
-- corresponden. Devuelve filas SOLO si algo salió mal.

-- Los conteos son los de seed.sql.
SELECT 'conteo inesperado' AS problema, c.tabla || ': esperado ' || c.esperado || ', hay ' || c.hay AS detalle
FROM (
  SELECT 'tenants' AS tabla, 2 AS esperado, (SELECT count(*) FROM "tenants") AS hay
  UNION ALL SELECT 'users', 2, (SELECT count(*) FROM "users")
  UNION ALL SELECT 'persons', 12, (SELECT count(*) FROM "persons")
  UNION ALL SELECT 'person_role_assignments', 7, (SELECT count(*) FROM "person_role_assignments")
  UNION ALL SELECT 'properties', 4, (SELECT count(*) FROM "properties")
  UNION ALL SELECT 'contracts', 5, (SELECT count(*) FROM "contracts")
  UNION ALL SELECT 'contract_persons', 13, (SELECT count(*) FROM "contract_persons")
  UNION ALL SELECT 'liquidaciones', 3, (SELECT count(*) FROM "liquidaciones")
  UNION ALL SELECT 'liquidacion_line_items', 7, (SELECT count(*) FROM "liquidacion_line_items")
  UNION ALL SELECT 'payments', 2, (SELECT count(*) FROM "payments")
  UNION ALL SELECT 'comprobantes', 1, (SELECT count(*) FROM "comprobantes")
) c
WHERE c.esperado <> c.hay

UNION ALL
-- Las filas existentes toman los valores por defecto de las columnas nuevas.
SELECT 'persona con valores nuevos inesperados', p."id"
FROM "persons" p
WHERE p."personType" <> 'Fisica'
   OR p."externalRef" IS NOT NULL
   OR p."payoutMethod" IS NOT NULL
   OR p."dni" IS NOT NULL
   OR p."address" IS NOT NULL

UNION ALL
SELECT 'propiedad con valores nuevos inesperados', p."id"
FROM "properties" p
WHERE p."externalRef" IS NOT NULL OR p."cadastralId" IS NOT NULL OR p."parentPropertyId" IS NOT NULL

UNION ALL
SELECT 'contrato con referencia inesperada', c."id"
FROM "contracts" c
WHERE c."externalRef" IS NOT NULL

UNION ALL
-- Las relaciones existentes siguen apuntando a filas de la misma inmobiliaria.
SELECT 'contrato de otra inmobiliaria que su propiedad', c."id"
FROM "contracts" c
JOIN "properties" p ON p."id" = c."propertyId"
WHERE p."tenantId" <> c."tenantId"

UNION ALL
SELECT 'parte de contrato huerfana', cp."id"
FROM "contract_persons" cp
LEFT JOIN "contracts" c ON c."id" = cp."contractId"
LEFT JOIN "persons" p ON p."id" = cp."personId"
WHERE c."id" IS NULL OR p."id" IS NULL OR c."tenantId" <> p."tenantId"

UNION ALL
SELECT 'pago huerfano', pay."id"
FROM "payments" pay
LEFT JOIN "liquidaciones" l ON l."id" = pay."liquidacionId"
WHERE l."id" IS NULL

UNION ALL
SELECT 'comprobante sin su pago', cmp."id"
FROM "comprobantes" cmp
LEFT JOIN "payments" pay ON pay."id" = cmp."paymentId"
WHERE cmp."paymentId" IS NOT NULL AND pay."id" IS NULL;
