-- Tipos de la bandeja de consultas (PR 5.3): canal, estado y sentido de los
-- mensajes de una consulta, y dos avisos nuevos de la bandeja de notificaciones
-- (plazo de primera respuesta vencido y consulta asignada). Van en su propia
-- migración, antes de las tablas que los usan: un valor nuevo de un enum no se
-- puede usar en la misma transacción que lo crea.
--
-- Rollback (después de revertir la migración siguiente): los valores agregados a
-- "NotificationType" no se pueden quitar sin recrear el tipo; si no hay
-- notificaciones con esos tipos se dejan, porque no molestan. Los tipos nuevos
-- se borran:
--   DROP TYPE "ConversationChannel", "ConversationStatus", "MessageDirection";

-- CreateEnum
CREATE TYPE "ConversationChannel" AS ENUM ('WhatsApp', 'Email', 'Web', 'Telefono');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('Nueva', 'Asignada', 'EnCurso', 'Esperando', 'Resuelta', 'Archivada');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('In', 'Out');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'InboxSlaBreached';
ALTER TYPE "NotificationType" ADD VALUE 'InboxAssigned';
