-- migracion: 20261102235900_mensajeria
-- mensajería: tablas nuevas vacías y avisos existentes sin tocar. Devuelve
-- filas SOLO si algo salió mal.

-- Sin backfill: la bandeja de salida, el consentimiento y los entrantes nacen
-- vacíos (ningún mensaje viejo se reconstruye ni se manda).
SELECT 'tabla nueva con filas' AS problema, t.tabla || ': ' || t.hay AS detalle
FROM (
  SELECT 'message_outbox' AS tabla, (SELECT count(*) FROM "message_outbox") AS hay
  UNION ALL SELECT 'contact_consents', (SELECT count(*) FROM "contact_consents")
  UNION ALL SELECT 'inbound_messages', (SELECT count(*) FROM "inbound_messages")
) t
WHERE t.hay <> 0

UNION ALL
-- Los tipos nuevos de aviso existen y ninguna notificación previa cambió de tipo.
SELECT 'falta el tipo de aviso', v.valor
FROM (VALUES ('MessageFailed'), ('ContactOptedOut'), ('InboundMessageReceived')) AS v(valor)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid
  WHERE ty.typname = 'NotificationType' AND e.enumlabel = v.valor
)

UNION ALL
SELECT 'notificación con un tipo nuevo antes de la mensajería', n."id"
FROM "notifications" n
WHERE n."type"::text IN ('MessageFailed', 'ContactOptedOut', 'InboundMessageReceived')

UNION ALL
-- Una persona borrada no se lleva el historial de consentimiento (la baja se respeta igual).
SELECT 'clave del consentimiento sin SET NULL', c.conname
FROM pg_constraint c
WHERE c.conname = 'contact_consents_personId_fkey' AND c.confdeltype <> 'n';
