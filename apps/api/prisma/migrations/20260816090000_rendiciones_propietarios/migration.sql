-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('FixedPercent', 'FixedAmount', 'Mixed');

-- CreateEnum
CREATE TYPE "RendicionStatus" AS ENUM ('Borrador', 'Aprobada', 'Enviada', 'Depositada');

-- CreateEnum
CREATE TYPE "RendicionLineItemType" AS ENUM ('Alquiler', 'Comision', 'AdminFee', 'Deduccion', 'Ajuste');

-- CreateTable
CREATE TABLE "contract_commissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL,
    "percentage" DECIMAL(5,2),
    "fixedAmount" DECIMAL(15,2),
    "adminFee" DECIMAL(15,2),
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_rendiciones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "status" "RendicionStatus" NOT NULL DEFAULT 'Borrador',
    "rentCollected" DECIMAL(15,2) NOT NULL,
    "commissionAmount" DECIMAL(15,2) NOT NULL,
    "adminFeeAmount" DECIMAL(15,2) NOT NULL,
    "deductionTotal" DECIMAL(15,2) NOT NULL,
    "netDeposit" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "pdfUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "depositedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_rendiciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rendicion_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "rendicionId" TEXT NOT NULL,
    "type" "RendicionLineItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "isDebit" BOOLEAN NOT NULL DEFAULT false,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rendicion_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_commissions_contractId_key" ON "contract_commissions"("contractId");

-- CreateIndex
CREATE INDEX "contract_commissions_tenantId_idx" ON "contract_commissions"("tenantId");

-- CreateIndex
CREATE INDEX "owner_rendiciones_tenantId_idx" ON "owner_rendiciones"("tenantId");

-- CreateIndex
CREATE INDEX "owner_rendiciones_tenantId_status_idx" ON "owner_rendiciones"("tenantId", "status");

-- CreateIndex
CREATE INDEX "owner_rendiciones_tenantId_ownerId_idx" ON "owner_rendiciones"("tenantId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_rendiciones_contractId_period_key" ON "owner_rendiciones"("contractId", "period");

-- CreateIndex
CREATE INDEX "rendicion_line_items_tenantId_idx" ON "rendicion_line_items"("tenantId");

-- CreateIndex
CREATE INDEX "rendicion_line_items_rendicionId_idx" ON "rendicion_line_items"("rendicionId");

-- AddForeignKey
ALTER TABLE "contract_commissions" ADD CONSTRAINT "contract_commissions_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_rendiciones" ADD CONSTRAINT "owner_rendiciones_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_rendiciones" ADD CONSTRAINT "owner_rendiciones_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rendicion_line_items" ADD CONSTRAINT "rendicion_line_items_rendicionId_fkey" FOREIGN KEY ("rendicionId") REFERENCES "owner_rendiciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

