-- Convenciones de liquidación por versión de reglas del contrato: cómo se
-- prorratea un mes parcial, cuándo rige un ajuste a mitad de mes, cómo se cobra
-- el primer mes de un contrato que empieza pasado el vencimiento y si el
-- descuento de monto fijo se prorratea. Cada una tiene su valor por defecto en
-- los valores por defecto de la inmobiliaria (Tenant.operationalDefaults).
-- Backfill: el valor por defecto de cada columna es el comportamiento que ya
-- tenía la generación (días reales, el ajuste rige desde el período siguiente,
-- vence el día de inicio, descuento fijo proporcional), así que las versiones
-- existentes liquidan igual que antes.
-- Rollback: ALTER TABLE "contract_terms_versions" DROP COLUMN "prorationMode",
-- DROP COLUMN "midMonthAdjustmentMode", DROP COLUMN "firstDueMode", DROP COLUMN
-- "fixedDiscountProration". La versión anterior ignora las columnas.

-- AlterTable
ALTER TABLE "contract_terms_versions" ADD COLUMN     "firstDueMode" "FirstDueMode" NOT NULL DEFAULT 'DiaDeInicio',
ADD COLUMN     "fixedDiscountProration" "FixedDiscountProration" NOT NULL DEFAULT 'Proporcional',
ADD COLUMN     "midMonthAdjustmentMode" "MidMonthAdjustmentMode" NOT NULL DEFAULT 'DesdePeriodoSiguiente',
ADD COLUMN     "prorationMode" "ProrationMode" NOT NULL DEFAULT 'DiasReales';
