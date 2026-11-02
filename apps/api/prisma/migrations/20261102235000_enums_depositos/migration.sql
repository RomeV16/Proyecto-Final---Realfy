-- Tipos de depósitos: quién guarda el depósito, cómo se devuelve, su estado y el
-- estado de la liquidación de egreso, más la categoría de caja "Deposito". Van en su
-- propia migración, antes de la que los usa (un valor nuevo de un enum no se puede
-- usar en la misma transacción que lo agrega).
-- Rollback: DROP TYPE "MoveOutStatus", "DepositStatus", "DepositRefundRule",
-- "DepositHolder" (después de revertir la migración siguiente). Postgres no quita un
-- valor de un enum: para sacar 'Deposito' de "CashCategory" hay que recrear el tipo
-- sin él, y solo si ningún movimiento de caja lo usa.

-- CreateEnum
CREATE TYPE "DepositHolder" AS ENUM ('Locador', 'Inmobiliaria');

-- CreateEnum
CREATE TYPE "DepositRefundRule" AS ENUM ('PesosActualizado', 'MismaMoneda');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('Pendiente', 'Parcial', 'Cobrado', 'Devuelto');

-- CreateEnum
CREATE TYPE "MoveOutStatus" AS ENUM ('Borrador', 'Confirmada');

-- AlterEnum
ALTER TYPE "CashCategory" ADD VALUE 'Deposito';
