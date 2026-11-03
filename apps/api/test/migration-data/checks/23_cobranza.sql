-- migracion: 20261103150100_cobranza
-- cobranza escalonada: tablas nuevas vacías y datos existentes sin tocar.
-- Devuelve filas SOLO si algo salió mal.

-- Sin backfill: ningún caso se abre solo al migrar (ni se manda nada).
SELECT 'tabla nueva con filas' AS problema, t.tabla || ': ' || t.hay AS detalle
FROM (
  SELECT 'collection_cases' AS tabla, (SELECT count(*) FROM "collection_cases") AS hay
  UNION ALL SELECT 'collection_actions', (SELECT count(*) FROM "collection_actions")
) t
WHERE t.hay <> 0

UNION ALL
-- Los enums existen con todos sus valores.
SELECT 'falta un valor del enum', v.tipo || '.' || v.valor
FROM (VALUES
  ('CollectionStage', 'Recordatorio'), ('CollectionStage', 'Prejudicial'), ('CollectionStage', 'Abogado'),
  ('CollectionStage', 'Judicial'), ('CollectionStage', 'Cerrado'),
  ('CollectionActionKind', 'Recordatorio'), ('CollectionActionKind', 'RecordatorioFirme'),
  ('CollectionActionKind', 'CartaDocumento'), ('CollectionActionKind', 'DerivacionAbogado'),
  ('CollectionActionKind', 'Nota'), ('CollectionActionKind', 'Pago'), ('CollectionActionKind', 'Acuerdo'),
  ('CollectionActionStatus', 'Preparada'), ('CollectionActionStatus', 'Realizada')
) AS v(tipo, valor)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
  WHERE ty.typname = v.tipo AND e.enumlabel = v.valor
)

UNION ALL
-- Borrar un contrato borra sus casos y su línea de tiempo; borrar un mensaje conserva la acción.
SELECT 'clave foránea con otra regla de borrado', c.conname
FROM pg_constraint c
WHERE (c.conname IN ('collection_cases_contractId_fkey', 'collection_actions_caseId_fkey') AND c.confdeltype <> 'c')
   OR (c.conname = 'collection_actions_outboxMessageId_fkey' AND c.confdeltype <> 'n')

UNION ALL
-- Las liquidaciones y el valor por defecto de la cobranza no cambian: los valores guardados
-- siguen válidos (la cobranza queda apagada hasta que la inmobiliaria la prenda).
SELECT 'valores por defecto con la cobranza prendida', t."id"
FROM "tenants" t
WHERE t."operationalDefaults" IS NOT NULL
  AND t."operationalDefaults"->'collections'->>'enabled' = 'true';
