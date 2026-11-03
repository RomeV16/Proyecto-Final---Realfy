-- Tipo de la convención para un ajuste aplicado después de emitir la
-- liquidación de un mes en que ya regía (DEF-134): Retroactivo (la diferencia
-- se cobra en la próxima liquidación) o SinRetroactivo. Va en su propia
-- migración, separada de la columna que lo usa.
-- Rollback: DROP TYPE "LateAdjustmentBilling" (después de revertir la
-- migración siguiente).

-- CreateEnum
CREATE TYPE "LateAdjustmentBilling" AS ENUM ('Retroactivo', 'SinRetroactivo');
