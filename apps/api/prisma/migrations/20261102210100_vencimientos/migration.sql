-- Vencimientos: seguimientos del fin de contrato (devolución o renovación) con su
-- checklist, y los datos de renovación del período (honorarios y garantes).
-- Backfill: ninguno. No se crea ningún seguimiento (los abre el proceso diario);
-- los períodos existentes quedan sin honorarios y con la lista de garantes vacía.
-- Rollback: DROP TABLE "follow_up_tasks", "contract_follow_ups"; después
-- ALTER TABLE "contract_periods" DROP COLUMN "feeAmount", "feeCurrency",
-- "guarantorPersonIds". Se pierden los seguimientos y los honorarios y garantes
-- anotados en las renovaciones; los períodos y sus fechas quedan.

-- AlterTable
ALTER TABLE "contract_periods" ADD COLUMN     "feeAmount" DECIMAL(15,2),
ADD COLUMN     "feeCurrency" "Currency",
ADD COLUMN     "guarantorPersonIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "contract_follow_ups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" "FollowUpKind" NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'Abierto',
    "dueDate" DATE NOT NULL,
    "assigneeId" TEXT,
    "outcome" "FollowUpOutcome" NOT NULL DEFAULT 'Pendiente',
    "notes" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_tasks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "dueDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_up_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_follow_ups_tenantId_status_idx" ON "contract_follow_ups"("tenantId", "status");

-- CreateIndex
CREATE INDEX "contract_follow_ups_tenantId_assigneeId_idx" ON "contract_follow_ups"("tenantId", "assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_follow_ups_contractId_kind_dueDate_key" ON "contract_follow_ups"("contractId", "kind", "dueDate");

-- CreateIndex
CREATE INDEX "follow_up_tasks_tenantId_idx" ON "follow_up_tasks"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_tasks_followUpId_code_key" ON "follow_up_tasks"("followUpId", "code");

-- AddForeignKey
ALTER TABLE "contract_follow_ups" ADD CONSTRAINT "contract_follow_ups_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "contract_follow_ups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

