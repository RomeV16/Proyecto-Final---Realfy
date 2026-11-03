-- Importación de servicios y reglas de traslado (paso M8 de la migración,
-- ADR-0015): el servicio guarda la referencia del sistema anterior, única por
-- inmobiliaria y con varios NULL permitidos (los servicios cargados a mano no
-- la tienen), y el registro por fila admite las dos entidades nuevas. No toca
-- datos existentes.
--
-- Rollback:
--   DROP INDEX "services_tenantId_externalRef_key";
--   ALTER TABLE "services" DROP COLUMN "externalRef";
--   (los valores nuevos de "ImportEntity" no se pueden quitar de un enum sin
--   recrearlo; quedan sin uso)

-- AlterEnum
ALTER TYPE "ImportEntity" ADD VALUE 'Servicio';
ALTER TYPE "ImportEntity" ADD VALUE 'ReglaDeCargo';

-- AlterTable
ALTER TABLE "services" ADD COLUMN "externalRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "services_tenantId_externalRef_key" ON "services"("tenantId", "externalRef");
