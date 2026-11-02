-- migracion: 20261102200100_cuenta_corriente_del_locador
-- cuenta_corriente_del_locador: tablas nuevas vacías y comisiones sin honorario por
-- gestión. Devuelve filas SOLO si algo salió mal.

-- Sin backfill: la cuenta corriente y los estados nacen vacíos (el saldo inicial se
-- carga después, por locador y moneda).
SELECT 'tabla nueva con filas' AS problema, t.tabla || ': ' || t.hay AS detalle
FROM (
  SELECT 'owner_ledger_entries' AS tabla, (SELECT count(*) FROM "owner_ledger_entries") AS hay
  UNION ALL SELECT 'owner_statements', (SELECT count(*) FROM "owner_statements")
) t
WHERE t.hay <> 0

UNION ALL
-- Ninguna comisión existente cobra honorario por gestión de reparaciones.
SELECT 'comisión con honorario por gestión inesperado', c."id"
FROM "contract_commissions" c
WHERE c."repairMgmtFeePct" IS NOT NULL

UNION ALL
-- Las rendiciones históricas no se tocan: siguen todas las que había.
SELECT 'rendición sin contrato o sin locador', r."id"
FROM "owner_rendiciones" r
LEFT JOIN "contracts" ct ON ct."id" = r."contractId"
LEFT JOIN "persons" p ON p."id" = r."ownerId"
WHERE ct."id" IS NULL OR p."id" IS NULL;
