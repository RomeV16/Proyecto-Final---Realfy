-- Incidencias y reparaciones: el ticket suma contrato, costo estimado, preautorización
-- del locador e imputación, "costPayer" pasa de texto libre a ChargeTarget (el mismo
-- tipo que el centro de carga) y nacen los presupuestos de proveedores.
--
-- Backfill de "costPayer" (sin distinguir mayúsculas, tildes ni espacios sobrantes):
--   Inquilino:    inquilino, inquilina, locatario, locataria, tenant
--   Locador:      locador, locadora, propietario, propietaria, dueño, dueña, owner, landlord
--   Inmobiliaria: inmobiliaria, agencia, agency
-- Cualquier otro texto queda en NULL; no se pierde: se agrega a "providerNotes"
-- ("Quién pagaba (texto anterior): ...") y se avisa con un NOTICE con la cantidad.
-- Los tickets existentes no se tocan en lo demás: sin contrato, sin estimado, sin
-- preautorización, sin imputar.
-- Rollback: DROP TABLE "ticket_quotes"; ALTER TABLE "tickets" ADD COLUMN "costPayerText"
-- TEXT, UPDATE "tickets" SET "costPayerText" = "costPayer"::text, DROP COLUMN
-- "costPayer", RENAME "costPayerText" TO "costPayer"; y DROP COLUMN "contractId",
-- "estimatedAmount", "preauthorizedAmount", "preauthorizedByPersonId",
-- "preauthorizedAt", "preauthorizedChannel", "imputedAt". Los cargos creados al
-- imputar siguen en "pending_charges" con sourceType 'Ticket'.

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "estimatedAmount" DECIMAL(15,2),
ADD COLUMN     "imputedAt" TIMESTAMP(3),
ADD COLUMN     "preauthorizedAmount" DECIMAL(15,2),
ADD COLUMN     "preauthorizedAt" TIMESTAMP(3),
ADD COLUMN     "preauthorizedByPersonId" TEXT,
ADD COLUMN     "preauthorizedChannel" "ApprovalChannel",
ADD COLUMN     "costPayerNew" "ChargeTarget";

-- Backfill: texto libre -> ChargeTarget
UPDATE "tickets" SET "costPayerNew" = CASE translate(lower(btrim("costPayer")), 'áéíóúñ', 'aeioun')
    WHEN 'inquilino' THEN 'Inquilino'::"ChargeTarget"
    WHEN 'inquilina' THEN 'Inquilino'::"ChargeTarget"
    WHEN 'locatario' THEN 'Inquilino'::"ChargeTarget"
    WHEN 'locataria' THEN 'Inquilino'::"ChargeTarget"
    WHEN 'tenant' THEN 'Inquilino'::"ChargeTarget"
    WHEN 'locador' THEN 'Locador'::"ChargeTarget"
    WHEN 'locadora' THEN 'Locador'::"ChargeTarget"
    WHEN 'propietario' THEN 'Locador'::"ChargeTarget"
    WHEN 'propietaria' THEN 'Locador'::"ChargeTarget"
    WHEN 'dueno' THEN 'Locador'::"ChargeTarget"
    WHEN 'duena' THEN 'Locador'::"ChargeTarget"
    WHEN 'owner' THEN 'Locador'::"ChargeTarget"
    WHEN 'landlord' THEN 'Locador'::"ChargeTarget"
    WHEN 'inmobiliaria' THEN 'Inmobiliaria'::"ChargeTarget"
    WHEN 'agencia' THEN 'Inmobiliaria'::"ChargeTarget"
    WHEN 'agency' THEN 'Inmobiliaria'::"ChargeTarget"
    ELSE NULL
END
WHERE "costPayer" IS NOT NULL;

-- Lo que no se reconoció se conserva en las notas del proveedor.
DO $$
DECLARE
    unknown_count INTEGER;
BEGIN
    UPDATE "tickets"
    SET "providerNotes" = CASE
        WHEN "providerNotes" IS NULL OR btrim("providerNotes") = '' THEN 'Quién pagaba (texto anterior): ' || btrim("costPayer")
        ELSE "providerNotes" || E'\n' || 'Quién pagaba (texto anterior): ' || btrim("costPayer")
    END
    WHERE "costPayer" IS NOT NULL AND btrim("costPayer") <> '' AND "costPayerNew" IS NULL;
    GET DIAGNOSTICS unknown_count = ROW_COUNT;
    IF unknown_count > 0 THEN
        RAISE NOTICE 'tickets.costPayer: % valores sin equivalente quedaron en NULL (texto en providerNotes)', unknown_count;
    END IF;
END $$;

ALTER TABLE "tickets" DROP COLUMN "costPayer";
ALTER TABLE "tickets" RENAME COLUMN "costPayerNew" TO "costPayer";

-- CreateTable
CREATE TABLE "ticket_quotes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "status" "TicketQuoteStatus" NOT NULL DEFAULT 'Pendiente',
    "approvedByPersonId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "channel" "ApprovalChannel",
    "documentUrl" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_quotes_tenantId_ticketId_idx" ON "ticket_quotes"("tenantId", "ticketId");

-- CreateIndex
CREATE INDEX "ticket_quotes_providerId_idx" ON "ticket_quotes"("providerId");

-- CreateIndex
CREATE INDEX "ticket_quotes_approvedByPersonId_idx" ON "ticket_quotes"("approvedByPersonId");

-- CreateIndex
CREATE INDEX "tickets_tenantId_contractId_idx" ON "tickets"("tenantId", "contractId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_preauthorizedByPersonId_fkey" FOREIGN KEY ("preauthorizedByPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_quotes" ADD CONSTRAINT "ticket_quotes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_quotes" ADD CONSTRAINT "ticket_quotes_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_quotes" ADD CONSTRAINT "ticket_quotes_approvedByPersonId_fkey" FOREIGN KEY ("approvedByPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
