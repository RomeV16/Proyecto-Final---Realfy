-- Convención pactable por contrato: qué se hace con la inflación de los períodos de
-- ajuste que quedaron salteados al importar (el alquiler importado ya viene
-- actualizado). Las versiones de reglas existentes quedan en NoRecuperar, que es lo
-- que el primer ajuste debe hacer; no cambia ningún importe guardado.
--
-- Rollback: ALTER TABLE "contract_terms_versions" DROP COLUMN "skippedAdjustmentsMode";
-- DROP TYPE "SkippedAdjustmentsMode";

-- CreateEnum
CREATE TYPE "SkippedAdjustmentsMode" AS ENUM ('NoRecuperar', 'Recuperar');

-- AlterTable
ALTER TABLE "contract_terms_versions" ADD COLUMN     "skippedAdjustmentsMode" "SkippedAdjustmentsMode" NOT NULL DEFAULT 'NoRecuperar';
