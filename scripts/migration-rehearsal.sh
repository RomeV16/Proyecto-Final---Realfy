#!/usr/bin/env bash
# Ensayo de migraciones sobre datos sintéticos con forma real.
#
#   DATABASE_URL=postgresql://... scripts/migration-rehearsal.sh <base-ref>
#
# 1. Aplica sobre la base (vacía) las migraciones que ya existen en <base-ref>.
# 2. Carga apps/api/test/migration-data/seed.sql, escrito contra ese esquema.
# 3. Aplica TODAS las migraciones del árbol actual (prisma migrate deploy).
# 4. Corre cada archivo de apps/api/test/migration-data/checks/*.sql. Cada uno
#    devuelve filas SOLO si algo salió mal; cualquier fila hace fallar el ensayo.
#
# Una migración con backfill puede aplicar sin error y aun así dejar los datos
# mal; las bases vacías de "Migrations from scratch" no lo detectan.
set -euo pipefail

BASE_REF=${1:?uso: migration-rehearsal.sh <base-ref>}
: "${DATABASE_URL:?DATABASE_URL debe apuntar a una base vacía}"

ROOT=$(git rev-parse --show-toplevel)
API="$ROOT/apps/api"
DATA="$API/test/migration-data"
PRISMA="$API/node_modules/.bin/prisma"
# prisma y psql no entienden el parámetro ?schema= igual; psql recibe la URL tal cual.
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if ! git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  echo "No existe la referencia base: $BASE_REF" >&2
  exit 2
fi

# Esquema y migraciones tal como estaban en la base, sin tocar el árbol de trabajo.
git archive "$BASE_REF" apps/api/prisma | tar -x -C "$TMP"
BASE_SCHEMA="$TMP/apps/api/prisma/schema.prisma"
BASE_COUNT=$(find "$TMP/apps/api/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)
HEAD_COUNT=$(find "$API/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)
echo "== Base $BASE_REF: $BASE_COUNT migraciones; árbol actual: $HEAD_COUNT"

if [ "$BASE_COUNT" -eq "$HEAD_COUNT" ]; then
  echo "El árbol actual no agrega migraciones respecto de $BASE_REF: nada que ensayar."
  exit 0
fi

echo "== 1/4 Migraciones de la base"
"$PRISMA" migrate deploy --schema "$BASE_SCHEMA" >"$TMP/deploy-base.log" 2>&1 || { cat "$TMP/deploy-base.log"; exit 1; }

echo "== 2/4 Datos sintéticos"
"${PSQL[@]}" -f "$DATA/seed.sql"

echo "== 3/4 Migraciones nuevas sobre esos datos"
"$PRISMA" migrate deploy --schema "$API/prisma/schema.prisma" >"$TMP/deploy-head.log" 2>&1 || { cat "$TMP/deploy-head.log"; exit 1; }
tail -n 3 "$TMP/deploy-head.log"

echo "== 4/4 Verificaciones"
FAILED=0
shopt -s nullglob
CHECKS=("$DATA"/checks/*.sql)
if [ "${#CHECKS[@]}" -eq 0 ]; then
  echo "No hay verificaciones en $DATA/checks" >&2
  exit 2
fi
for check in "${CHECKS[@]}"; do
  name=$(basename "$check")
  rows=$("${PSQL[@]}" -At -F ' | ' -f "$check")
  if [ -n "$rows" ]; then
    echo "FALLA $name"
    echo "$rows" | sed 's/^/    /'
    FAILED=1
  else
    echo "ok    $name"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "El ensayo de migraciones falló." >&2
  exit 1
fi
echo "El ensayo de migraciones pasó (${#CHECKS[@]} verificaciones)."
