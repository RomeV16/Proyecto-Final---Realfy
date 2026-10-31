-- migracion: 20261031120000_ajuste_corregido_pendiente
-- ajuste_corregido_pendiente: la columna nueva queda vacía y los ajustes existentes no cambian.
-- Devuelve filas SOLO si algo salió mal.

-- Ningún ajuste existente nace con la diferencia retroactiva facturada.
SELECT 'ajuste con trueUpBilledAt cargado' AS problema, a."id" AS detalle
FROM "contract_adjustments" a
WHERE a."trueUpBilledAt" IS NOT NULL

UNION ALL
-- Ningún ajuste existente quedó marcado como corrección de otro.
SELECT 'ajuste existente con trueUpOfId', a."id"
FROM "contract_adjustments" a
WHERE a."trueUpOfId" IS NOT NULL
