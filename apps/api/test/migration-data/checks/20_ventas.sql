-- migracion: 20261103130100_ventas
-- ventas: las tablas nacen vacías y ningún honorario existente queda atado a una operación
-- de venta (siguen colgando de la propiedad o del contrato como antes).
-- Devuelve filas SOLO si algo salió mal.

SELECT 'honorario con operación de venta' AS problema, f."id" AS detalle
FROM "fees" f
WHERE f."salesOpId" IS NOT NULL

UNION ALL
SELECT 'tabla de ventas con filas', t.nombre || ': ' || t.hay
FROM (
  SELECT 'sales_operations' AS nombre, count(*) AS hay FROM "sales_operations"
  UNION ALL SELECT 'sales_parties', count(*) FROM "sales_parties"
  UNION ALL SELECT 'sales_deposits', count(*) FROM "sales_deposits"
  UNION ALL SELECT 'sales_doc_checks', count(*) FROM "sales_doc_checks"
) t
WHERE t.hay <> 0;
