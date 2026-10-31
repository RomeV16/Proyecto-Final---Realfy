-- Locadores por contrato, apoderados y titularidad de propiedades.
-- El locador (quien alquila y cobra) deja de ser lo mismo que el propietario:
-- el porcentaje de cobro es del contrato y no de la titularidad.
-- Rollback (sin perder el resto): DROP TABLE "contract_lessors", "powers_of_attorney",
-- "property_ownerships"; DROP TYPE "LessorCapacity", "SignatureMode"; recrear
-- el índice único "owner_rendiciones_contractId_period_key" (solo si no hay
-- rendiciones por locador, es decir, una por contrato y período). Los
-- ContractPerson de rol Propietario y person_role_assignments.propertyId no se
-- tocan, así que la versión anterior sigue funcionando con los datos de antes.

-- CreateEnum
CREATE TYPE "LessorCapacity" AS ENUM ('Propietario', 'Usufructuario', 'Sublocador', 'Acreedor', 'Otro');

-- CreateEnum
CREATE TYPE "SignatureMode" AS ENUM ('Indistinta', 'Conjunta');

-- DropIndex
DROP INDEX "owner_rendiciones_contractId_period_key";

-- CreateTable
CREATE TABLE "contract_lessors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "capacity" "LessorCapacity" NOT NULL DEFAULT 'Propietario',
    "payoutPct" DECIMAL(7,4) NOT NULL,
    "payeePersonId" TEXT,
    "bankAccountId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_lessors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "powers_of_attorney" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "scopes" TEXT[],
    "signatureMode" "SignatureMode" NOT NULL DEFAULT 'Indistinta',
    "groupKey" TEXT,
    "contractId" TEXT,
    "propertyId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "documentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "powers_of_attorney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_ownerships" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "sharePct" DECIMAL(7,4),
    "title" TEXT,
    "since" TIMESTAMP(3),
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_lessors_contractId_validTo_idx" ON "contract_lessors"("contractId", "validTo");

-- CreateIndex
CREATE INDEX "contract_lessors_tenantId_personId_idx" ON "contract_lessors"("tenantId", "personId");

-- CreateIndex
CREATE INDEX "powers_of_attorney_tenantId_principalId_idx" ON "powers_of_attorney"("tenantId", "principalId");

-- CreateIndex
CREATE INDEX "powers_of_attorney_tenantId_agentId_idx" ON "powers_of_attorney"("tenantId", "agentId");

-- CreateIndex
CREATE INDEX "powers_of_attorney_contractId_idx" ON "powers_of_attorney"("contractId");

-- CreateIndex
CREATE INDEX "property_ownerships_tenantId_propertyId_idx" ON "property_ownerships"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "property_ownerships_tenantId_personId_idx" ON "property_ownerships"("tenantId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_rendiciones_contractId_period_ownerId_key" ON "owner_rendiciones"("contractId", "period", "ownerId");

-- AddForeignKey
ALTER TABLE "contract_lessors" ADD CONSTRAINT "contract_lessors_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_lessors" ADD CONSTRAINT "contract_lessors_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_lessors" ADD CONSTRAINT "contract_lessors_payeePersonId_fkey" FOREIGN KEY ("payeePersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_lessors" ADD CONSTRAINT "contract_lessors_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "person_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "powers_of_attorney" ADD CONSTRAINT "powers_of_attorney_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_ownerships" ADD CONSTRAINT "property_ownerships_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_ownerships" ADD CONSTRAINT "property_ownerships_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada propietario de un contrato pasa a ser locador. El 100 % se
-- reparte en partes iguales con 4 decimales; la última fila (por id) lleva el
-- resto para que la suma sea exactamente 100.0000. Si hay más de un propietario
-- el reparto es una suposición: queda marcado para revisar.
INSERT INTO "contract_lessors"
  ("id", "tenantId", "contractId", "personId", "capacity", "payoutPct",
   "validFrom", "needsReview", "updatedAt")
SELECT
  gen_random_uuid()::text,
  cp."tenantId",
  cp."contractId",
  cp."personId",
  'Propietario',
  CASE
    WHEN cp.rn < cp.n THEN round(100.0 / cp.n, 4)
    ELSE 100.0000 - round(100.0 / cp.n, 4) * (cp.n - 1)
  END,
  c."startDate",
  cp.n > 1,
  now()
FROM (
  SELECT x.*,
         row_number() OVER (PARTITION BY x."contractId" ORDER BY x."id") AS rn,
         count(*)     OVER (PARTITION BY x."contractId")                  AS n
  FROM "contract_persons" x
  WHERE x."role" = 'Propietario'
) cp
JOIN "contracts" c ON c."id" = cp."contractId";

-- Titularidad: la propiedad que se guardaba en la asignación de rol Propietario
-- pasa a PropertyOwnership, sin porcentaje. La columna propertyId se conserva.
INSERT INTO "property_ownerships"
  ("id", "tenantId", "propertyId", "personId", "updatedAt")
SELECT gen_random_uuid()::text, r."tenantId", r."propertyId", r."personId", now()
FROM "person_role_assignments" r
WHERE r."role" = 'Propietario' AND r."propertyId" IS NOT NULL;
