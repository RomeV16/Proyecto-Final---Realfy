-- Importación desde el sistema anterior: lotes y registro por fila.
-- Sólo agrega tablas y tipos nuevos; no toca datos existentes.
-- Rollback: DROP TABLE "import_row_logs", "import_batches"; DROP TYPE
-- "ImportRowAction", "ImportEntity", "ImportBatchStatus".

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('Validando', 'Validado', 'Ejecutando', 'Completado', 'Fallido');

-- CreateEnum
CREATE TYPE "ImportEntity" AS ENUM ('Persona', 'Propiedad', 'Contrato');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('Creado', 'Actualizado', 'SinCambios', 'Error');

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SistemaAnterior',
    "status" "ImportBatchStatus" NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "atomic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "counts" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_row_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entity" "ImportEntity" NOT NULL,
    "externalRef" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "action" "ImportRowAction" NOT NULL,
    "entityId" TEXT,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_row_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_tenantId_startedAt_idx" ON "import_batches"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "import_row_logs_tenantId_idx" ON "import_row_logs"("tenantId");

-- CreateIndex
CREATE INDEX "import_row_logs_batchId_action_idx" ON "import_row_logs"("batchId", "action");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_logs" ADD CONSTRAINT "import_row_logs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_row_logs" ADD CONSTRAINT "import_row_logs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
