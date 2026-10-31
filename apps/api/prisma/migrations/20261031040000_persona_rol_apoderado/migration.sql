-- Rol de persona "Apoderado". El valor nuevo no se puede usar en la misma
-- transacción en la que se agrega, por eso va solo y la migración siguiente
-- (locadores_y_apoderados) lo usa.
-- Rollback: Postgres no permite quitar un valor de un enum; si no hay filas con
-- el rol 'Apoderado' basta con dejarlo, no estorba.
ALTER TYPE "PersonRole" ADD VALUE 'Apoderado';
