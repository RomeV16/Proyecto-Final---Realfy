-- Tipos de vencimientos: tipo, estado y resultado de un seguimiento del fin de
-- contrato, y dos tipos de convenio nuevos (prórroga de palabra y renovación).
-- Van en su propia migración, antes de la que los usa (un valor nuevo de un enum
-- no se puede usar en la misma transacción que lo agrega).
-- Rollback: DROP TYPE "FollowUpOutcome", "FollowUpStatus", "FollowUpKind" (después
-- de revertir la migración siguiente). Postgres no quita un valor de un enum: para
-- sacar 'Prorroga' y 'Renovacion' de "ContractAgreementKind" hay que recrear el
-- tipo sin ellos, y solo si ningún convenio los usa.

-- CreateEnum
CREATE TYPE "FollowUpKind" AS ENUM ('Devolucion', 'Renovacion');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('Abierto', 'Cerrado');

-- CreateEnum
CREATE TYPE "FollowUpOutcome" AS ENUM ('Pendiente', 'Renovado', 'Devuelto', 'Prorrogado');

-- AlterEnum
ALTER TYPE "ContractAgreementKind" ADD VALUE 'Prorroga';
ALTER TYPE "ContractAgreementKind" ADD VALUE 'Renovacion';
