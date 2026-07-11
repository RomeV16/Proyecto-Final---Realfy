-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('Borrador', 'Activo', 'Vencido', 'Rescindido', 'Renovado', 'Archivado');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('Alquiler', 'AlquilerTemporario', 'Venta');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('IPC', 'ICL', 'CCP', 'FixedPercent', 'Custom');

-- CreateEnum
CREATE TYPE "AdjustmentPeriod" AS ENUM ('Mensual', 'Bimestral', 'Trimestral', 'Cuatrimestral', 'Semestral', 'Anual');

-- CreateEnum
CREATE TYPE "GuaranteeType" AS ENUM ('Seguro_de_caucion', 'Garantia_propietaria', 'Garantia_bancaria', 'Deposito', 'Otra');

-- CreateEnum
CREATE TYPE "GuaranteeStatus" AS ENUM ('Vigente', 'Vencida', 'Cancelada');

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'Borrador',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "rentAmount" DECIMAL(15,2) NOT NULL,
    "rentCurrency" "Currency" NOT NULL DEFAULT 'ARS',
    "depositAmount" DECIMAL(15,2),
    "depositCurrency" "Currency",
    "adjustmentType" "AdjustmentType" NOT NULL,
    "adjustmentPeriod" "AdjustmentPeriod" NOT NULL,
    "customAdjustmentPct" DECIMAL(5,2),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_persons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "PersonRole" NOT NULL,

    CONSTRAINT "contract_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_guarantees" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "type" "GuaranteeType" NOT NULL,
    "status" "GuaranteeStatus" NOT NULL DEFAULT 'Vigente',
    "description" TEXT,
    "amount" DECIMAL(15,2),
    "currency" "Currency",
    "issuer" TEXT,
    "policyNumber" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_guarantees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contracts_tenantId_idx" ON "contracts"("tenantId");

-- CreateIndex
CREATE INDEX "contracts_tenantId_status_idx" ON "contracts"("tenantId", "status");

-- CreateIndex
CREATE INDEX "contracts_tenantId_propertyId_idx" ON "contracts"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "contract_persons_tenantId_idx" ON "contract_persons"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_persons_contractId_personId_role_key" ON "contract_persons"("contractId", "personId", "role");

-- CreateIndex
CREATE INDEX "contract_guarantees_tenantId_idx" ON "contract_guarantees"("tenantId");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_persons" ADD CONSTRAINT "contract_persons_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_persons" ADD CONSTRAINT "contract_persons_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_guarantees" ADD CONSTRAINT "contract_guarantees_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

