-- Mensajería saliente (D13, ADR-0013): bandeja de salida con clave de
-- idempotencia (`message_outbox`), historial de consentimiento por canal
-- (`contact_consents`, Ley 25.326: vale el último registro y una baja se
-- respeta siempre) y mensajes entrantes mínimos (`inbound_messages`, para la
-- bandeja de consultas del PR 5.3).
--
-- Sin backfill: las tres tablas nacen vacías. Los mails que hasta ahora salían
-- directo (liquidación al inquilino, avisos al personal, invitaciones) pasan
-- a encolarse desde este cambio; los ya enviados no se reconstruyen. Ningún
-- mensaje se despacha mientras MESSAGING_MODE no esté en `allowlist` o `live`.
--
-- Rollback:
--   DROP TABLE "inbound_messages"; DROP TABLE "contact_consents";
--   DROP TABLE "message_outbox";

-- CreateTable
CREATE TABLE "message_outbox" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "personId" TEXT,
    "to" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "status" "MessageStatus" NOT NULL DEFAULT 'Pending',
    "statusReason" TEXT,
    "providerMsgId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "relatedType" TEXT,
    "relatedId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT,
    "channel" "MessageChannel" NOT NULL,
    "address" TEXT,
    "status" "ConsentStatus" NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "note" TEXT,
    "recordedByUserId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL,
    "from" TEXT NOT NULL,
    "personId" TEXT,
    "body" TEXT,
    "providerMsgId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "message_outbox_providerMsgId_key" ON "message_outbox"("providerMsgId");

-- CreateIndex
CREATE UNIQUE INDEX "message_outbox_idempotencyKey_key" ON "message_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "message_outbox_tenantId_status_scheduledAt_idx" ON "message_outbox"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "message_outbox_tenantId_relatedType_relatedId_idx" ON "message_outbox"("tenantId", "relatedType", "relatedId");

-- CreateIndex
CREATE INDEX "message_outbox_tenantId_personId_idx" ON "message_outbox"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "message_outbox_tenantId_createdAt_idx" ON "message_outbox"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "contact_consents_tenantId_personId_channel_at_idx" ON "contact_consents"("tenantId", "personId", "channel", "at");

-- CreateIndex
CREATE INDEX "contact_consents_tenantId_channel_address_at_idx" ON "contact_consents"("tenantId", "channel", "address", "at");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_providerMsgId_key" ON "inbound_messages"("providerMsgId");

-- CreateIndex
CREATE INDEX "inbound_messages_tenantId_receivedAt_idx" ON "inbound_messages"("tenantId", "receivedAt");

-- AddForeignKey
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
