-- Renglones con destino: cada renglón de la liquidación dice a quién le
-- corresponde (beneficiary), si cuenta para la comisión (commissionable) y de
-- qué registro viene (sourceType/sourceId). La liquidación suma el tipo, si es
-- provisional y el número de recibo, que se numera por inmobiliaria con
-- "document_sequences".
-- Backfill: Alquiler, Ajuste, Multa y Descuento son comisionables; Extra no.
-- Todos los renglones existentes van al locador y las liquidaciones existentes
-- son mensuales, así que lo que se cobra y se rinde no cambia.
-- Rollback: DROP TABLE "document_sequences"; DROP INDEX
-- "liquidaciones_tenantId_receiptSeq_key",
-- "liquidacion_line_items_tenantId_sourceType_sourceId_idx"; ALTER TABLE
-- "liquidacion_line_items" DROP COLUMN "commissionable", DROP COLUMN
-- "beneficiary", DROP COLUMN "sourceType", DROP COLUMN "sourceId"; ALTER TABLE
-- "liquidaciones" DROP COLUMN "kind", DROP COLUMN "isProvisional", DROP COLUMN
-- "receiptSeq". La versión anterior ignora las columnas nuevas.

-- AlterTable
ALTER TABLE "liquidacion_line_items" ADD COLUMN     "beneficiary" "LineBeneficiary" NOT NULL DEFAULT 'Locador',
ADD COLUMN     "commissionable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- Backfill (el valor por defecto de beneficiary ya deja a todos en Locador)
UPDATE "liquidacion_line_items" SET "commissionable" = true
WHERE "type" IN ('Alquiler', 'Ajuste', 'Multa', 'Descuento');

-- Las columnas no llevan valor por defecto: quien escribe un renglón lo decide.
ALTER TABLE "liquidacion_line_items" ALTER COLUMN "beneficiary" DROP DEFAULT,
ALTER COLUMN "commissionable" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN     "isProvisional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "LiquidacionKind" NOT NULL DEFAULT 'Mensual',
ADD COLUMN     "receiptSeq" INTEGER;

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_tenantId_series_key" ON "document_sequences"("tenantId", "series");

-- CreateIndex
CREATE INDEX "liquidacion_line_items_tenantId_sourceType_sourceId_idx" ON "liquidacion_line_items"("tenantId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_tenantId_receiptSeq_key" ON "liquidaciones"("tenantId", "receiptSeq");
