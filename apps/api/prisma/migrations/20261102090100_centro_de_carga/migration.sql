-- Centro de carga: gastos y cargos puntuales del mes (reparaciones, expensas
-- extraordinarias, devoluciones, honorarios por gestión) que se imputan una sola vez al
-- inquilino en su próxima liquidación o al locador en su próximo estado.
-- Backfill: ninguno; la tabla nace vacía y la versión anterior la ignora.
-- Rollback: DROP TABLE "pending_charges" (las liquidaciones que ya incluyeron un
-- cargo conservan su renglón; solo se pierde el vínculo con el cargo de origen).

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

