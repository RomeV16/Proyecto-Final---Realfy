-- Obtención automática de boletas (ADR-0018): `bill_documents` (el documento
-- entrante, único por inmobiliaria y contenido), `bill_fetch_runs` (cada intento de
-- consulta a un proveedor), `services.providerKey` (clave del catálogo de
-- proveedores) y `service_bills.source` / `documentId` (de dónde salió la boleta).
--
-- Sin backfill: las boletas que ya existen quedan `Manual`, sin documento, y los
-- servicios sin proveedor. Las tablas nacen vacías.
--
-- Rollback:
--   ALTER TABLE "service_bills" DROP CONSTRAINT "service_bills_documentId_fkey";
--   DROP INDEX "service_bills_documentId_idx";
--   ALTER TABLE "service_bills" DROP COLUMN "documentId", DROP COLUMN "source";
--   DROP INDEX "services_tenantId_providerKey_accountNumber_idx";
--   ALTER TABLE "services" DROP COLUMN "providerKey";
--   DROP TABLE "bill_fetch_runs"; DROP TABLE "bill_documents";
--   DROP TYPE "BillFetchResult"; DROP TYPE "BillDocumentStatus";
--   DROP TYPE "BillChannel"; DROP TYPE "ServiceBillSource";

-- CreateEnum
CREATE TYPE "ServiceBillSource" AS ENUM ('Manual', 'Automatica');

-- CreateEnum
CREATE TYPE "BillChannel" AS ENUM ('Consulta', 'Mail', 'Portal', 'Archivo');

-- CreateEnum
CREATE TYPE "BillDocumentStatus" AS ENUM ('Recibida', 'Procesada', 'RequiereRevision', 'Rechazada', 'Duplicada');

-- CreateEnum
CREATE TYPE "BillFetchResult" AS ENUM ('Ok', 'SinNovedad', 'Error', 'Bloqueado');

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "providerKey" TEXT;

-- AlterTable
ALTER TABLE "service_bills" ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "source" "ServiceBillSource" NOT NULL DEFAULT 'Manual';

-- CreateTable
CREATE TABLE "bill_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channel" "BillChannel" NOT NULL,
    "origin" TEXT,
    "fileName" TEXT,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT NOT NULL,
    "providerKey" TEXT,
    "accountNumber" TEXT,
    "data" JSONB,
    "confidence" DECIMAL(4,3),
    "status" "BillDocumentStatus" NOT NULL DEFAULT 'Recibida',
    "reason" TEXT,
    "serviceId" TEXT,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_fetch_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT,
    "providerKey" TEXT NOT NULL,
    "channel" "BillChannel" NOT NULL DEFAULT 'Consulta',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "result" "BillFetchResult" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "documents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_fetch_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_documents_tenantId_status_createdAt_idx" ON "bill_documents"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bill_documents_tenantId_serviceId_idx" ON "bill_documents"("tenantId", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_documents_tenantId_sha256_key" ON "bill_documents"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "bill_fetch_runs_tenantId_startedAt_idx" ON "bill_fetch_runs"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "bill_fetch_runs_tenantId_providerKey_startedAt_idx" ON "bill_fetch_runs"("tenantId", "providerKey", "startedAt");

-- CreateIndex
CREATE INDEX "services_tenantId_providerKey_accountNumber_idx" ON "services"("tenantId", "providerKey", "accountNumber");

-- CreateIndex
CREATE INDEX "service_bills_documentId_idx" ON "service_bills"("documentId");

-- AddForeignKey
ALTER TABLE "service_bills" ADD CONSTRAINT "service_bills_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "bill_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_documents" ADD CONSTRAINT "bill_documents_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_fetch_runs" ADD CONSTRAINT "bill_fetch_runs_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

