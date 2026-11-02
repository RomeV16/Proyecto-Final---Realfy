-- Honorarios (D10): honorario por operación y por quien lo paga, sus cuotas,
-- las comisiones del personal y el coorretaje; y la cuota que factura un
-- comprobante (D0, `comprobantes.feeInstallmentId`).
--
-- Sin backfill: las cuatro tablas nacen vacías. Los honorarios cobrados antes
-- (anotados en planillas o como movimientos manuales de caja de categoría
-- Honorario) no se reconstruyen; los que tienen cuotas pendientes se cargan
-- a mano desde la pantalla de honorarios. `feeInstallmentId` nace nulo en todos los
-- comprobantes existentes.
--
-- Rollback:
--   ALTER TABLE "comprobantes" DROP COLUMN "feeInstallmentId";
--   DROP TABLE "fee_shares"; DROP TABLE "staff_commissions";
--   DROP TABLE "fee_installments"; DROP TABLE "fees";

-- AlterTable
ALTER TABLE "comprobantes" ADD COLUMN     "feeInstallmentId" TEXT;

-- CreateTable
CREATE TABLE "fees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT,
    "kind" "FeeKind" NOT NULL,
    "status" "FeeStatus" NOT NULL DEFAULT 'Pendiente',
    "contractId" TEXT,
    "contractPeriodId" TEXT,
    "propertyId" TEXT,
    "valuationId" TEXT,
    "payerPersonId" TEXT NOT NULL,
    "payerRole" "FeePayerRole" NOT NULL,
    "basis" "FeeBasis" NOT NULL,
    "pct" DECIMAL(7,4),
    "baseAmount" DECIMAL(15,2) NOT NULL,
    "vatMode" "FeeVatMode" NOT NULL DEFAULT 'NoAplica',
    "vatPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(15,2) NOT NULL,
    "vatAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "installments" INTEGER NOT NULL,
    "adjustInstallments" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_installments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "adjustedAmount" DECIMAL(15,2),
    "status" "FeeInstallmentStatus" NOT NULL DEFAULT 'Pendiente',
    "paidAt" DATE,
    "paidAmount" DECIMAL(15,2),
    "settlement" "FeeSettlement",
    "receiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fee_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_commissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "userId" TEXT,
    "personId" TEXT,
    "pct" DECIMAL(7,4) NOT NULL,
    "baseAmount" DECIMAL(15,2) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "paidAt" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_shares" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feeId" TEXT NOT NULL,
    "counterparty" TEXT NOT NULL,
    "pct" DECIMAL(7,4) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fees_tenantId_kind_status_idx" ON "fees"("tenantId", "kind", "status");

-- CreateIndex
CREATE INDEX "fees_tenantId_payerPersonId_idx" ON "fees"("tenantId", "payerPersonId");

-- CreateIndex
CREATE INDEX "fees_contractId_idx" ON "fees"("contractId");

-- CreateIndex
CREATE INDEX "fees_contractPeriodId_idx" ON "fees"("contractPeriodId");

-- CreateIndex
CREATE INDEX "fees_propertyId_idx" ON "fees"("propertyId");

-- CreateIndex
CREATE INDEX "fees_valuationId_idx" ON "fees"("valuationId");

-- CreateIndex
CREATE INDEX "fees_groupId_idx" ON "fees"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "fee_installments_receiptId_key" ON "fee_installments"("receiptId");

-- CreateIndex
CREATE INDEX "fee_installments_tenantId_status_dueDate_idx" ON "fee_installments"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "fee_installments_feeId_n_key" ON "fee_installments"("feeId", "n");

-- CreateIndex
CREATE INDEX "staff_commissions_tenantId_paidAt_idx" ON "staff_commissions"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "staff_commissions_feeId_idx" ON "staff_commissions"("feeId");

-- CreateIndex
CREATE INDEX "staff_commissions_userId_idx" ON "staff_commissions"("userId");

-- CreateIndex
CREATE INDEX "staff_commissions_personId_idx" ON "staff_commissions"("personId");

-- CreateIndex
CREATE INDEX "fee_shares_tenantId_idx" ON "fee_shares"("tenantId");

-- CreateIndex
CREATE INDEX "fee_shares_feeId_idx" ON "fee_shares"("feeId");

-- CreateIndex
CREATE INDEX "comprobantes_feeInstallmentId_idx" ON "comprobantes"("feeInstallmentId");

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_contractPeriodId_fkey" FOREIGN KEY ("contractPeriodId") REFERENCES "contract_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "property_valuations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_payerPersonId_fkey" FOREIGN KEY ("payerPersonId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_commissions" ADD CONSTRAINT "staff_commissions_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_commissions" ADD CONSTRAINT "staff_commissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_commissions" ADD CONSTRAINT "staff_commissions_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_shares" ADD CONSTRAINT "fee_shares_feeId_fkey" FOREIGN KEY ("feeId") REFERENCES "fees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_feeInstallmentId_fkey" FOREIGN KEY ("feeInstallmentId") REFERENCES "fee_installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Una comisión va a un usuario o a una persona, nunca a los dos ni a ninguno.
ALTER TABLE "staff_commissions" ADD CONSTRAINT "staff_commissions_beneficiary_check"
  CHECK (("userId" IS NULL) <> ("personId" IS NULL));

-- Importes de las cuotas, nunca negativos; el número de cuota empieza en 1.
ALTER TABLE "fee_installments" ADD CONSTRAINT "fee_installments_amount_check"
  CHECK ("amount" >= 0 AND "n" >= 1);
