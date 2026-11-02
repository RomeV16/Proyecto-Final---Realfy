-- Tipos de incidencias: tres estados nuevos del ticket (esperar la autorización del
-- locador, presupuestar, presupuesto aprobado), el estado de un presupuesto y el
-- canal por el que se registró una aprobación. Van en su propia migración, antes
-- de lo que los usa (un valor nuevo de un enum no se puede usar en la misma
-- transacción que lo agrega).
-- Rollback: DROP TYPE "TicketQuoteStatus", "ApprovalChannel" (después de revertir la
-- migración siguiente). Postgres no quita un valor de un enum: para sacar los tres
-- estados de "TicketStatus" hay que recrear el tipo sin ellos, y solo si ningún
-- ticket los usa.

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'PendienteAutorizacion';
ALTER TYPE "TicketStatus" ADD VALUE 'Presupuestado';
ALTER TYPE "TicketStatus" ADD VALUE 'PresupuestoAprobado';

-- CreateEnum
CREATE TYPE "TicketQuoteStatus" AS ENUM ('Pendiente', 'Aprobado', 'Rechazado');

-- CreateEnum
CREATE TYPE "ApprovalChannel" AS ENUM ('WhatsApp', 'Telefono', 'Mail', 'Presencial');
