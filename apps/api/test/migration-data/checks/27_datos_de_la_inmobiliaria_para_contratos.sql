-- migracion: 20261103215004_datos_de_la_inmobiliaria_para_contratos
-- Matrícula y domicilio de la inmobiliaria: las columnas nacen vacías, así que
-- ninguna inmobiliaria existente cambia (los completa quien administra).
-- Devuelve filas SOLO si algo salió mal.

SELECT 'inmobiliarias con matrícula o domicilio' AS problema, 'tenants: ' || j.hay AS detalle
FROM (SELECT count(*) AS hay FROM "tenants" WHERE "licenseNumber" IS NOT NULL OR "address" IS NOT NULL) j
WHERE j.hay <> 0;
