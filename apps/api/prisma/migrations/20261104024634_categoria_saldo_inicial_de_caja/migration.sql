-- Categoría del asiento de apertura de una cuenta de caja, banco o custodia
-- (saldo inicial de la migración). Va en su propia migración: un valor nuevo de
-- un enum no se puede usar en la misma transacción que lo crea.
--
-- Rollback: los valores de un enum no se quitan sin recrear el tipo; si no hay
-- movimientos con esta categoría se deja, porque no molesta.

-- AlterEnum
ALTER TYPE "CashCategory" ADD VALUE 'SaldoInicial';
