-- Datos de persona, cuentas bancarias por moneda y referencias externas.
--
-- Las columnas bankName, cbu y bankAlias de "persons" quedan deprecadas una
-- versión: ya no se leen ni se escriben (la fuente única pasa a ser
-- "person_bank_accounts"), pero siguen en la tabla para poder volver atrás.
-- El backfill va después de crear la tabla y antes de que nadie la use.
--
-- Reversa: DROP TABLE "person_bank_accounts"; luego DROP de las columnas,
-- índices y FK agregados acá y DROP TYPE "PersonType", "PayoutMethod".
-- Las columnas viejas conservan los datos originales, así que no se pierde nada.

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('Fisica', 'Juridica');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('Transferencia', 'Efectivo', 'Custodia');

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "persons" ADD COLUMN     "address" TEXT,
ADD COLUMN     "dni" TEXT,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "payoutMethod" "PayoutMethod",
ADD COLUMN     "personType" "PersonType" NOT NULL DEFAULT 'Fisica';

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "cadastralId" TEXT,
ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "parentPropertyId" TEXT;

-- CreateTable
CREATE TABLE "person_bank_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "bankName" TEXT,
    "cbu" TEXT,
    "alias" TEXT,
    "holder" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_bank_accounts_tenantId_idx" ON "person_bank_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "person_bank_accounts_personId_currency_idx" ON "person_bank_accounts"("personId", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenantId_externalRef_key" ON "contracts"("tenantId", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "persons_tenantId_externalRef_key" ON "persons"("tenantId", "externalRef");

-- CreateIndex
CREATE INDEX "properties_parentPropertyId_idx" ON "properties"("parentPropertyId");

-- CreateIndex
CREATE UNIQUE INDEX "properties_tenantId_externalRef_key" ON "properties"("tenantId", "externalRef");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_parentPropertyId_fkey" FOREIGN KEY ("parentPropertyId") REFERENCES "properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_bank_accounts" ADD CONSTRAINT "person_bank_accounts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: cada persona con algún dato bancario recibe una cuenta en pesos
-- marcada como predeterminada.
INSERT INTO "person_bank_accounts"
  ("id", "tenantId", "personId", "currency", "bankName", "cbu", "alias", "holder", "isDefault", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  p."tenantId",
  p."id",
  'ARS'::"Currency",
  NULLIF(btrim(p."bankName"), ''),
  NULLIF(btrim(p."cbu"), ''),
  NULLIF(btrim(p."bankAlias"), ''),
  btrim(p."firstName" || ' ' || p."lastName"),
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "persons" p
WHERE NULLIF(btrim(p."bankName"), '') IS NOT NULL
   OR NULLIF(btrim(p."cbu"), '') IS NOT NULL
   OR NULLIF(btrim(p."bankAlias"), '') IS NOT NULL;
