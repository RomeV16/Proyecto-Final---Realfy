-- migracion: 20261103173929_importacion_servicios_y_reglas
-- importacion_servicios_y_reglas: el servicio gana la referencia del sistema
-- anterior, única por inmobiliaria y con varios NULL permitidos; los servicios
-- que ya existían quedan sin referencia, intactos, y el registro por fila admite
-- las dos entidades nuevas. Devuelve filas SOLO si algo salió mal.

-- Falta el índice único de la referencia por inmobiliaria.
SELECT 'falta indice unico' AS problema, 'services_tenantId_externalRef_key' AS detalle
WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes i
  WHERE i."indexname" = 'services_tenantId_externalRef_key' AND i."indexdef" LIKE 'CREATE UNIQUE INDEX%'
)

UNION ALL
-- Los tres servicios de la semilla (dos de la inmobiliaria A y uno de la B)
-- conviven con referencia NULL: ninguno la recibió por la migración.
SELECT 'servicio existente con referencia', s."id"
FROM "services" s
WHERE s."externalRef" IS NOT NULL

UNION ALL
SELECT 'servicios existentes sin referencia: esperados 3', 'hay ' || count(*)
FROM "services"
WHERE "externalRef" IS NULL
HAVING count(*) <> 3

UNION ALL
-- Los datos de los servicios no cambiaron (importe y propiedad de la semilla).
SELECT 'servicio alterado', s."id"
FROM "services" s
WHERE (s."id" = 'svc-1' AND (s."amount" <> 18000.00 OR s."propertyId" <> 'prop-1'))
   OR (s."id" = 'svc-2' AND (s."amount" <> 9000.00 OR s."propertyId" <> 'prop-1'))
   OR (s."id" = 'svc-b1' AND (s."amount" <> 7000.00 OR s."tenantId" <> 'tenant-b'))

UNION ALL
-- El registro por fila admite las entidades nuevas.
SELECT 'falta valor de ImportEntity', v.valor
FROM (VALUES ('Servicio'), ('ReglaDeCargo')) AS v(valor)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_enum e
  JOIN pg_type t ON t."oid" = e."enumtypid"
  WHERE t."typname" = 'ImportEntity' AND e."enumlabel" = v.valor
);
