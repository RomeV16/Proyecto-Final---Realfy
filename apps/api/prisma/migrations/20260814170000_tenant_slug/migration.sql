-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
