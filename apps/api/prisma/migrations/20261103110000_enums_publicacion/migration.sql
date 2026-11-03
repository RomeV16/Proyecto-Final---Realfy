-- Estado de un aviso en un portal. Va en su propia migración, antes de la que lo usa.
-- Rollback: DROP TYPE "ListingStatus" (después de revertir la migración siguiente).

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('NoPublicado', 'Publicado', 'Pausado', 'Vencido');
