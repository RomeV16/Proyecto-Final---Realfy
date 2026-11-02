-- migracion: 20261102235500_facturacion_por_cuenta_del_locador
-- facturación por cuenta del locador: ningún emisor ni comprobante existente
-- queda atado a una persona o a un estado de cuenta, y la cola nace vacía.
-- Devuelve filas SOLO si algo salió mal.

SELECT 'emisor con persona' AS problema, i."id" AS detalle
FROM "arca_issuers" i
WHERE i."personId" IS NOT NULL OR i."invoicingSettings" IS NOT NULL

UNION ALL
SELECT 'comprobante con estado de cuenta', c."id"
FROM "comprobantes" c
WHERE c."ownerStatementId" IS NOT NULL

UNION ALL
SELECT 'cola de emisión con filas', 'lessor_invoice_jobs: ' || j.hay
FROM (SELECT count(*) AS hay FROM "lessor_invoice_jobs") j
WHERE j.hay <> 0;
