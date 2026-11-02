-- Depósitos y liquidación de egreso: el depósito del contrato con su moneda, quién lo
-- guarda, sus cuotas y la regla de devolución, y la liquidación de egreso.
-- Backfill: cada contrato con `depositAmount` pasa a `contract_deposits` con una sola
-- cuota cobrada en la fecha de inicio del contrato. Por defecto lo guarda el
-- Locador (sin persona asignada): es lo que declaró la inmobiliaria y no genera
-- ningún movimiento de caja ni deuda de la inmobiliaria. La regla de devolución es
-- pesos actualizado si el depósito es en pesos y la misma moneda en los demás casos.
-- Las columnas `contracts.depositAmount` y `depositCurrency` quedan sin uso, no se
-- borran.
-- Rollback: DROP TABLE "move_out_settlements", "contract_deposit_installments",
-- "contract_deposits". Se pierden los depósitos cargados después de esta migración y
-- las liquidaciones de egreso; los datos originales siguen en `contracts`.

-- CreateTable
CREATE TABLE "contract_deposits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "heldBy" "DepositHolder" NOT NULL,
    "heldByPersonId" TEXT,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "refundRule" "DepositRefundRule" NOT NULL,
    "refundInstallments" INTEGER NOT NULL DEFAULT 1,
    "refundDueDays" INTEGER NOT NULL DEFAULT 30,
    "status" "DepositStatus" NOT NULL DEFAULT 'Pendiente',
    "refundedAt" DATE,
    "refundedAmount" DECIMAL(15,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_deposit_installments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paidAt" DATE,
    "cashMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_deposit_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "move_out_settlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "MoveOutStatus" NOT NULL DEFAULT 'Borrador',
    "items" JSONB NOT NULL,
    "totalOwed" DECIMAL(15,2) NOT NULL,
    "depositAvailable" DECIMAL(15,2) NOT NULL,
    "netAmount" DECIMAL(15,2) NOT NULL,
    "rate" DECIMAL(18,6),
    "notes" TEXT,
    "cashMovementId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "move_out_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_deposits_contractId_key" ON "contract_deposits"("contractId");

-- CreateIndex
CREATE INDEX "contract_deposits_tenantId_status_idx" ON "contract_deposits"("tenantId", "status");

-- CreateIndex
CREATE INDEX "contract_deposit_installments_tenantId_idx" ON "contract_deposit_installments"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_deposit_installments_depositId_number_key" ON "contract_deposit_installments"("depositId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "move_out_settlements_contractId_key" ON "move_out_settlements"("contractId");

-- CreateIndex
CREATE INDEX "move_out_settlements_tenantId_status_idx" ON "move_out_settlements"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "contract_deposits" ADD CONSTRAINT "contract_deposits_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_deposits" ADD CONSTRAINT "contract_deposits_heldByPersonId_fkey" FOREIGN KEY ("heldByPersonId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_deposit_installments" ADD CONSTRAINT "contract_deposit_installments_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "contract_deposits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "move_out_settlements" ADD CONSTRAINT "move_out_settlements_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: un depósito por contrato que tenía importe.
INSERT INTO "contract_deposits" (
  "id", "tenantId", "contractId", "amount", "currency", "heldBy", "installments",
  "refundRule", "refundInstallments", "refundDueDays", "status", "updatedAt"
)
SELECT
  gen_random_uuid()::text, c."tenantId", c."id", c."depositAmount",
  COALESCE(c."depositCurrency", c."rentCurrency"), 'Locador', 1,
  CASE WHEN COALESCE(c."depositCurrency", c."rentCurrency") = 'ARS'
       THEN 'PesosActualizado'::"DepositRefundRule"
       ELSE 'MismaMoneda'::"DepositRefundRule" END,
  1, 30, 'Cobrado', now()
FROM "contracts" c
WHERE c."depositAmount" IS NOT NULL AND c."depositAmount" > 0;

INSERT INTO "contract_deposit_installments" (
  "id", "tenantId", "depositId", "number", "dueDate", "amount", "paidAt"
)
SELECT
  gen_random_uuid()::text, d."tenantId", d."id", 1, c."startDate"::date, d."amount", c."startDate"::date
FROM "contract_deposits" d
JOIN "contracts" c ON c."id" = d."contractId";
