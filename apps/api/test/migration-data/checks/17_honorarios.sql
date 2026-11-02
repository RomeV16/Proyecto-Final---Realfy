-- migracion: 20261102233100_honorarios
-- honorarios: tablas nuevas vacías y comprobantes sin cuota. Devuelve filas SOLO
-- si algo salió mal.

-- Sin backfill: los honorarios, cuotas, comisiones del personal y coorretajes
-- nacen vacíos.
SELECT 'tabla nueva con filas' AS problema, t.tabla || ': ' || t.hay AS detalle
FROM (
  SELECT 'fees' AS tabla, (SELECT count(*) FROM "fees") AS hay
  UNION ALL SELECT 'fee_installments', (SELECT count(*) FROM "fee_installments")
  UNION ALL SELECT 'staff_commissions', (SELECT count(*) FROM "staff_commissions")
  UNION ALL SELECT 'fee_shares', (SELECT count(*) FROM "fee_shares")
) t
WHERE t.hay <> 0

UNION ALL
-- Ningún comprobante existente queda atado a una cuota de honorario.
SELECT 'comprobante con cuota de honorario', c."id"
FROM "comprobantes" c
WHERE c."feeInstallmentId" IS NOT NULL

UNION ALL
-- Los movimientos de caja de honorarios cargados a mano no se tocan.
SELECT 'movimiento de honorario atado a una cuota', m."id"
FROM "cash_movements" m
WHERE m."sourceType" = 'FeeInstallment';
