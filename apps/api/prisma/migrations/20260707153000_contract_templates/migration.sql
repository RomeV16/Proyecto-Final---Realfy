-- CreateTable
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_templates_tenantId_idx" ON "contract_templates"("tenantId");

-- CreateIndex
CREATE INDEX "contract_templates_tenantId_contractType_idx" ON "contract_templates"("tenantId", "contractType");

-- CreateIndex
CREATE INDEX "contract_templates_tenantId_isActive_idx" ON "contract_templates"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_tenantId_name_key" ON "contract_templates"("tenantId", "name");

