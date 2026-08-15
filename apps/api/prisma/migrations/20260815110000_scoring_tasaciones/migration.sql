For more information, see: https://pris.ly/prisma-config

-- CreateEnum
CREATE TYPE "ValuationMethod" AS ENUM ('Comparativo', 'Costo', 'Ingreso', 'Mixto');

-- CreateTable
CREATE TABLE "tenant_score_configs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guaranteeWeight" INTEGER NOT NULL DEFAULT 20,
    "jobStabilityWeight" INTEGER NOT NULL DEFAULT 20,
    "referencesWeight" INTEGER NOT NULL DEFAULT 20,
    "paymentHistoryWeight" INTEGER NOT NULL DEFAULT 20,
    "manualRatingWeight" INTEGER NOT NULL DEFAULT 20,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_score_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_scores" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "guaranteeScore" INTEGER NOT NULL DEFAULT 0,
    "jobStabilityScore" INTEGER NOT NULL DEFAULT 0,
    "referencesScore" INTEGER NOT NULL DEFAULT 0,
    "paymentHistoryScore" INTEGER NOT NULL DEFAULT 0,
    "manualRating" INTEGER NOT NULL DEFAULT 0,
    "totalScore" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "scoredByUserId" TEXT NOT NULL,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_valuations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "valuationDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "method" "ValuationMethod" NOT NULL,
    "appraiser" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_score_configs_tenantId_key" ON "tenant_score_configs"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_score_configs_tenantId_idx" ON "tenant_score_configs"("tenantId");

-- CreateIndex
CREATE INDEX "tenant_scores_tenantId_idx" ON "tenant_scores"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_scores_tenantId_personId_key" ON "tenant_scores"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "property_valuations_tenantId_idx" ON "property_valuations"("tenantId");

-- CreateIndex
CREATE INDEX "property_valuations_tenantId_propertyId_idx" ON "property_valuations"("tenantId", "propertyId");

-- AddForeignKey
ALTER TABLE "tenant_score_configs" ADD CONSTRAINT "tenant_score_configs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scores" ADD CONSTRAINT "tenant_scores_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scores" ADD CONSTRAINT "tenant_scores_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scores" ADD CONSTRAINT "tenant_scores_scoredByUserId_fkey" FOREIGN KEY ("scoredByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_valuations" ADD CONSTRAINT "property_valuations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

