#!/usr/bin/env bash
# Ensayo de migraciones sobre datos sintéticos con forma real.
#
#   DATABASE_URL=postgresql://... scripts/migration-rehearsal.sh <base-ref>
#
# 1. Aplica sobre la base (vacía) las migraciones hasta el esquema para el que
#    está escrita la semilla: la carpeta que declara la línea
#    `-- esquema: <carpeta>` de seed.sql (el "ancla"). Sin ancla, aplica las
#    migraciones que ya existen en <base-ref>.
# 2. Carga apps/api/test/migration-data/seed.sql, escrito contra ese esquema.
# 3. Aplica TODAS las migraciones del árbol actual (prisma migrate deploy).
# 4. Corre cada archivo de apps/api/test/migration-data/checks/*.sql. Cada uno
#    devuelve filas SOLO si algo salió mal; cualquier fila hace fallar el ensayo.
#    Una verificación cuya primera línea es `-- migracion: <carpeta>` solo corre
#    si esa migración es nueva respecto de <base-ref>: el backfill de una
#    migración ya aplicada en la base corrió sobre una base vacía y no tiene
#    nada que verificar.
#
# Una migración con backfill puede aplicar sin error y aun así dejar los datos
# mal; las bases vacías de "Migrations from scratch" no lo detectan.
#
# El ancla evita que la semilla quede vieja: una migración que agrega una
# columna obligatoria no obliga a reescribir la semilla, porque se aplica
# después de cargarla, igual que en una base con datos reales. Cuando la semilla
# necesite datos de una tabla nueva, se la reescribe contra un esquema más
# reciente y se mueve el ancla.
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

ANCHOR=$(sed -n 's/^-- esquema: *//p' "$DATA/seed.sql" | head -n 1)
if [ -n "$ANCHOR" ]; then
  if [ ! -d "$API/prisma/migrations/$ANCHOR" ]; then
    echo "La semilla declara el esquema $ANCHOR, que no existe en prisma/migrations" >&2
    exit 2
  fi
  # Copia de las migraciones del árbol actual, cortada en el ancla.
  mkdir -p "$TMP/ancla"
  cp -r "$API/prisma/." "$TMP/ancla/"
  for dir in "$TMP/ancla/migrations"/*/; do
    name=$(basename "$dir")
    if [[ "$name" > "$ANCHOR" ]]; then rm -rf "$dir"; fi
  done
  echo "== 1/4 Migraciones hasta el esquema de la semilla ($ANCHOR)"
  "$PRISMA" migrate deploy --schema "$TMP/ancla/schema.prisma" >"$TMP/deploy-base.log" 2>&1 || { cat "$TMP/deploy-base.log"; exit 1; }
else
  echo "== 1/4 Migraciones de la base"
  "$PRISMA" migrate deploy --schema "$BASE_SCHEMA" >"$TMP/deploy-base.log" 2>&1 || { cat "$TMP/deploy-base.log"; exit 1; }
fi

echo "== 2/4 Datos sintéticos"
"${PSQL[@]}" -f "$DATA/seed.sql"

echo "== 3/4 Migraciones posteriores sobre esos datos"
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
  target=$(sed -n '1s/^-- migracion: *//p' "$check")
  if [ -n "$target" ] && [ -n "$ANCHOR" ] && ! [[ "$target" > "$ANCHOR" ]]; then
    echo "omite $name (la migración $target es anterior al esquema de la semilla)"
    continue
  elif [ -n "$target" ] && [ ! -d "$TMP/apps/api/prisma/migrations/$target" ] \
     && [ -d "$API/prisma/migrations/$target" ]; then
    : # migración nueva: se verifica
  elif [ -n "$target" ]; then
    echo "omite $name (la migración $target no es nueva)"
    continue
  fi
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
