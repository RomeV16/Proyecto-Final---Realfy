-- DropForeignKey
ALTER TABLE "comprobantes" DROP CONSTRAINT "comprobantes_paymentId_fkey";

-- AlterTable
ALTER TABLE "comprobantes" ALTER COLUMN "paymentId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
