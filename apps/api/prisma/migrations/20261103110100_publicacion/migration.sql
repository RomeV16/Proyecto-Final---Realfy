-- Publicación (roadmap 44): un aviso por propiedad + operación + portal
-- (`property_listings`), con estado, dirección y código externos, fechas de
-- publicación y vencimiento, y quién lo actualizó. El portal "micrositio" es el sitio
-- propio: sólo se muestran las operaciones cuyo aviso ahí está Publicado.
--
-- Sin backfill: la tabla nace vacía, así que nada queda publicado en el micrositio
-- hasta que alguien lo marque.
--
-- Rollback:
--   DROP TABLE "property_listings";

-- CreateTable
CREATE TABLE "property_listings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "operationType" "PropertyOperationType" NOT NULL,
    "portal" TEXT NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'NoPublicado',
    "externalUrl" TEXT,
    "externalCode" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_listings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_listings_tenantId_status_idx" ON "property_listings"("tenantId", "status");

-- CreateIndex
CREATE INDEX "property_listings_tenantId_portal_status_idx" ON "property_listings"("tenantId", "portal", "status");

-- CreateIndex
CREATE INDEX "property_listings_tenantId_expiresAt_idx" ON "property_listings"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "property_listings_propertyId_operationType_portal_key" ON "property_listings"("propertyId", "operationType", "portal");

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
