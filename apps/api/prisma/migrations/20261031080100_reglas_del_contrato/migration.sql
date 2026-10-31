-- Reglas versionadas del contrato: períodos, acuerdos y versiones de reglas,
-- valores por defecto de la inmobiliaria e índices estimados.
-- Las columnas de ajuste de "contracts" siguen siendo la vista "vigente"
-- desnormalizada; cada contrato recibe un período original y una versión de
-- reglas inicial con los valores de hoy, así que el cálculo no cambia.
-- Rollback: DROP TABLE "contract_terms_versions", "contract_agreements",
-- "contract_periods"; DROP TYPE "ContractPeriodKind", "ContractAgreementKind",
-- "AdjustmentBase", "PaymentFlow"; ALTER TABLE "contracts" DROP COLUMN
-- "actualEndDate", DROP COLUMN "previousContractId"; ALTER TABLE
-- "contract_adjustments" DROP COLUMN "isProvisional", DROP COLUMN "trueUpOfId"
-- (y el índice único nuevo); ALTER TABLE "index_data" DROP COLUMN "isEstimate",
-- DROP COLUMN "estimateSource"; ALTER TABLE "tenants" DROP COLUMN
-- "operationalDefaults". La versión anterior sigue funcionando con las
-- columnas de "contracts", que no se modifican.

-- CreateEnum
CREATE TYPE "ContractPeriodKind" AS ENUM ('Original', 'Renovacion', 'Prorroga');

-- CreateEnum
CREATE TYPE "ContractAgreementKind" AS ENUM ('Renegociacion', 'Rebaja', 'Bonificacion', 'CambioRegla', 'CambioReparto', 'CambioCargo');

-- CreateEnum
CREATE TYPE "AdjustmentBase" AS ENUM ('Original', 'Vigente');

-- CreateEnum
CREATE TYPE "PaymentFlow" AS ENUM ('Partido', 'TodoInmobiliaria', 'TodoLocador');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "operationalDefaults" JSONB;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "actualEndDate" TIMESTAMP(3),
ADD COLUMN     "previousContractId" TEXT;

-- AlterTable
ALTER TABLE "contract_adjustments" ADD COLUMN     "isProvisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trueUpOfId" TEXT;

-- AlterTable
ALTER TABLE "index_data" ADD COLUMN     "estimateSource" TEXT,
ADD COLUMN     "isEstimate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "contract_periods" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "ContractPeriodKind" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "initialRent" DECIMAL(15,2) NOT NULL,
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_agreements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" "ContractAgreementKind" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "documentUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_terms_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "agreementId" TEXT,
    "adjustmentType" "AdjustmentType" NOT NULL,
    "adjustmentPeriod" "AdjustmentPeriod" NOT NULL,
    "adjustmentBase" "AdjustmentBase" NOT NULL DEFAULT 'Vigente',
    "indexLagMonths" INTEGER NOT NULL DEFAULT 2,
    "fixedInitialMonths" INTEGER NOT NULL DEFAULT 0,
    "customPct" DECIMAL(5,2),
    "customSteps" JSONB,
    "rentOverride" DECIMAL(15,2),
    "discountPct" DECIMAL(5,2),
    "discountAmount" DECIMAL(15,2),
    "dueDay" INTEGER NOT NULL,
    "paymentFlow" "PaymentFlow" NOT NULL DEFAULT 'Partido',
    "penaltyConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_terms_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_periods_tenantId_idx" ON "contract_periods"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_periods_contractId_seq_key" ON "contract_periods"("contractId", "seq");

-- CreateIndex
CREATE INDEX "contract_agreements_tenantId_idx" ON "contract_agreements"("tenantId");

-- CreateIndex
CREATE INDEX "contract_agreements_contractId_effectiveFrom_idx" ON "contract_agreements"("contractId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "contract_terms_versions_tenantId_idx" ON "contract_terms_versions"("tenantId");

-- CreateIndex
CREATE INDEX "contract_terms_versions_agreementId_idx" ON "contract_terms_versions"("agreementId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_terms_versions_contractId_validFrom_key" ON "contract_terms_versions"("contractId", "validFrom");

-- CreateIndex
CREATE INDEX "contracts_previousContractId_idx" ON "contracts"("previousContractId");

-- Guard: la clave única nueva no admite dos ajustes del mismo período.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "contract_adjustments"
    GROUP BY "contractId", "periodNumber" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'contract_adjustments tiene períodos repetidos por contrato: depurar antes de migrar';
  END IF;
END
$$;

-- CreateIndex
CREATE UNIQUE INDEX "contract_adjustments_contractId_periodNumber_isProvisional_key" ON "contract_adjustments"("contractId", "periodNumber", "isProvisional");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_previousContractId_fkey" FOREIGN KEY ("previousContractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_periods" ADD CONSTRAINT "contract_periods_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_agreements" ADD CONSTRAINT "contract_agreements_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms_versions" ADD CONSTRAINT "contract_terms_versions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_terms_versions" ADD CONSTRAINT "contract_terms_versions_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "contract_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: un período original por contrato. El alquiler inicial es el que
-- había antes del primer ajuste aplicado; sin ajustes aplicados, el actual.
INSERT INTO "contract_periods" ("id", "tenantId", "contractId", "seq", "kind", "startDate", "endDate", "initialRent")
SELECT gen_random_uuid()::text, c."tenantId", c."id", 1, 'Original', c."startDate", c."endDate",
  coalesce(
    (SELECT a."previousAmount" FROM "contract_adjustments" a
     WHERE a."contractId" = c."id" AND a."appliedAt" IS NOT NULL
     ORDER BY a."periodNumber" ASC LIMIT 1),
    c."rentAmount")
FROM "contracts" c;

-- Backfill: una versión de reglas por contrato, vigente desde el inicio, con
-- las columnas de hoy. El motor actual aplica el índice sobre el alquiler
-- vigente (Vigente), sin escalonado ni rezago propio, y el vencimiento
-- por defecto es el día 10. El reparto queda en Partido.
INSERT INTO "contract_terms_versions" ("id", "tenantId", "contractId", "validFrom", "adjustmentType", "adjustmentPeriod", "adjustmentBase", "indexLagMonths", "fixedInitialMonths", "customPct", "dueDay", "paymentFlow")
SELECT gen_random_uuid()::text, c."tenantId", c."id", c."startDate", c."adjustmentType", c."adjustmentPeriod", 'Vigente', 2, 0, c."customAdjustmentPct", 10, 'Partido'
FROM "contracts" c;
