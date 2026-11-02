-- migracion: 20261101120100_boletas_y_reglas_de_cargo
-- boletas_y_reglas_de_cargo: los servicios existentes conservan su comportamiento y
-- las tablas nuevas nacen vacías. Devuelve filas SOLO si algo salió mal.

SELECT 'servicio con frecuencia o pago anual distintos del valor por defecto' AS problema, s."id" AS detalle
FROM "services" s
WHERE s."billingFrequency" <> 'Mensual' OR s."hasAnnualOption" IS TRUE

UNION ALL
-- Ningún servicio se perdió ni cambió de inmobiliaria.
SELECT 'cantidad de servicios distinta de la semilla (3)', count(*)::text
FROM "services"
HAVING count(*) <> 3

UNION ALL
SELECT 'servicio de otra inmobiliaria', s."id"
FROM "services" s
WHERE (s."id" IN ('svc-1', 'svc-2') AND s."tenantId" <> 'tenant-a')
   OR (s."id" = 'svc-b1' AND s."tenantId" <> 'tenant-b')

UNION ALL
-- Sin backfill: no hay boletas, reglas ni partes previas.
SELECT 'tabla nueva con filas: ' || t.name, t.n::text
FROM (
  SELECT 'service_bills' AS name, count(*) AS n FROM "service_bills"
  UNION ALL SELECT 'contract_charge_rules', count(*) FROM "contract_charge_rules"
  UNION ALL SELECT 'service_bill_allocations', count(*) FROM "service_bill_allocations"
) t
WHERE t.n > 0

UNION ALL
-- Los pagos de servicio existentes no apuntan a ninguna boleta.
SELECT 'pago con boleta', p."id"
FROM "service_payments" p
WHERE p."billId" IS NOT NULL;
