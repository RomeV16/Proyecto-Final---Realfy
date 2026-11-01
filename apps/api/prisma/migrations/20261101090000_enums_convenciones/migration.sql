-- Tipos de las convenciones de liquidación pactables por contrato: prorrateo,
-- ajuste a mitad de mes, primer mes con inicio tardío y descuento fijo. Van en
-- su propia migración, separada de las columnas que los usan.
-- Rollback: DROP TYPE "ProrationMode", "MidMonthAdjustmentMode", "FirstDueMode",
-- "FixedDiscountProration" (después de revertir la migración siguiente).

-- CreateEnum
CREATE TYPE "ProrationMode" AS ENUM ('DiasReales', 'Mes30', 'SinProrrateo');

-- CreateEnum
CREATE TYPE "MidMonthAdjustmentMode" AS ENUM ('DesdePeriodoSiguiente', 'Prorrateado', 'DesdeEsePeriodo');

-- CreateEnum
CREATE TYPE "FirstDueMode" AS ENUM ('DiaDeInicio', 'VencimientoMesSiguiente', 'AlFirmar');

-- CreateEnum
CREATE TYPE "FixedDiscountProration" AS ENUM ('Proporcional', 'Completo');
