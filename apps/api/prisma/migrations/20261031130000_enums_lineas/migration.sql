-- Tipos de renglón nuevos para la liquidación (impuesto, servicio, cargo,
-- honorario y ajuste retroactivo) y los enums de destino y tipo de liquidación.
-- Los valores agregados con ALTER TYPE no se pueden usar en la misma
-- transacción que los agrega, por eso la migración que los usa es la siguiente.
-- Rollback: DROP TYPE "LineBeneficiary", "LiquidacionKind" (después de revertir
-- la migración siguiente). Postgres no permite quitar valores de un enum: si
-- hiciera falta, crear el tipo sin ellos, reasignar la columna y borrar el
-- viejo; ninguna fila existente usa los valores nuevos.

-- AlterEnum
ALTER TYPE "LineItemType" ADD VALUE 'Impuesto';
ALTER TYPE "LineItemType" ADD VALUE 'Servicio';
ALTER TYPE "LineItemType" ADD VALUE 'Cargo';
ALTER TYPE "LineItemType" ADD VALUE 'Honorario';
ALTER TYPE "LineItemType" ADD VALUE 'AjusteRetroactivo';

-- CreateEnum
CREATE TYPE "LineBeneficiary" AS ENUM ('Locador', 'Inmobiliaria', 'Ente');

-- CreateEnum
CREATE TYPE "LiquidacionKind" AS ENUM ('Mensual', 'PagoACuenta', 'Egreso');
