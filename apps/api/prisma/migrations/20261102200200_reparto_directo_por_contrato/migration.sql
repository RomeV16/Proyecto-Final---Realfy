-- Qué le debe a la inmobiliaria el locador que cobró directamente, pactable por
-- contrato en su versión de reglas (ADR-0009, ADR-0010). Nulo = el valor por
-- defecto de la inmobiliaria (`operationalDefaults.cash.lessorDirectOwes`), que
-- es lo que rige hoy para todos los contratos: sin backfill.
-- Rollback: ALTER TABLE "contract_terms_versions" DROP COLUMN "lessorDirectOwes";

-- AlterTable
ALTER TABLE "contract_terms_versions" ADD COLUMN     "lessorDirectOwes" "LessorDirectOwes";
