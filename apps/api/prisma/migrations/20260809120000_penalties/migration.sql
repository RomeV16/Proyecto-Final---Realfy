-- CreateEnum
CREATE TYPE "PenaltyStatus" AS ENUM ('active', 'waived');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('ServiceDueReminder', 'ContractExpiring', 'LiquidacionOverdue', 'PaymentReceived', 'SystemAlert', 'StaleLeadAlert', 'TicketCreated', 'TicketStatusChanged', 'TicketCommentAdded');

-- CreateTable
CREATE TABLE "penalties" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "appliedOn" TIMESTAMP(3) NOT NULL,
    "daysOverdue" INTEGER NOT NULL,
    "compoundBase" DECIMAL(14,2),
    "status" "PenaltyStatus" NOT NULL DEFAULT 'active',
    "waivedAt" TIMESTAMP(3),
    "waivedBy" TEXT,
    "waiveReason" TEXT,
    "settledLiquidacionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "penalties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "entityType" TEXT,
    "entityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "penalties_tenantId_idx" ON "penalties"("tenantId");

-- CreateIndex
CREATE INDEX "penalties_tenantId_status_idx" ON "penalties"("tenantId", "status");

-- CreateIndex
CREATE INDEX "penalties_liquidacionId_idx" ON "penalties"("liquidacionId");

-- CreateIndex
CREATE INDEX "penalties_settledLiquidacionId_idx" ON "penalties"("settledLiquidacionId");

-- CreateIndex
CREATE INDEX "email_templates_tenantId_idx" ON "email_templates"("tenantId");

-- CreateIndex
CREATE INDEX "email_templates_tenantId_isActive_idx" ON "email_templates"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_tenantId_name_key" ON "email_templates"("tenantId", "name");

-- CreateIndex
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_isRead_idx" ON "notifications"("tenantId", "userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_createdAt_idx" ON "notifications"("tenantId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_settledLiquidacionId_fkey" FOREIGN KEY ("settledLiquidacionId") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

