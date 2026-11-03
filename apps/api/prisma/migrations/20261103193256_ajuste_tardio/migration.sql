-- Convención pactable por versión de reglas del contrato: qué pasa con un
-- ajuste que se aplica después de emitida la liquidación de un mes en que ya
-- regía (DEF-134). Su valor por defecto está en los valores por defecto de la
-- inmobiliaria (Tenant.operationalDefaults.lateAdjustmentBilling).
-- Backfill: las versiones existentes toman 'Retroactivo', el valor de fábrica
-- (la inmobiliaria liquida el mes con el ajuste que rige desde el día 1; si no
-- se pudo, cobra la diferencia después). Antes de este cambio el mes se perdía.
-- Rollback: ALTER TABLE "contract_terms_versions" DROP COLUMN
-- "lateAdjustmentBilling". La versión anterior ignora la columna.

-- AlterTable
ALTER TABLE "contract_terms_versions" ADD COLUMN     "lateAdjustmentBilling" "LateAdjustmentBilling" NOT NULL DEFAULT 'Retroactivo';
