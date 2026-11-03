-- migracion: 20261103160100_bandeja_de_consultas
-- bandeja de consultas: los mensajes entrantes que ya estaban guardados quedan
-- agrupados en consultas archivadas (una por inmobiliaria, canal y dirección) y
-- ninguno queda afuera ni genera trabajo pendiente. Sin mensajes previos, las
-- tablas nacen vacías.
-- Devuelve filas SOLO si algo salió mal.

SELECT 'mensaje entrante sin consulta' AS problema, 'inbound_messages: ' || m."id" AS detalle
FROM "inbound_messages" m
WHERE NOT EXISTS (SELECT 1 FROM "conversation_messages" cm WHERE cm."inboundMessageId" = m."id")

UNION ALL

SELECT 'consulta del backfill abierta o con plazo', 'conversations: ' || c."id"
FROM "conversations" c
WHERE c."status" <> 'Archivada' OR c."slaDueAt" IS NOT NULL

UNION ALL

SELECT 'consulta con mensajes de otra inmobiliaria', 'conversations: ' || c."id"
FROM "conversations" c
JOIN "conversation_messages" cm ON cm."conversationId" = c."id"
WHERE cm."tenantId" <> c."tenantId"

UNION ALL

SELECT 'consultas de más', 'conversations: ' || j.hay
FROM (SELECT count(*) AS hay FROM "conversations") j
WHERE j.hay <> (SELECT count(*) FROM (SELECT DISTINCT "tenantId", "channel", "from" FROM "inbound_messages") g);
