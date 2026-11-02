-- Tipos de los honorarios (D10): operación, base, quién paga, estado del
-- honorario y de la cuota, cómo se cobró la cuota y tratamiento del IVA. Van en
-- su propia migración, antes de las tablas que los usan.
-- Rollback (después de revertir la migración siguiente):
--   DROP TYPE "FeeKind", "FeeBasis", "FeePayerRole", "FeeStatus",
--     "FeeInstallmentStatus", "FeeSettlement", "FeeVatMode";

-- CreateEnum
CREATE TYPE "FeeKind" AS ENUM ('AltaAlquiler', 'Renovacion', 'Venta', 'Tasacion', 'GestionReparacion');

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('TotalContrato', 'ValorOperacion', 'MontoFijo');

-- CreateEnum
CREATE TYPE "FeePayerRole" AS ENUM ('Inquilino', 'Locador', 'Comprador', 'Vendedor', 'Otro');

-- CreateEnum
CREATE TYPE "FeeStatus" AS ENUM ('Pendiente', 'Parcial', 'Pagado', 'SinCargo', 'Anulado');

-- CreateEnum
CREATE TYPE "FeeInstallmentStatus" AS ENUM ('Pendiente', 'Pagada', 'Anulada');

-- CreateEnum
CREATE TYPE "FeeSettlement" AS ENUM ('Caja', 'CuentaLocador');

-- CreateEnum
CREATE TYPE "FeeVatMode" AS ENUM ('NoAplica', 'Incluido', 'Adicional');
