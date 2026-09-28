-- La numeracion de comprobantes pasa a ser unica por emisor.
--
-- ARCA numera por CUIT, punto de venta y tipo de comprobante. La restriccion
-- anterior no incluia al emisor, asi que con dos emisores en la misma
-- inmobiliaria el segundo comprobante con el mismo punto de venta, tipo y numero
-- era rechazado por la base despues de que ARCA ya lo habia autorizado.
--
-- Antes de cambiar la restriccion se completa el emisor de los comprobantes que
-- no lo tienen, cuando la inmobiliaria tiene uno solo: con el emisor en nulo la
-- fila quedaria fuera de la nueva restriccion.
UPDATE "comprobantes" AS c
SET "issuerId" = unico."id"
FROM (
    SELECT "tenantId", MIN("id") AS "id"
    FROM "arca_issuers"
    GROUP BY "tenantId"
    HAVING COUNT(*) = 1
) AS unico
WHERE unico."tenantId" = c."tenantId"
  AND c."issuerId" IS NULL;

-- DropIndex
DROP INDEX "comprobantes_tenantId_puntoDeVenta_cbteTipo_numero_key";

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_tenantId_issuerId_puntoDeVenta_cbteTipo_numero_key" ON "comprobantes"("tenantId", "issuerId", "puntoDeVenta", "cbteTipo", "numero");
