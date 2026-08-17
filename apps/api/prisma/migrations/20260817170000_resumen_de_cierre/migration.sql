-- CreateEnum
CREATE TYPE "ClosureSummarySource" AS ENUM ('model', 'rules');

-- CreateTable
CREATE TABLE "contract_closure_summaries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "highlights" TEXT[],
    "metrics" JSONB NOT NULL,
    "source" "ClosureSummarySource" NOT NULL,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_closure_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_closure_summaries_contractId_key" ON "contract_closure_summaries"("contractId");

-- CreateIndex
CREATE INDEX "contract_closure_summaries_tenantId_idx" ON "contract_closure_summaries"("tenantId");

-- CreateIndex
CREATE INDEX "contract_closure_summaries_tenantId_source_idx" ON "contract_closure_summaries"("tenantId", "source");

-- AddForeignKey
ALTER TABLE "contract_closure_summaries" ADD CONSTRAINT "contract_closure_summaries_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

