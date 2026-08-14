-- CreateEnum
CREATE TYPE "PipelineType" AS ENUM ('Alquiler', 'Venta');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('WebInquiry', 'PhoneCall', 'Email', 'WalkIn', 'Referral', 'Portal', 'SocialMedia', 'Other');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('Nuevo', 'Contactado', 'Calificado', 'Convertido', 'Perdido');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('Llamada', 'Email', 'WhatsApp', 'Visita', 'Nota');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('Programada', 'Completada', 'Cancelada', 'NoShow');

-- CreateEnum
CREATE TYPE "VisitOutcome" AS ENUM ('Interesado', 'NoInteresado', 'Pendiente', 'Oferta');

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "PipelineType" NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "staleDays" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "currentStageId" TEXT NOT NULL,
    "propertyId" TEXT,
    "assignedToUserId" TEXT,
    "source" "LeadSource" NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'Nuevo',
    "notes" TEXT,
    "budget" DECIMAL(15,2),
    "budgetCurrency" "Currency" NOT NULL DEFAULT 'ARS',
    "lostReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lastContactAt" TIMESTAMP(3),
    "staleDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_interactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "notes" TEXT,
    "contactedBy" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "propertyId" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "VisitStatus" NOT NULL DEFAULT 'Programada',
    "outcome" "VisitOutcome",
    "notes" TEXT,
    "conductedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipelines_tenantId_idx" ON "pipelines"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_tenantId_type_key" ON "pipelines"("tenantId", "type");

-- CreateIndex
CREATE INDEX "pipeline_stages_pipelineId_idx" ON "pipeline_stages"("pipelineId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipelineId_sortOrder_key" ON "pipeline_stages"("pipelineId", "sortOrder");

-- CreateIndex
CREATE INDEX "leads_tenantId_idx" ON "leads"("tenantId");

-- CreateIndex
CREATE INDEX "leads_tenantId_status_idx" ON "leads"("tenantId", "status");

-- CreateIndex
CREATE INDEX "leads_tenantId_pipelineId_idx" ON "leads"("tenantId", "pipelineId");

-- CreateIndex
CREATE INDEX "leads_tenantId_assignedToUserId_idx" ON "leads"("tenantId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "leads_tenantId_source_idx" ON "leads"("tenantId", "source");

-- CreateIndex
CREATE INDEX "leads_tenantId_currentStageId_idx" ON "leads"("tenantId", "currentStageId");

-- CreateIndex
CREATE INDEX "lead_interactions_tenantId_idx" ON "lead_interactions"("tenantId");

-- CreateIndex
CREATE INDEX "lead_interactions_tenantId_leadId_idx" ON "lead_interactions"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "lead_visits_tenantId_idx" ON "lead_visits"("tenantId");

-- CreateIndex
CREATE INDEX "lead_visits_tenantId_leadId_idx" ON "lead_visits"("tenantId", "leadId");

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "pipeline_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_interactions" ADD CONSTRAINT "lead_interactions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_interactions" ADD CONSTRAINT "lead_interactions_contactedBy_fkey" FOREIGN KEY ("contactedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_visits" ADD CONSTRAINT "lead_visits_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_visits" ADD CONSTRAINT "lead_visits_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_visits" ADD CONSTRAINT "lead_visits_conductedBy_fkey" FOREIGN KEY ("conductedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

