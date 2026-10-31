-- personas_datos_y_referencias: la unicidad de externalRef es por inmobiliaria
-- y admite varios NULL. Devuelve filas SOLO si algo salió mal.

-- Falta alguno de los índices únicos esperados.
SELECT 'falta indice unico' AS problema, e.indice AS detalle
FROM (VALUES
  ('persons_tenantId_externalRef_key'),
  ('properties_tenantId_externalRef_key'),
  ('contracts_tenantId_externalRef_key')
) AS e(indice)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes i
  WHERE i."indexname" = e.indice AND i."indexdef" LIKE 'CREATE UNIQUE INDEX%'
)

UNION ALL
-- Las filas existentes quedaron con externalRef NULL y el índice las admite:
-- si la migración aplicó, diez personas de la inmobiliaria A conviven sin
-- referencia. Menos de diez significa que se perdieron o se les inventó una.
SELECT 'personas sin referencia: esperadas 10', 'hay ' || count(*)
FROM "persons"
WHERE "tenantId" = 'tenant-a' AND "externalRef" IS NULL
HAVING count(*) <> 10;
