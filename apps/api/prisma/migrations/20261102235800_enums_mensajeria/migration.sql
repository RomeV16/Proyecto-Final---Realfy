-- Tipos de la mensajería saliente (D13, ADR-0013): canal, estado del mensaje,
-- estado y origen del consentimiento, y tres avisos nuevos de la bandeja de
-- notificaciones (mensaje que no salió, baja de un contacto y mensaje
-- entrante). Van en su propia migración, antes de las tablas que los usan: un
-- valor nuevo de un enum no se puede usar en la misma transacción que lo crea.
--
-- Rollback (después de revertir la migración siguiente): los valores
-- agregados a "NotificationType" no se pueden quitar sin recrear el tipo; si
-- no hay notificaciones con esos tipos se dejan, porque no molestan. Los
-- tipos nuevos se borran:
--   DROP TYPE "MessageChannel", "MessageStatus", "ConsentStatus", "ConsentSource";

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('Email', 'WhatsApp');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('Pending', 'Sending', 'Sent', 'Delivered', 'Read', 'Failed', 'Blocked', 'Cancelled');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('OptIn', 'OptOut');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('Manual', 'Inbound', 'Complaint');

-- AlterEnum

ALTER TYPE "NotificationType" ADD VALUE 'MessageFailed';
ALTER TYPE "NotificationType" ADD VALUE 'ContactOptedOut';
ALTER TYPE "NotificationType" ADD VALUE 'InboundMessageReceived';
