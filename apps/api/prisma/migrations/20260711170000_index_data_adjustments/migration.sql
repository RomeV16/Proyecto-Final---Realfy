-- CreateEnum
CREATE TYPE "IndexType" AS ENUM ('IPC', 'ICL', 'CVS', 'CER', 'UVA');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('Pending', 'Calculated', 'Applied', 'Skipped');

-- CreateTable
CREATE TABLE "contract_adjustments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "adjustmentDate" TIMESTAMP(3) NOT NULL,
    "previousAmount" DECIMAL(15,2) NOT NULL,
    "newAmount" DECIMAL(15,2) NOT NULL,
    "percentage" DECIMAL(8,4) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "indexType" "AdjustmentType",
    "indexValues" JSONB,
    "notes" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "contract_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "nextAdjustmentDate" TIMESTAMP(3) NOT NULL,
    "periodNumber" INTEGER NOT NULL,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'Pending',

    CONSTRAINT "adjustment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_data" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "indexType" "IndexType" NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(12,6) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_adjustments_tenantId_idx" ON "contract_adjustments"("tenantId");

-- CreateIndex
CREATE INDEX "contract_adjustments_contractId_periodNumber_idx" ON "contract_adjustments"("contractId", "periodNumber");

-- CreateIndex
CREATE INDEX "adjustment_schedules_tenantId_idx" ON "adjustment_schedules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_schedules_contractId_periodNumber_key" ON "adjustment_schedules"("contractId", "periodNumber");

-- CreateIndex
CREATE INDEX "index_data_tenantId_idx" ON "index_data"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "index_data_tenantId_indexType_period_key" ON "index_data"("tenantId", "indexType", "period");

-- AddForeignKey
ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_schedules" ADD CONSTRAINT "adjustment_schedules_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

