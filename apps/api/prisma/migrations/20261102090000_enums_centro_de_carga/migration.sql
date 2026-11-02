-- Tipos del centro de carga: quién soporta un cargo puntual, de qué clase es y en qué
-- estado está, y sobre qué comisión se mide el umbral de anticipo. Van en su propia
-- migración, antes de lo que los usa.
-- Rollback: DROP TYPE "UpfrontBasis", "PendingChargeStatus", "PendingChargeKind", "ChargeTarget"
-- (después de revertir la migración siguiente).

-- CreateEnum
CREATE TYPE "UpfrontBasis" AS ENUM ('ComisionPactada', 'PorcentajePorDefecto');

-- CreateEnum
CREATE TYPE "ChargeTarget" AS ENUM ('Inquilino', 'Locador', 'Inmobiliaria');

-- CreateEnum
CREATE TYPE "PendingChargeKind" AS ENUM ('Reparacion', 'ExpensaExtra', 'Devolucion', 'HonorarioGestion', 'AjusteRetroactivo', 'Otro');

-- CreateEnum
CREATE TYPE "PendingChargeStatus" AS ENUM ('Pendiente', 'Imputado', 'CobradoAnticipado', 'Anulado');
