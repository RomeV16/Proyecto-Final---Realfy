-- Matrícula y domicilio de la inmobiliaria, para las plantillas de contrato.
ALTER TABLE "tenants" ADD COLUMN "licenseNumber" TEXT,
ADD COLUMN "address" TEXT;
