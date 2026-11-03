-- migracion: 20261103110100_publicacion
-- publicación: la tabla de avisos nace vacía, así que ninguna propiedad existente
-- queda publicada en el micrositio (sólo lo que alguien marque explícitamente).
-- Devuelve filas SOLO si algo salió mal.

SELECT 'avisos con filas' AS problema, 'property_listings: ' || j.hay AS detalle
FROM (SELECT count(*) AS hay FROM "property_listings") j
WHERE j.hay <> 0;
