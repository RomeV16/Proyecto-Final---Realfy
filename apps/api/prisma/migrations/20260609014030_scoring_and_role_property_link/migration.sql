-- AlterTable
ALTER TABLE "person_role_assignments" ADD COLUMN     "guarantorForPersonId" TEXT,
ADD COLUMN     "propertyId" TEXT;

-- CreateTable
CREATE TABLE "tenant_scores" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "guaranteeScore" INTEGER NOT NULL DEFAULT 0,
    "jobStabilityScore" INTEGER NOT NULL DEFAULT 0,
    "referencesScore" INTEGER NOT NULL DEFAULT 0,
    "paymentHistoryScore" INTEGER NOT NULL DEFAULT 0,
    "manualRating" INTEGER NOT NULL DEFAULT 0,
    "totalScore" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "scoredByUserId" TEXT,
    "scoredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_scores_personId_key" ON "tenant_scores"("personId");

-- CreateIndex
CREATE INDEX "tenant_scores_tenantId_idx" ON "tenant_scores"("tenantId");

-- AddForeignKey
ALTER TABLE "person_role_assignments" ADD CONSTRAINT "person_role_assignments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scores" ADD CONSTRAINT "tenant_scores_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_scores" ADD CONSTRAINT "tenant_scores_scoredByUserId_fkey" FOREIGN KEY ("scoredByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
