-- migracion: 20261031090100_lineas_con_destino
-- lineas_con_destino: backfill de renglones y liquidaciones existentes.
-- Devuelve filas SOLO si algo salió mal.

-- Ningún renglón queda sin destino: todos los existentes van al locador.
SELECT 'renglón sin destino al locador' AS problema, li."id" AS detalle
FROM "liquidacion_line_items" li
WHERE li."beneficiary" IS NULL OR li."beneficiary" <> 'Locador'

UNION ALL
-- Comisionable según el tipo: Alquiler, Ajuste, Multa y Descuento sí; Extra no.
SELECT 'comisionable distinto de la regla', li."id"
FROM "liquidacion_line_items" li
WHERE li."commissionable" IS DISTINCT FROM (li."type"::text IN ('Alquiler', 'Ajuste', 'Multa', 'Descuento'))

UNION ALL
-- Las liquidaciones existentes son mensuales, definitivas y sin recibo.
SELECT 'liquidación existente no mensual, provisional o con recibo', l."id"
FROM "liquidaciones" l
WHERE l."kind" <> 'Mensual' OR l."isProvisional" OR l."receiptSeq" IS NOT NULL

UNION ALL
-- El número de recibo no se repite dentro de una inmobiliaria.
SELECT 'recibo repetido en la inmobiliaria', l."tenantId" || '/' || l."receiptSeq"::text
FROM "liquidaciones" l
WHERE l."receiptSeq" IS NOT NULL
GROUP BY l."tenantId", l."receiptSeq"
HAVING count(*) > 1;
