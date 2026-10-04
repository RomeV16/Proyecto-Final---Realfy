-- Todo comprobante pertenece a un emisor. Con el emisor en nulo la fila
-- quedaba fuera de la restriccion (tenantId, issuerId, puntoDeVenta,
-- cbteTipo, numero), porque en PostgreSQL dos nulos no chocan entre si.
-- La migracion 20260928170000 completo el emisor de los comprobantes
-- anteriores cuando la inmobiliaria tenia uno solo, y todas las emisiones
-- lo guardan.

-- DropForeignKey
ALTER TABLE "comprobantes" DROP CONSTRAINT "comprobantes_issuerId_fkey";

-- AlterTable
ALTER TABLE "comprobantes" ALTER COLUMN "issuerId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "arca_issuers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

