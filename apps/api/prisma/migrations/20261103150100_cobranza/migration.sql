-- Cobranza escalonada (D13, ADR-0013): casos de cobranza por contrato
-- (`collection_cases`) y su línea de tiempo (`collection_actions`: avisos,
-- carta documento preparada o enviada, acuerdos, pagos y notas).
--
-- Sin backfill: las dos tablas nacen vacías. Los casos los abre el proceso
-- diario solo si la inmobiliaria prendió la cobranza en sus valores por
-- defecto (`collections.enabled`, apagada de fábrica), así que desplegar esta
-- migración no manda ni prepara nada. Ningún mensaje se despacha mientras
-- MESSAGING_MODE no esté en `allowlist` o `live`.
--
-- Rollback:
--   DROP TABLE "collection_actions"; DROP TABLE "collection_cases";

-- CreateTable
CREATE TABLE "collection_cases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "stage" "CollectionStage" NOT NULL DEFAULT 'Recordatorio',
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "overdueSince" TIMESTAMP(3) NOT NULL,
    "lastBalance" DECIMAL(15,2),
    "nextActionKind" "CollectionActionKind",
    "nextActionAt" TIMESTAMP(3),
    "pausedUntil" TIMESTAMP(3),
    "letterPreparedOn" TIMESTAMP(3),
    "letterSentOn" TIMESTAMP(3),
    "assigneeId" TEXT,
    "closeReason" TEXT,
    "openedOn" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_actions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "CollectionActionKind" NOT NULL,
    "status" "CollectionActionStatus" NOT NULL DEFAULT 'Realizada',
    "level" INTEGER,
    "channel" "MessageChannel",
    "outboxMessageId" TEXT,
    "amount" DECIMAL(15,2),
    "onDate" TIMESTAMP(3),
    "note" TEXT,
    "data" JSONB,
    "key" TEXT,
    "createdByUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "collection_cases_tenantId_stage_nextActionAt_idx" ON "collection_cases"("tenantId", "stage", "nextActionAt");

-- CreateIndex
CREATE INDEX "collection_cases_tenantId_contractId_idx" ON "collection_cases"("tenantId", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "collection_cases_contractId_openedOn_key" ON "collection_cases"("contractId", "openedOn");

-- CreateIndex
CREATE INDEX "collection_actions_tenantId_caseId_at_idx" ON "collection_actions"("tenantId", "caseId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "collection_actions_caseId_key_key" ON "collection_actions"("caseId", "key");

-- AddForeignKey
ALTER TABLE "collection_cases" ADD CONSTRAINT "collection_cases_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "collection_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "message_outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
