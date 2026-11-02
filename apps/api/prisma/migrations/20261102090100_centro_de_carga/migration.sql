-- Centro de carga: gastos y cargos puntuales del mes (reparaciones, expensas
-- extraordinarias, devoluciones, honorarios por gestión) que se imputan una sola vez al
-- inquilino en su próxima liquidación o al locador en su próximo estado.
-- Las versiones de reglas del contrato suman el umbral de anticipo propio (null = el de la
-- inmobiliaria) y la comisión sobre la que se mide.
-- Backfill: la tabla nace vacía; las versiones existentes quedan con umbral null y base
-- ComisionPactada, que es el comportamiento que ya tenía el centro de carga.
-- Rollback: ALTER TABLE "contract_terms_versions" DROP COLUMN "upfrontThresholdFees",
-- DROP COLUMN "upfrontBasis"; DROP TABLE "pending_charges" (las liquidaciones que ya incluyeron un
-- cargo conservan su renglón; solo se pierde el vínculo con el cargo de origen).

-- AlterTable
ALTER TABLE "contract_terms_versions" ADD COLUMN     "upfrontBasis" "UpfrontBasis" NOT NULL DEFAULT 'ComisionPactada',
ADD COLUMN     "upfrontThresholdFees" INTEGER;

-- CreateTable
CREATE TABLE "pending_charges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "contractId" TEXT,
    "chargedTo" "ChargeTarget" NOT NULL,
    "lessorPersonId" TEXT,
    "kind" "PendingChargeKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "beneficiary" "LineBeneficiary" NOT NULL DEFAULT 'Locador',
    "incurredAt" DATE NOT NULL,
    "targetPeriod" DATE,
    "status" "PendingChargeStatus" NOT NULL DEFAULT 'Pendiente',
    "requiresUpfront" BOOLEAN NOT NULL DEFAULT false,
    "installmentNo" INTEGER NOT NULL DEFAULT 1,
    "installmentOf" INTEGER NOT NULL DEFAULT 1,
    "installmentGroupId" TEXT,
    "imputedLiquidacionId" TEXT,
    "imputedStatementId" TEXT,
    "imputedAt" TIMESTAMP(3),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_charges_tenantId_contractId_status_idx" ON "pending_charges"("tenantId", "contractId", "status");

-- CreateIndex
CREATE INDEX "pending_charges_tenantId_propertyId_status_idx" ON "pending_charges"("tenantId", "propertyId", "status");

-- CreateIndex
CREATE INDEX "pending_charges_imputedLiquidacionId_idx" ON "pending_charges"("imputedLiquidacionId");

-- AddForeignKey
ALTER TABLE "pending_charges" ADD CONSTRAINT "pending_charges_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_charges" ADD CONSTRAINT "pending_charges_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_charges" ADD CONSTRAINT "pending_charges_lessorPersonId_fkey" FOREIGN KEY ("lessorPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_charges" ADD CONSTRAINT "pending_charges_imputedLiquidacionId_fkey" FOREIGN KEY ("imputedLiquidacionId") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

