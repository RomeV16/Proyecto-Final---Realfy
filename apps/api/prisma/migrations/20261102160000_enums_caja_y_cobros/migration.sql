-- Tipos de caja y cobros: clase de cuenta, sentido y categoría de un movimiento,
-- quién recibió un cobro, y el euro como moneda. Van en su propia migración,
-- antes de las tablas que los usan (un valor nuevo de un enum no se puede usar en
-- la misma transacción que lo agrega).
-- Rollback: DROP TYPE "PaymentReceiver", "CashCategory", "CashDirection",
-- "FinancialAccountKind" (después de revertir la migración siguiente). Postgres no
-- quita un valor de un enum: para sacar 'EUR' de "Currency" hay que recrear el tipo
-- sin él, y solo si ninguna fila lo usa.

-- CreateEnum
CREATE TYPE "FinancialAccountKind" AS ENUM ('Caja', 'Banco', 'Custodia');

-- CreateEnum
CREATE TYPE "CashDirection" AS ENUM ('In', 'Out');

-- CreateEnum
CREATE TYPE "CashCategory" AS ENUM ('AlquilerCobrado', 'PagoLocador', 'PagoEnte', 'PagoProveedor', 'Honorario', 'Gasto', 'ComisionEmpleado', 'Sena', 'Custodia', 'Compensacion', 'Conversion');

-- CreateEnum
CREATE TYPE "PaymentReceiver" AS ENUM ('Inmobiliaria', 'Locador');

-- AlterEnum
ALTER TYPE "Currency" ADD VALUE 'EUR';
