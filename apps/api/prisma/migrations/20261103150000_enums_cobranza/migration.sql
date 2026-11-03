-- Enums de la cobranza escalonada (D13, ADR-0013): etapa del caso, tipo de
-- acción y su estado. Van en su propia migración, antes de las tablas que los
-- usan.
--
-- Rollback:
--   DROP TYPE "CollectionActionStatus"; DROP TYPE "CollectionActionKind";
--   DROP TYPE "CollectionStage";

-- CreateEnum
CREATE TYPE "CollectionStage" AS ENUM ('Recordatorio', 'Prejudicial', 'Abogado', 'Judicial', 'Cerrado');

-- CreateEnum
CREATE TYPE "CollectionActionKind" AS ENUM ('Recordatorio', 'RecordatorioFirme', 'CartaDocumento', 'DerivacionAbogado', 'Nota', 'Pago', 'Acuerdo');

-- CreateEnum
CREATE TYPE "CollectionActionStatus" AS ENUM ('Preparada', 'Realizada');
