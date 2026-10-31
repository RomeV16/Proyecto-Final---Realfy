-- Corrección de ajustes provisorios: marca cuándo se facturó la diferencia retroactiva.
-- AlterTable
ALTER TABLE "contract_adjustments" ADD COLUMN "trueUpBilledAt" TIMESTAMP(3);
