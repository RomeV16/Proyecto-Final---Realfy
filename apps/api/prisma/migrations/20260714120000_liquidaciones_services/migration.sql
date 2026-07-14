-- CreateEnum
CREATE TYPE "LiquidacionStatus" AS ENUM ('Borrador', 'Revision', 'Aprobada', 'Pendiente', 'Enviada', 'Pagada', 'Vencida', 'Anulada');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('Transferencia', 'Efectivo', 'MercadoPago', 'Cheque');

-- CreateEnum
CREATE TYPE "LineItemType" AS ENUM ('Alquiler', 'Ajuste', 'Extra', 'Descuento', 'Multa');

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('Electricidad', 'Gas', 'Agua', 'Internet', 'Expensas', 'Municipal', 'Otro');

-- CreateTable
CREATE TABLE "liquidaciones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "status" "LiquidacionStatus" NOT NULL DEFAULT 'Borrador',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotal" DECIMAL(15,2) NOT NULL,
    "total" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "notes" TEXT,
    "pdfUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_line_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "type" "LineItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "providerName" TEXT,
    "accountNumber" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'ARS',
    "dueDay" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "liquidaciones_tenantId_idx" ON "liquidaciones"("tenantId");

-- CreateIndex
CREATE INDEX "liquidaciones_tenantId_status_idx" ON "liquidaciones"("tenantId", "status");

-- CreateIndex
CREATE INDEX "liquidaciones_tenantId_contractId_period_idx" ON "liquidaciones"("tenantId", "contractId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_contractId_period_key" ON "liquidaciones"("contractId", "period");

-- CreateIndex
CREATE INDEX "liquidacion_line_items_tenantId_idx" ON "liquidacion_line_items"("tenantId");

-- CreateIndex
CREATE INDEX "liquidacion_line_items_liquidacionId_idx" ON "liquidacion_line_items"("liquidacionId");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE INDEX "payments_liquidacionId_idx" ON "payments"("liquidacionId");

-- CreateIndex
CREATE INDEX "services_tenantId_idx" ON "services"("tenantId");

-- CreateIndex
CREATE INDEX "services_tenantId_propertyId_idx" ON "services"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "services_tenantId_isActive_idx" ON "services"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "service_payments_tenantId_idx" ON "service_payments"("tenantId");

-- CreateIndex
CREATE INDEX "service_payments_serviceId_idx" ON "service_payments"("serviceId");

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_line_items" ADD CONSTRAINT "liquidacion_line_items_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_payments" ADD CONSTRAINT "service_payments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

