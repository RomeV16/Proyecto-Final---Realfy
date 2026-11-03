-- migracion: 20261103130200_llaves
-- llaves: las tablas nacen vacías y ninguna propiedad existente queda con llaves cargadas.
-- Devuelve filas SOLO si algo salió mal.

SELECT 'tabla de llaves con filas' AS problema, t.nombre || ': ' || t.hay AS detalle
FROM (
  SELECT 'key_sets' AS nombre, count(*) AS hay FROM "key_sets"
  UNION ALL SELECT 'key_movements', count(*) FROM "key_movements"
) t
WHERE t.hay <> 0;
