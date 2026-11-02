-- migracion: 20261102090100_centro_de_carga
-- centro_de_carga: la tabla nace vacía (sin backfill). Devuelve filas SOLO si algo salió mal.

SELECT 'cargo pendiente previo a la migración' AS problema, c."id" AS detalle
FROM "pending_charges" c;
