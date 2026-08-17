-- CreateEnum
CREATE TYPE "ComprobanteType" AS ENUM ('FacturaA', 'FacturaB', 'FacturaC', 'NotaCreditoA', 'NotaCreditoB', 'NotaCreditoC', 'NotaDebitoA', 'NotaDebitoB', 'NotaDebitoC');

-- CreateEnum
CREATE TYPE "ComprobanteStatus" AS ENUM ('Emitido', 'Anulado');

-- CreateEnum
CREATE TYPE "ArcaDelegationStatus" AS ENUM ('Pending', 'Active', 'Revoked');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FiscalCertExpiry';
ALTER TYPE "NotificationType" ADD VALUE 'FiscalDelegationRevoked';
ALTER TYPE "NotificationType" ADD VALUE 'LibroIvaGenerated';

-- CreateTable
CREATE TABLE "arca_certificates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "isProduction" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "certEncrypted" BYTEA NOT NULL,
    "keyEncrypted" BYTEA NOT NULL,
    "dekWrapped" BYTEA NOT NULL,
    "kekVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arca_certificate_access_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arca_certificate_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arca_issuers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "fiscalCondition" "FiscalCondition" NOT NULL,
    "ingresosBrutos" TEXT,
    "activityStartDate" TEXT,
    "businessAddress" TEXT,
    "delegationStatus" "ArcaDelegationStatus" NOT NULL DEFAULT 'Pending',
    "delegationVerifiedAt" TIMESTAMP(3),
    "delegationLastError" TEXT,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_issuers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arca_puntos_de_venta" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "nombre" TEXT,
    "tipo" TEXT,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arca_puntos_de_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arca_request_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "issuerId" TEXT,
    "operation" TEXT NOT NULL,
    "issuerCuit" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "latencyMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "comprobanteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arca_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "issuerId" TEXT,
    "clientRequestId" TEXT,
    "type" "ComprobanteType" NOT NULL,
    "status" "ComprobanteStatus" NOT NULL DEFAULT 'Emitido',
    "cbteTipo" INTEGER NOT NULL,
    "puntoDeVenta" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "concepto" INTEGER NOT NULL DEFAULT 2,
    "docTipo" INTEGER NOT NULL,
    "docNro" TEXT NOT NULL,
    "receptorName" TEXT NOT NULL,
    "receptorFiscalCondition" "FiscalCondition" NOT NULL,
    "condicionIVAReceptorId" INTEGER,
    "impTotal" DECIMAL(15,2) NOT NULL,
    "impNeto" DECIMAL(15,2) NOT NULL,
    "impIva" DECIMAL(15,2) NOT NULL,
    "impExento" DECIMAL(15,2) NOT NULL,
    "impTotConc" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "impOpEx" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "impTrib" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "monId" TEXT NOT NULL DEFAULT 'PES',
    "monCotiz" DECIMAL(12,6) NOT NULL DEFAULT 1,
    "currency" "Currency" NOT NULL,
    "cae" TEXT NOT NULL,
    "caeFchVto" TIMESTAMP(3) NOT NULL,
    "emittedAt" TIMESTAMP(3) NOT NULL,
    "fchServDesde" TIMESTAMP(3),
    "fchServHasta" TIMESTAMP(3),
    "fchVtoPago" TIMESTAMP(3),
    "periodoAsocDesde" TIMESTAMP(3),
    "periodoAsocHasta" TIMESTAMP(3),
    "pdfUrl" TEXT,
    "originalComprobanteId" TEXT,
    "ivaArray" JSONB,
    "tributos" JSONB,
    "opcionales" JSONB,
    "cbtesAsoc" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "libro_iva_exports" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "libro_iva_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "arca_certificates_tenantId_key" ON "arca_certificates"("tenantId");

-- CreateIndex
CREATE INDEX "arca_certificate_access_logs_tenantId_certificateId_idx" ON "arca_certificate_access_logs"("tenantId", "certificateId");

-- CreateIndex
CREATE INDEX "arca_certificate_access_logs_tenantId_createdAt_idx" ON "arca_certificate_access_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "arca_issuers_tenantId_idx" ON "arca_issuers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "arca_issuers_tenantId_cuit_key" ON "arca_issuers"("tenantId", "cuit");

-- CreateIndex
CREATE INDEX "arca_puntos_de_venta_tenantId_issuerId_idx" ON "arca_puntos_de_venta"("tenantId", "issuerId");

-- CreateIndex
CREATE UNIQUE INDEX "arca_puntos_de_venta_issuerId_number_key" ON "arca_puntos_de_venta"("issuerId", "number");

-- CreateIndex
CREATE INDEX "arca_request_logs_tenantId_createdAt_idx" ON "arca_request_logs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "arca_request_logs_tenantId_issuerId_createdAt_idx" ON "arca_request_logs"("tenantId", "issuerId", "createdAt");

-- CreateIndex
CREATE INDEX "comprobantes_tenantId_idx" ON "comprobantes"("tenantId");

-- CreateIndex
CREATE INDEX "comprobantes_tenantId_paymentId_idx" ON "comprobantes"("tenantId", "paymentId");

-- CreateIndex
CREATE INDEX "comprobantes_tenantId_issuerId_idx" ON "comprobantes"("tenantId", "issuerId");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_tenantId_puntoDeVenta_cbteTipo_numero_key" ON "comprobantes"("tenantId", "puntoDeVenta", "cbteTipo", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_tenantId_clientRequestId_key" ON "comprobantes"("tenantId", "clientRequestId");

-- CreateIndex
CREATE INDEX "libro_iva_exports_tenantId_idx" ON "libro_iva_exports"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "libro_iva_exports_tenantId_period_key" ON "libro_iva_exports"("tenantId", "period");

-- AddForeignKey
ALTER TABLE "arca_certificates" ADD CONSTRAINT "arca_certificates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arca_certificate_access_logs" ADD CONSTRAINT "arca_certificate_access_logs_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "arca_certificates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arca_issuers" ADD CONSTRAINT "arca_issuers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arca_puntos_de_venta" ADD CONSTRAINT "arca_puntos_de_venta_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "arca_issuers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "arca_issuers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_originalComprobanteId_fkey" FOREIGN KEY ("originalComprobanteId") REFERENCES "comprobantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "libro_iva_exports" ADD CONSTRAINT "libro_iva_exports_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

