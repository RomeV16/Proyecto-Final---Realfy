-- migracion: 20261031040100_locadores_y_apoderados
-- locadores_y_apoderados: backfill de locadores y titularidad.
-- Devuelve filas SOLO si algo salió mal.

-- Contrato con propietarios y ningún locador.
SELECT 'contrato con propietarios y sin locadores' AS problema, c."id" AS detalle
FROM "contracts" c
WHERE EXISTS (SELECT 1 FROM "contract_persons" cp WHERE cp."contractId" = c."id" AND cp."role" = 'Propietario')
  AND NOT EXISTS (SELECT 1 FROM "contract_lessors" l WHERE l."contractId" = c."id")

UNION ALL
-- Contrato sin propietarios con locadores inventados.
SELECT 'locadores sin propietario de origen', c."id"
FROM "contracts" c
WHERE NOT EXISTS (SELECT 1 FROM "contract_persons" cp WHERE cp."contractId" = c."id" AND cp."role" = 'Propietario')
  AND EXISTS (SELECT 1 FROM "contract_lessors" l WHERE l."contractId" = c."id")

UNION ALL
-- Cada propietario del contrato es exactamente un locador, y no sobran.
SELECT 'locador sin propietario o propietario sin locador', coalesce(l."contractId", cp."contractId") || ' / ' || coalesce(l."personId", cp."personId")
FROM (SELECT * FROM "contract_persons" WHERE "role" = 'Propietario') cp
FULL JOIN "contract_lessors" l ON l."contractId" = cp."contractId" AND l."personId" = cp."personId"
WHERE l."id" IS NULL OR cp."id" IS NULL

UNION ALL
-- Los locadores vigentes al inicio del contrato suman exactamente 100.
SELECT 'locadores que no suman 100', c."id" || ' suma ' || sum(l."payoutPct")
FROM "contracts" c
JOIN "contract_lessors" l ON l."contractId" = c."id"
WHERE l."validFrom" <= c."startDate" AND (l."validTo" IS NULL OR l."validTo" > c."startDate")
GROUP BY c."id"
HAVING sum(l."payoutPct") <> 100.0000

UNION ALL
-- Forma de cada locador migrado: vigente desde el inicio del contrato, como
-- propietario, sin cobrador ni cuenta, y marcado para revisar si hay reparto.
SELECT 'locador con forma inesperada', l."id"
FROM "contract_lessors" l
JOIN "contracts" c ON c."id" = l."contractId"
WHERE l."validFrom" <> c."startDate"
   OR l."validTo" IS NOT NULL
   OR l."capacity" <> 'Propietario'
   OR l."payeePersonId" IS NOT NULL
   OR l."bankAccountId" IS NOT NULL
   OR l."needsReview" <> ((SELECT count(*) FROM "contract_lessors" o WHERE o."contractId" = l."contractId") > 1)
   OR l."tenantId" <> c."tenantId"

UNION ALL
-- El reparto en tres partes de con-3 es 33.3333 / 33.3333 / 33.3334.
SELECT 'reparto de tres inesperado', string_agg(l."payoutPct"::text, ' ' ORDER BY l."payoutPct")
FROM "contract_lessors" l
WHERE l."contractId" = 'con-3'
HAVING string_agg(l."payoutPct"::text, ' ' ORDER BY l."payoutPct") <> '33.3333 33.3333 33.3334'

UNION ALL
-- Cada propiedad guardada en una asignación Propietario es una titularidad
-- sin porcentaje, y no hay titularidades de más.
SELECT 'titularidad faltante', r."id"
FROM "person_role_assignments" r
WHERE r."role" = 'Propietario' AND r."propertyId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "property_ownerships" o
    WHERE o."personId" = r."personId" AND o."propertyId" = r."propertyId"
      AND o."tenantId" = r."tenantId" AND o."sharePct" IS NULL
  )

UNION ALL
SELECT 'titularidad de más', o."id"
FROM "property_ownerships" o
WHERE NOT EXISTS (
  SELECT 1 FROM "person_role_assignments" r
  WHERE r."role" = 'Propietario' AND r."personId" = o."personId" AND r."propertyId" = o."propertyId"
)

UNION ALL
-- La asignación de rol conserva su propiedad (la columna no se toca).
SELECT 'asignacion con propiedad perdida', r."id"
FROM "person_role_assignments" r
WHERE r."id" IN ('r01', 'r05', 'rb1') AND r."propertyId" IS NULL

UNION ALL
-- No se crean poderes: no había nada de dónde sacarlos.
SELECT 'poderes inesperados', count(*)::text
FROM "powers_of_attorney" HAVING count(*) > 0

UNION ALL
-- Las rendiciones existentes siguen y la clave única nueva las admite.
SELECT 'rendiciones perdidas', count(*)::text
FROM "owner_rendiciones" HAVING count(*) <> 1;
