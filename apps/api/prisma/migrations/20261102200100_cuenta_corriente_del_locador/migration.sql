-- Cuenta corriente del locador (ADR-0009): asientos por locador y estado de
-- cuenta mensual consolidado, y el porcentaje de honorario por gestión de
-- reparaciones en la comisión del contrato.
--
-- Sin backfill: las dos tablas nacen vacías. La historia no se reconstruye
-- (las rendiciones viejas quedan como histórico de solo lectura); cada locador
-- arranca con un saldo inicial por moneda, que carga la gerencia o la
-- importación. `repairMgmtFeePct` nace nulo: ningún contrato cobra honorario por
-- gestión hasta que se pacte.
--
-- Rollback:
--   DROP TABLE "owner_ledger_entries"; DROP TABLE "owner_statements";
--   ALTER TABLE "contract_commissions" DROP COLUMN "repairMgmtFeePct";

-- AlterTable
ALTER TABLE "contract_commissions" ADD COLUMN     "repairMgmtFeePct" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "owner_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "contractId" TEXT,
    "propertyId" TEXT,
    "date" DATE NOT NULL,
    "period" DATE NOT NULL,
    "type" "OwnerLedgerEntryType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "description" TEXT NOT NULL,
    "statementId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_statements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "OwnerStatementStatus" NOT NULL DEFAULT 'Borrador',
    "opening" DECIMAL(15,2) NOT NULL,
    "credits" DECIMAL(15,2) NOT NULL,
    "debits" DECIMAL(15,2) NOT NULL,
    "payouts" DECIMAL(15,2) NOT NULL,
    "closing" DECIMAL(15,2) NOT NULL,
    "pdfUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "annulledAt" TIMESTAMP(3),
    "annulReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_ledger_entries_tenantId_personId_currency_date_idx" ON "owner_ledger_entries"("tenantId", "personId", "currency", "date");

-- CreateIndex
CREATE INDEX "owner_ledger_entries_tenantId_period_idx" ON "owner_ledger_entries"("tenantId", "period");

-- CreateIndex
CREATE INDEX "owner_ledger_entries_statementId_idx" ON "owner_ledger_entries"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_ledger_entries_tenantId_sourceType_sourceId_personId__key" ON "owner_ledger_entries"("tenantId", "sourceType", "sourceId", "personId", "type");

-- CreateIndex
CREATE INDEX "owner_statements_tenantId_period_idx" ON "owner_statements"("tenantId", "period");

-- CreateIndex
CREATE INDEX "owner_statements_tenantId_status_idx" ON "owner_statements"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "owner_statements_tenantId_personId_period_currency_key" ON "owner_statements"("tenantId", "personId", "period", "currency");

-- AddForeignKey
ALTER TABLE "owner_ledger_entries" ADD CONSTRAINT "owner_ledger_entries_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_ledger_entries" ADD CONSTRAINT "owner_ledger_entries_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_ledger_entries" ADD CONSTRAINT "owner_ledger_entries_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_ledger_entries" ADD CONSTRAINT "owner_ledger_entries_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "owner_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_statements" ADD CONSTRAINT "owner_statements_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
