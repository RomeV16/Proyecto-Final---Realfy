-- Tipos de ventas y llaves: etapa de la operación de venta, lado de cada parte, reservas y señas
-- (tipo, quién guarda el dinero, estado) y quién tiene un juego de llaves. Van en su propia
-- migración, antes de las que los usan.
-- Rollback (después de revertir las dos migraciones siguientes): DROP TYPE "KeyHolder",
-- "SalesDepositStatus", "SalesDepositHolder", "SalesDepositKind", "SalesPartyRole",
-- "SalesOperationStatus".

-- CreateEnum
CREATE TYPE "SalesOperationStatus" AS ENUM ('Captacion', 'Publicada', 'Reservada', 'SenaRecibida', 'Boleto', 'Escriturada', 'Cancelada');

-- CreateEnum
CREATE TYPE "SalesPartyRole" AS ENUM ('Comprador', 'Vendedor');

-- CreateEnum
CREATE TYPE "SalesDepositKind" AS ENUM ('Reserva', 'Sena');

-- CreateEnum
CREATE TYPE "SalesDepositHolder" AS ENUM ('Inmobiliaria', 'Vendedor', 'Escribano');

-- CreateEnum
CREATE TYPE "SalesDepositStatus" AS ENUM ('Pendiente', 'Recibida', 'Devuelta', 'Retenida', 'Vencida', 'Aplicada');

-- CreateEnum
CREATE TYPE "KeyHolder" AS ENUM ('Oficina', 'Propietario', 'Inquilino', 'Empleado', 'Tercero');
