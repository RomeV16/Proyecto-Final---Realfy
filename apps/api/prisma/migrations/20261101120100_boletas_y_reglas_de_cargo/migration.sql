-- Boletas de servicios e impuestos y reglas de traslado por contrato.
-- "services" suma la frecuencia de la boleta y si admite pago anual;
-- "contract_charge_rules" dice quién paga cada servicio de un contrato y cómo se
-- reparte, con vigencia (una regla nueva cierra la anterior, nunca se pisa);
-- "service_bills" son las boletas (entidad propia, distinta de los pagos);
-- "service_bill_allocations" son las partes que se cobran al inquilino en cada
-- liquidación, y se facturan una sola vez.
-- Backfill: los servicios existentes quedan con frecuencia Mensual y sin pago
-- anual (los valores por defecto de las columnas), igual que se comportaban; no
-- hay boletas ni reglas previas. Las tablas nuevas nacen vacías.
-- Rollback: ALTER TABLE "service_payments" DROP COLUMN "billId" (borra su
-- índice y clave); DROP TABLE "service_bill_allocations", "service_bills",
-- "contract_charge_rules"; ALTER TABLE "services" DROP COLUMN
-- "billingFrequency", DROP COLUMN "hasAnnualOption". La versión anterior ignora
-- las columnas y tablas nuevas.

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "billingFrequency" "BillingFrequency" NOT NULL DEFAULT 'Mensual',
ADD COLUMN     "hasAnnualOption" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "service_payments" ADD COLUMN     "billId" TEXT;

-- CreateTable
CREATE TABLE "contract_charge_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "payer" "ChargePayer" NOT NULL,
    "splitMode" "ChargeSplitMode" NOT NULL DEFAULT 'Porcentaje',
    "tenantSharePct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "fixedAmount" DECIMAL(15,2),
    "paymentPlan" "ServicePaymentPlan" NOT NULL DEFAULT 'Mensual',
    "annualRecovery" "AnnualRecovery" NOT NULL DEFAULT 'Prorrateado',
    "annualDiscountToTenant" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "agreementId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_charge_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "installmentLabel" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "nominalAmount" DECIMAL(15,2),
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "dueDate" DATE,
    "consumption" DECIMAL(15,3),
    "unitConsumptions" JSONB,
    "status" "ServiceBillStatus" NOT NULL DEFAULT 'Pendiente',
    "paidBy" "BillPaidBy",
    "paidAt" TIMESTAMP(3),
    "receiptUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_bill_allocations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ruleId" TEXT,
    "payer" "ChargePayer" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "basis" TEXT NOT NULL,
    "chargePeriod" DATE NOT NULL,
    "installmentNo" INTEGER NOT NULL DEFAULT 1,
    "installmentsTotal" INTEGER NOT NULL DEFAULT 1,
    "liquidacionId" TEXT,
    "billedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_bill_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_charge_rules_tenantId_idx" ON "contract_charge_rules"("tenantId");

-- CreateIndex
CREATE INDEX "contract_charge_rules_serviceId_validFrom_idx" ON "contract_charge_rules"("serviceId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "contract_charge_rules_contractId_serviceId_validFrom_key" ON "contract_charge_rules"("contractId", "serviceId", "validFrom");

-- CreateIndex
CREATE INDEX "service_bills_tenantId_period_idx" ON "service_bills"("tenantId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "service_bills_serviceId_period_installmentLabel_key" ON "service_bills"("serviceId", "period", "installmentLabel");

-- CreateIndex
CREATE INDEX "service_bill_allocations_tenantId_contractId_billedAt_charg_idx" ON "service_bill_allocations"("tenantId", "contractId", "billedAt", "chargePeriod");

-- CreateIndex
CREATE UNIQUE INDEX "service_bill_allocations_billId_contractId_chargePeriod_key" ON "service_bill_allocations"("billId", "contractId", "chargePeriod");

-- CreateIndex
CREATE INDEX "service_payments_billId_idx" ON "service_payments"("billId");

-- AddForeignKey
ALTER TABLE "service_payments" ADD CONSTRAINT "service_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "service_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_charge_rules" ADD CONSTRAINT "contract_charge_rules_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_charge_rules" ADD CONSTRAINT "contract_charge_rules_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_charge_rules" ADD CONSTRAINT "contract_charge_rules_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "contract_agreements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bill_allocations" ADD CONSTRAINT "service_bill_allocations_billId_fkey" FOREIGN KEY ("billId") REFERENCES "service_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bill_allocations" ADD CONSTRAINT "service_bill_allocations_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bill_allocations" ADD CONSTRAINT "service_bill_allocations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bill_allocations" ADD CONSTRAINT "service_bill_allocations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "contract_charge_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

