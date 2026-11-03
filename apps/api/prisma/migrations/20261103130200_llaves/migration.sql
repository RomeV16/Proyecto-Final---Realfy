-- Llaves: juegos de llaves por propiedad (quién los tiene y dónde se guardan) y sus salidas y
-- devoluciones. Las tablas nacen vacías.
-- Rollback: DROP TABLE "key_movements", "key_sets". Se pierden las llaves cargadas después de esta migración.

-- CreateTable
CREATE TABLE "key_sets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "holder" "KeyHolder" NOT NULL DEFAULT 'Oficina',
    "holderPersonId" TEXT,
    "holderUserId" TEXT,
    "holderName" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keySetId" TEXT NOT NULL,
    "holder" "KeyHolder" NOT NULL,
    "holderPersonId" TEXT,
    "holderUserId" TEXT,
    "holderName" TEXT,
    "reason" TEXT,
    "outAt" DATE NOT NULL,
    "expectedReturnAt" DATE,
    "returnedAt" DATE,
    "outById" TEXT,
    "returnedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "key_sets_tenantId_holder_idx" ON "key_sets"("tenantId", "holder");

-- CreateIndex
CREATE INDEX "key_sets_tenantId_propertyId_idx" ON "key_sets"("tenantId", "propertyId");

-- CreateIndex
CREATE INDEX "key_sets_holderPersonId_idx" ON "key_sets"("holderPersonId");

-- CreateIndex
CREATE INDEX "key_sets_holderUserId_idx" ON "key_sets"("holderUserId");

-- CreateIndex
CREATE INDEX "key_movements_tenantId_returnedAt_idx" ON "key_movements"("tenantId", "returnedAt");

-- CreateIndex
CREATE INDEX "key_movements_keySetId_outAt_idx" ON "key_movements"("keySetId", "outAt");

-- CreateIndex
CREATE INDEX "key_movements_holderPersonId_idx" ON "key_movements"("holderPersonId");

-- CreateIndex
CREATE INDEX "key_movements_holderUserId_idx" ON "key_movements"("holderUserId");

-- AddForeignKey
ALTER TABLE "key_sets" ADD CONSTRAINT "key_sets_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_sets" ADD CONSTRAINT "key_sets_holderPersonId_fkey" FOREIGN KEY ("holderPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_sets" ADD CONSTRAINT "key_sets_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_movements" ADD CONSTRAINT "key_movements_keySetId_fkey" FOREIGN KEY ("keySetId") REFERENCES "key_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_movements" ADD CONSTRAINT "key_movements_holderPersonId_fkey" FOREIGN KEY ("holderPersonId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_movements" ADD CONSTRAINT "key_movements_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
