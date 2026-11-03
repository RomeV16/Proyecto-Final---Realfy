-- migracion: 20261103180412_boletas_automaticas
-- obtención automática de boletas: los servicios y las boletas que ya existían
-- quedan sin proveedor del catálogo, `Manual` y sin documento, y las tablas nuevas
-- nacen vacías (nada genera trabajo pendiente).
-- Devuelve filas SOLO si algo salió mal.

SELECT 'servicio con proveedor del catálogo sin que nadie lo cargue' AS problema, 'services: ' || s."id" AS detalle
FROM "services" s
WHERE s."providerKey" IS NOT NULL

UNION ALL

SELECT 'boleta que no es manual o ya tiene documento', 'service_bills: ' || b."id"
FROM "service_bills" b
WHERE b."source" <> 'Manual' OR b."documentId" IS NOT NULL

UNION ALL

SELECT 'documento de boleta de más', 'bill_documents: ' || d."id"
FROM "bill_documents" d

UNION ALL

SELECT 'consulta a un proveedor de más', 'bill_fetch_runs: ' || r."id"
FROM "bill_fetch_runs" r;
