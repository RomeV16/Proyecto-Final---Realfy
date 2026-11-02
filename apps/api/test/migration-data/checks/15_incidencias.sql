-- migracion: 20261102230100_incidencias
-- incidencias: "costPayer" pasa de texto libre a ChargeTarget. Los valores conocidos se mapean
-- (sin distinguir mayúsculas, tildes ni espacios); el resto queda en NULL y el texto anterior se
-- conserva en "providerNotes". Devuelve filas SOLO si algo salió mal.

SELECT 'quién pagaba mal mapeado' AS problema, t."id" || ' => ' || coalesce(t."costPayer"::text, 'NULL') AS detalle
FROM "tickets" t
WHERE (t."id" = 'tkt-1' AND t."costPayer" IS DISTINCT FROM 'Inquilino')
   OR (t."id" = 'tkt-2' AND t."costPayer" IS DISTINCT FROM 'Locador')
   OR (t."id" = 'tkt-3' AND t."costPayer" IS DISTINCT FROM 'Locador')
   OR (t."id" = 'tkt-4' AND t."costPayer" IS DISTINCT FROM 'Inmobiliaria')
   OR (t."id" IN ('tkt-5', 'tkt-6', 'tkt-7') AND t."costPayer" IS NOT NULL)

UNION ALL
-- Lo no reconocido no se pierde: queda en las notas; lo reconocido no las toca.
SELECT 'texto anterior no conservado', t."id"
FROM "tickets" t
WHERE t."id" = 'tkt-5' AND (t."providerNotes" IS NULL OR t."providerNotes" NOT LIKE '%mitad y mitad%')

UNION ALL
SELECT 'nota del proveedor alterada sin necesidad', t."id"
FROM "tickets" t
WHERE (t."id" = 'tkt-2' AND t."providerNotes" IS DISTINCT FROM 'Nota previa')
   OR (t."id" IN ('tkt-1', 'tkt-3', 'tkt-4', 'tkt-6', 'tkt-7') AND t."providerNotes" IS NOT NULL)

UNION ALL
-- Los tickets existentes siguen en su estado y sin los datos nuevos.
SELECT 'ticket existente con datos nuevos o estado cambiado', t."id"
FROM "tickets" t
WHERE t."contractId" IS NOT NULL
   OR t."estimatedAmount" IS NOT NULL
   OR t."preauthorizedAmount" IS NOT NULL
   OR t."preauthorizedAt" IS NOT NULL
   OR t."preauthorizedByPersonId" IS NOT NULL
   OR t."preauthorizedChannel" IS NOT NULL
   OR t."imputedAt" IS NOT NULL
   OR (t."id" = 'tkt-2' AND t."status" <> 'Resuelto')
   OR (t."id" = 'tkt-3' AND t."status" <> 'Cerrado')
   OR (t."id" IN ('tkt-1', 'tkt-4', 'tkt-5', 'tkt-6', 'tkt-7') AND t."status" <> 'Abierto')

UNION ALL
-- Las versiones de reglas existentes siguen sin límite propio: rige el de la inmobiliaria.
SELECT 'versión de reglas con límite de reparaciones propio', v."id"
FROM "contract_terms_versions" v
WHERE v."repairPreauthLimitAmount" IS NOT NULL OR v."repairPreauthLimitCurrency" IS NOT NULL

UNION ALL
-- Los presupuestos nacen vacíos.
SELECT 'presupuesto previo a la migración', q."id"
FROM "ticket_quotes" q;
