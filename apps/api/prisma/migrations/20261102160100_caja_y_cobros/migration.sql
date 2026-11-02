-- Caja y cobros: cuentas de la inmobiliaria (caja, banco, custodia de un locador),
-- libro de movimientos, recibos de cobro numerados, compensaciones entre locadores
-- y los datos nuevos del cobro (quién lo recibió, en qué cuenta, custodia, recibo).
-- Backfill: los cobros existentes quedan como recibidos por la inmobiliaria
-- (default de "receivedBy"), sin cuenta, sin recibo y sin custodia: no se inventa
-- en qué cuenta entraron. No se crea ninguna cuenta: la caja y el banco de cada
-- moneda se crean la primera vez que se usan.
-- Rollback: DROP TABLE "compensations", "cash_movements" y luego, tras quitar las
-- FK de "payments", DROP TABLE "financial_accounts", "receipts"; después
-- ALTER TABLE "payments" DROP COLUMN "accountId", "externalRef", "inCustody",
-- "receiptId", "receivedBy", "receivedByUserId", "settlement". Los cobros
-- conservan importe, medio y fecha; se pierde quién recibió y el recibo.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "accountId" TEXT,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "inCustody" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "receiptId" TEXT,
ADD COLUMN     "receivedBy" "PaymentReceiver" NOT NULL DEFAULT 'Inmobiliaria',
ADD COLUMN     "receivedByUserId" TEXT,
ADD COLUMN     "settlement" JSONB;

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "FinancialAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "ownerPersonId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "direction" "CashDirection" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "category" "CashCategory" NOT NULL,
    "counterpartyId" TEXT,
    "contractId" TEXT,
    "rate" DECIMAL(18,6),
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fromLessorId" TEXT NOT NULL,
    "toLessorId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipts_tenantId_issuedAt_idx" ON "receipts"("tenantId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_tenantId_series_number_key" ON "receipts"("tenantId", "series", "number");

-- CreateIndex
CREATE INDEX "financial_accounts_tenantId_kind_currency_idx" ON "financial_accounts"("tenantId", "kind", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_tenantId_kind_ownerPersonId_currency_key" ON "financial_accounts"("tenantId", "kind", "ownerPersonId", "currency");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_accountId_date_idx" ON "cash_movements"("tenantId", "accountId", "date");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_category_date_idx" ON "cash_movements"("tenantId", "category", "date");

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_sourceType_sourceId_idx" ON "cash_movements"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "cash_movements_contractId_idx" ON "cash_movements"("contractId");

-- CreateIndex
CREATE INDEX "compensations_tenantId_idx" ON "compensations"("tenantId");

-- CreateIndex
CREATE INDEX "compensations_paymentId_idx" ON "compensations"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_receiptId_key" ON "payments"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tenantId_externalRef_key" ON "payments"("tenantId", "externalRef");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_fromLessorId_fkey" FOREIGN KEY ("fromLessorId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensations" ADD CONSTRAINT "compensations_toLessorId_fkey" FOREIGN KEY ("toLessorId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

