-- Tipos de las boletas de servicios y las reglas de traslado por contrato: quién
-- paga, cómo se reparte, plan de pago y recupero anual, estado de la boleta y
-- quién la pagó, a quién va el descuento por pago anual y qué se hace con las cuotas que
-- quedan al terminar el contrato. Suma el impuesto inmobiliario provincial a los tipos de
-- servicio. El valor agregado con ALTER TYPE no se puede usar en la misma
-- transacción que lo agrega, por eso las tablas van en la migración siguiente.
-- Rollback: DROP TYPE "BillingFrequency", "ChargePayer", "ChargeSplitMode",
-- "ServicePaymentPlan", "AnnualRecovery", "AnnualDiscountBeneficiary",
-- "RemainingInstallmentsOnEnd", "ServiceBillStatus", "BillPaidBy"
-- (después de revertir la migración siguiente). Postgres no permite quitar un
-- valor de un enum: ninguna fila existente usa ImpuestoInmobiliario; si hiciera
-- falta quitarlo, crear el tipo sin él, reasignar "services"."serviceType" y
-- borrar el viejo.

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('Mensual', 'Bimestral', 'Trimestral', 'Anual');

-- CreateEnum
CREATE TYPE "ChargePayer" AS ENUM ('Inquilino', 'Inmobiliaria', 'Propietario');

-- CreateEnum
CREATE TYPE "ChargeSplitMode" AS ENUM ('Porcentaje', 'Consumo', 'Fijo');

-- CreateEnum
CREATE TYPE "ServicePaymentPlan" AS ENUM ('Mensual', 'Anual');

-- CreateEnum
CREATE TYPE "AnnualRecovery" AS ENUM ('Unico', 'Prorrateado');

-- CreateEnum
CREATE TYPE "AnnualDiscountBeneficiary" AS ENUM ('Inquilino', 'Locador', 'Inmobiliaria');

-- CreateEnum
CREATE TYPE "RemainingInstallmentsOnEnd" AS ENUM ('CobrarEnLiquidacionFinal', 'Descartar');

-- CreateEnum
CREATE TYPE "ServiceBillStatus" AS ENUM ('Pendiente', 'Pagada', 'Anulada');

-- CreateEnum
CREATE TYPE "BillPaidBy" AS ENUM ('Inquilino', 'Inmobiliaria', 'Propietario');

-- AlterEnum
ALTER TYPE "ServiceType" ADD VALUE 'ImpuestoInmobiliario';
