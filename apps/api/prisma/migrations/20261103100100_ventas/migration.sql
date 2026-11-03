-- Ventas: operación de venta (de la captación a la escritura, que solo registra su fecha), partes con
-- su porcentaje, reservas y señas, y la documentación del inmueble. El honorario de venta se
-- vincula a la operación con `fees.salesOpId`; no hay honorarios de venta anteriores que migrar
-- (hasta ahora colgaban de la propiedad con `propertyId`, que se conserva).
-- Nada existente cambia: las tablas nacen vacías y la columna nueva queda en nulo.
-- Rollback: ALTER TABLE "fees" DROP CONSTRAINT "fees_salesOpId_fkey"; DROP INDEX "fees_salesOpId_idx";
-- ALTER TABLE "fees" DROP COLUMN "salesOpId"; DROP TABLE "sales_doc_checks", "sales_deposits",
-- "sales_parties", "sales_operations". Se pierden las ventas cargadas después de esta migración.

-- AlterTable
ALTER TABLE "fees" ADD COLUMN     "salesOpId" TEXT;

-- CreateTable
CREATE TABLE "sales_operations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "status" "SalesOperationStatus" NOT NULL DEFAULT 'Captacion',
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(15,2),
    "agreedPrice" DECIMAL(15,2),
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "agentUserId" TEXT,
    "boletoDate" DATE,
    "escrituraDate" DATE,
    "cancelReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_parties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOpId" TEXT NOT NULL,
    "role" "SalesPartyRole" NOT NULL,
    "personId" TEXT NOT NULL,
    "sharePct" DECIMAL(7,4) NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_deposits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOpId" TEXT NOT NULL,
    "kind" "SalesDepositKind" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "holder" "SalesDepositHolder" NOT NULL,
    "holderPersonId" TEXT,
    "payerPersonId" TEXT,
    "status" "SalesDepositStatus" NOT NULL DEFAULT 'Pendiente',
    "expiresAt" DATE,
    "receivedAt" DATE,
    "receivedMovementId" TEXT,
    "resolvedAt" DATE,
    "resolvedAmount" DECIMAL(15,2),
    "resolutionMovementId" TEXT,
    "resolutionNote" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_doc_checks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOpId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_doc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_operations_tenantId_status_idx" ON "sales_operations"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sales_operations_tenantId_propertyId_idx" ON "sales_operations"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "sales_operations_agentUserId_idx" ON "sales_operations"("agentUserId");

-- CreateIndex
CREATE INDEX "sales_parties_tenantId_idx" ON "sales_parties"("tenantId");

-- CreateIndex
CREATE INDEX "sales_parties_personId_idx" ON "sales_parties"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_parties_salesOpId_role_personId_key" ON "sales_parties"("salesOpId", "role", "personId");

-- CreateIndex
CREATE INDEX "sales_deposits_tenantId_status_idx" ON "sales_deposits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "sales_deposits_tenantId_expiresAt_idx" ON "sales_deposits"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "sales_deposits_salesOpId_idx" ON "sales_deposits"("salesOpId");

-- CreateIndex
CREATE INDEX "sales_deposits_holderPersonId_idx" ON "sales_deposits"("holderPersonId");

-- CreateIndex
CREATE INDEX "sales_deposits_payerPersonId_idx" ON "sales_deposits"("payerPersonId");

-- CreateIndex
CREATE INDEX "sales_doc_checks_tenantId_idx" ON "sales_doc_checks"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_doc_checks_salesOpId_code_key" ON "sales_doc_checks"("salesOpId", "code");

-- CreateIndex
CREATE INDEX "fees_salesOpId_idx" ON "fees"("salesOpId");

-- AddForeignKey
ALTER TABLE "fees" ADD CONSTRAINT "fees_salesOpId_fkey" FOREIGN KEY ("salesOpId") REFERENCES "sales_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_operations" ADD CONSTRAINT "sales_operations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_operations" ADD CONSTRAINT "sales_operations_agentUserId_fkey" FOREIGN KEY ("agentUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_parties" ADD CONSTRAINT "sales_parties_salesOpId_fkey" FOREIGN KEY ("salesOpId") REFERENCES "sales_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_parties" ADD CONSTRAINT "sales_parties_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deposits" ADD CONSTRAINT "sales_deposits_salesOpId_fkey" FOREIGN KEY ("salesOpId") REFERENCES "sales_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deposits" ADD CONSTRAINT "sales_deposits_holderPersonId_fkey" FOREIGN KEY ("holderPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_deposits" ADD CONSTRAINT "sales_deposits_payerPersonId_fkey" FOREIGN KEY ("payerPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_doc_checks" ADD CONSTRAINT "sales_doc_checks_salesOpId_fkey" FOREIGN KEY ("salesOpId") REFERENCES "sales_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
