-- Facturación por cuenta del locador (roadmap 38): emisor delegado por persona
-- (`arca_issuers.personId`, con la configuración de qué y cuándo se factura),
-- la factura que sale de un estado de cuenta (`comprobantes.ownerStatementId`)
-- y la cola de emisión por origen y locador (`lessor_invoice_jobs`).
-- `comprobantes.paymentId` ya es opcional con SetNull (D0).
--
-- Sin backfill: los emisores existentes quedan sin persona (son los propios de
-- la inmobiliaria), los comprobantes sin estado de cuenta, y la cola nace vacía.
--
-- Rollback:
--   DROP TABLE "lessor_invoice_jobs";
--   ALTER TABLE "comprobantes" DROP COLUMN "ownerStatementId";
--   ALTER TABLE "arca_issuers" DROP COLUMN "invoicingSettings", DROP COLUMN "personId";
--   DROP TYPE "LessorInvoiceStatus"; DROP TYPE "LessorInvoiceKind"; DROP TYPE "LessorInvoiceSource";

-- CreateEnum
CREATE TYPE "LessorInvoiceSource" AS ENUM ('Payment', 'OwnerStatement');

-- CreateEnum
CREATE TYPE "LessorInvoiceKind" AS ENUM ('Factura', 'NotaCredito');

-- CreateEnum
CREATE TYPE "LessorInvoiceStatus" AS ENUM ('Pendiente', 'Emitido', 'Fallido', 'Omitido');

-- AlterTable
ALTER TABLE "arca_issuers" ADD COLUMN     "invoicingSettings" JSONB,
ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "comprobantes" ADD COLUMN     "ownerStatementId" TEXT;

-- CreateTable
CREATE TABLE "lessor_invoice_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "sourceType" "LessorInvoiceSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "LessorInvoiceKind" NOT NULL,
    "status" "LessorInvoiceStatus" NOT NULL DEFAULT 'Pendiente',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "comprobanteId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lessor_invoice_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lessor_invoice_jobs_tenantId_status_idx" ON "lessor_invoice_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "lessor_invoice_jobs_tenantId_personId_idx" ON "lessor_invoice_jobs"("tenantId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "lessor_invoice_jobs_tenantId_sourceType_sourceId_personId_k_key" ON "lessor_invoice_jobs"("tenantId", "sourceType", "sourceId", "personId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "arca_issuers_tenantId_personId_key" ON "arca_issuers"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "comprobantes_ownerStatementId_idx" ON "comprobantes"("ownerStatementId");

-- AddForeignKey
ALTER TABLE "arca_issuers" ADD CONSTRAINT "arca_issuers_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_ownerStatementId_fkey" FOREIGN KEY ("ownerStatementId") REFERENCES "owner_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessor_invoice_jobs" ADD CONSTRAINT "lessor_invoice_jobs_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessor_invoice_jobs" ADD CONSTRAINT "lessor_invoice_jobs_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "comprobantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

