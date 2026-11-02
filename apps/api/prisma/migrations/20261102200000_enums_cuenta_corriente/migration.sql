-- Tipos de la cuenta corriente del locador (ADR-0009): concepto de un asiento,
-- estado del estado de cuenta mensual y, para la opción por contrato, qué le
-- debe el locador que cobró directamente. Van en su propia migración, antes de
-- las tablas y columnas que los usan.
-- Rollback (después de revertir las dos migraciones siguientes):
--   DROP TYPE "OwnerStatementStatus", "OwnerLedgerEntryType", "LessorDirectOwes";

-- CreateEnum
CREATE TYPE "LessorDirectOwes" AS ENUM ('TodoLoAjeno', 'SoloInmobiliaria');

-- CreateEnum
CREATE TYPE "OwnerLedgerEntryType" AS ENUM ('SaldoInicial', 'Alquiler', 'Punitorio', 'ReintegroImpuesto', 'Comision', 'Honorario', 'Cargo', 'PagoEnte', 'Transferencia', 'EntregaEfectivo', 'CobroDirecto', 'Compensacion', 'Custodia', 'Ajuste');

-- CreateEnum
CREATE TYPE "OwnerStatementStatus" AS ENUM ('Borrador', 'Emitido', 'Enviado', 'Anulado');
