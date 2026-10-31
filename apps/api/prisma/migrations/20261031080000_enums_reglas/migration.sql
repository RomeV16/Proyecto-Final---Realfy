-- Valores nuevos de enums para las reglas del contrato: ajuste por UVA y
-- escalonado, y tasa activa del Banco Nación como índice. Van solos en su
-- migración porque un valor agregado con ALTER TYPE no se puede usar en la
-- misma transacción que lo agrega.
-- Rollback: Postgres no permite quitar un valor de un enum. Si hiciera falta,
-- crear el tipo sin esos valores, reasignar las columnas y borrar el viejo;
-- ninguna fila existente usa los valores nuevos.

-- AlterEnum
ALTER TYPE "AdjustmentType" ADD VALUE 'UVA';
ALTER TYPE "AdjustmentType" ADD VALUE 'Escalonado';

-- AlterEnum
ALTER TYPE "IndexType" ADD VALUE 'TasaActivaBNA';
