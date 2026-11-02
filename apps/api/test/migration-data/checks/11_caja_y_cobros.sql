-- migracion: 20261102160100_caja_y_cobros
-- caja_y_cobros: backfill de los cobros existentes. Devuelve filas SOLO si algo salió mal.

-- Todo cobro existente queda recibido por la inmobiliaria, sin cuenta, sin recibo,
-- sin custodia, sin reparto guardado y sin referencia externa.
SELECT 'cobro existente con datos nuevos inesperados' AS problema, p."id" AS detalle
FROM "payments" p
WHERE p."receivedBy" <> 'Inmobiliaria'
   OR p."accountId" IS NOT NULL
   OR p."receiptId" IS NOT NULL
   OR p."receivedByUserId" IS NOT NULL
   OR p."inCustody"
   OR p."settlement" IS NOT NULL
   OR p."externalRef" IS NOT NULL

UNION ALL
-- Las tablas nuevas nacen vacías: ni cuentas, ni movimientos, ni recibos, ni compensaciones.
SELECT 'tabla nueva con filas', t.tabla || ': ' || t.hay
FROM (
  SELECT 'financial_accounts' AS tabla, (SELECT count(*) FROM "financial_accounts") AS hay
  UNION ALL SELECT 'cash_movements', (SELECT count(*) FROM "cash_movements")
  UNION ALL SELECT 'receipts', (SELECT count(*) FROM "receipts")
  UNION ALL SELECT 'compensations', (SELECT count(*) FROM "compensations")
) t
WHERE t.hay <> 0

UNION ALL
-- La numeración de las liquidaciones no cambia: la migración no toca los contadores.
SELECT 'contador de recibos de cobro previo a la migración', d."tenantId"
FROM "document_sequences" d
WHERE d."series" LIKE 'RECIBO_COBRO%';
