-- Bandeja de consultas unificada (PR 5.3): `conversations` (una consulta por
-- canal y contacto, con responsable y plazo de primera respuesta) y
-- `conversation_messages` (los mensajes de cada una, enlazados a
-- `inbound_messages` y `message_outbox`).
--
-- Backfill: los mensajes entrantes que ya están en `inbound_messages` (WhatsApp,
-- guardados desde la mensajería saliente) se agrupan por inmobiliaria, canal y
-- dirección en una consulta cada grupo, archivada y sin plazo: son historia, no
-- trabajo pendiente. Lo normal es que no haya ninguno.
--
-- Rollback:
--   DROP TABLE "conversation_messages"; DROP TABLE "conversations";
--   DROP INDEX "inbound_messages_tenantId_channel_from_idx";

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "ConversationChannel" NOT NULL,
    "address" TEXT NOT NULL,
    "counterpartName" TEXT,
    "subject" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'Nueva',
    "personId" TEXT,
    "leadId" TEXT,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "assigneeUserId" TEXT,
    "firstResponseAt" TIMESTAMP(3),
    "slaDueAt" TIMESTAMP(3),
    "slaBreachedAt" TIMESTAMP(3),
    "autoRepliedAt" TIMESTAMP(3),
    "unread" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "inboundMessageId" TEXT,
    "outboxMessageId" TEXT,
    "authorUserId" TEXT,
    "isAutoReply" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_tenantId_status_lastMessageAt_idx" ON "conversations"("tenantId", "status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_tenantId_assigneeUserId_status_idx" ON "conversations"("tenantId", "assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "conversations_tenantId_channel_address_lastMessageAt_idx" ON "conversations"("tenantId", "channel", "address", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_tenantId_slaDueAt_idx" ON "conversations"("tenantId", "slaDueAt");

-- CreateIndex
CREATE INDEX "conversations_tenantId_personId_idx" ON "conversations"("tenantId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_inboundMessageId_key" ON "conversation_messages"("inboundMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_outboxMessageId_key" ON "conversation_messages"("outboxMessageId");

-- CreateIndex
CREATE INDEX "conversation_messages_tenantId_conversationId_at_idx" ON "conversation_messages"("tenantId", "conversationId", "at");

-- CreateIndex
CREATE INDEX "inbound_messages_tenantId_channel_from_idx" ON "inbound_messages"("tenantId", "channel", "from");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_inboundMessageId_fkey" FOREIGN KEY ("inboundMessageId") REFERENCES "inbound_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_outboxMessageId_fkey" FOREIGN KEY ("outboxMessageId") REFERENCES "message_outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: una consulta archivada por inmobiliaria, canal y dirección.
CREATE TEMP TABLE "_bandeja_backfill" AS
SELECT
    gen_random_uuid()::text AS "id",
    "tenantId",
    "channel",
    "from" AS "address",
    (array_agg("personId" ORDER BY "receivedAt" DESC, "id" DESC) FILTER (WHERE "personId" IS NOT NULL))[1] AS "personId",
    max("receivedAt") AS "lastMessageAt"
FROM "inbound_messages"
GROUP BY "tenantId", "channel", "from";

INSERT INTO "conversations" ("id", "tenantId", "channel", "address", "status", "personId", "lastMessageAt", "updatedAt")
SELECT "id", "tenantId", "channel"::text::"ConversationChannel", "address", 'Archivada', "personId", "lastMessageAt", CURRENT_TIMESTAMP
FROM "_bandeja_backfill";

INSERT INTO "conversation_messages" ("id", "tenantId", "conversationId", "direction", "body", "inboundMessageId", "at")
SELECT gen_random_uuid()::text, m."tenantId", b."id", 'In', coalesce(m."body", ''), m."id", m."receivedAt"
FROM "inbound_messages" m
JOIN "_bandeja_backfill" b
  ON b."tenantId" = m."tenantId" AND b."channel" = m."channel" AND b."address" = m."from";

DROP TABLE "_bandeja_backfill";
