-- personas_datos_y_referencias: backfill de cuentas bancarias.
-- Devuelve filas SOLO si algo salió mal.

-- Persona con algún dato bancario viejo que no quedó con exactamente una cuenta
-- ARS predeterminada con esos datos.
SELECT 'sin cuenta predeterminada correcta' AS problema, p."id" AS detalle
FROM "persons" p
WHERE (NULLIF(btrim(p."bankName"), '') IS NOT NULL
    OR NULLIF(btrim(p."cbu"), '') IS NOT NULL
    OR NULLIF(btrim(p."bankAlias"), '') IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "person_bank_accounts" a
    WHERE a."personId" = p."id"
      AND a."currency" = 'ARS'
      AND a."isDefault"
      AND a."bankName" IS NOT DISTINCT FROM NULLIF(btrim(p."bankName"), '')
      AND a."cbu"      IS NOT DISTINCT FROM NULLIF(btrim(p."cbu"), '')
      AND a."alias"    IS NOT DISTINCT FROM NULLIF(btrim(p."bankAlias"), '')
  )

UNION ALL
-- Persona con datos bancarios viejos y una cantidad de cuentas distinta de uno.
SELECT 'cuentas distintas de una', p."id" || ' tiene ' || count(a."id")
FROM "persons" p
LEFT JOIN "person_bank_accounts" a ON a."personId" = p."id"
WHERE NULLIF(btrim(p."bankName"), '') IS NOT NULL
   OR NULLIF(btrim(p."cbu"), '') IS NOT NULL
   OR NULLIF(btrim(p."bankAlias"), '') IS NOT NULL
GROUP BY p."id"
HAVING count(a."id") <> 1

UNION ALL
-- Persona sin datos bancarios (o solo vacíos) que recibió una cuenta.
SELECT 'cuenta inventada', p."id"
FROM "persons" p
JOIN "person_bank_accounts" a ON a."personId" = p."id"
WHERE NULLIF(btrim(p."bankName"), '') IS NULL
  AND NULLIF(btrim(p."cbu"), '') IS NULL
  AND NULLIF(btrim(p."bankAlias"), '') IS NULL

UNION ALL
-- Cuenta huérfana o de otra inmobiliaria que su persona.
SELECT 'cuenta huerfana o de otra inmobiliaria', a."id"
FROM "person_bank_accounts" a
LEFT JOIN "persons" p ON p."id" = a."personId"
WHERE p."id" IS NULL OR p."tenantId" <> a."tenantId"

UNION ALL
-- Más de una predeterminada, o ninguna, por persona y moneda.
SELECT 'predeterminadas por moneda distintas de una', a."personId" || '/' || a."currency"
FROM "person_bank_accounts" a
GROUP BY a."personId", a."currency"
HAVING count(*) FILTER (WHERE a."isDefault") <> 1

UNION ALL
-- Total de cuentas esperado según seed.sql: 7 en la inmobiliaria A, 1 en la B.
SELECT 'total de cuentas inesperado', 'tenant ' || t."id" || ': ' || count(a."id")
FROM "tenants" t
LEFT JOIN "person_bank_accounts" a ON a."tenantId" = t."id"
GROUP BY t."id"
HAVING count(a."id") <> CASE t."id" WHEN 'tenant-a' THEN 7 WHEN 'tenant-b' THEN 1 END;
