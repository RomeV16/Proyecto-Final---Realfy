#!/usr/bin/env bash
# Despliega el Worker de recepción de mails a la cuenta de Cloudflare indicada por el entorno.
#
#   CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=...  DEFAULT_TENANT_SLUG=<slug> \
#     [FALLBACK_FORWARD_TO=<dirección verificada>]  [API_BASE_URL=https://api.realfy.app] \
#     infra/email-worker/scripts/deploy.sh
#
# No guarda ni imprime secretos. El secreto INBOX_EMAIL_INGEST_SECRET se carga aparte con
# `wrangler secret put` (ver README.md). Cada deploy reemplaza las variables: por eso se pasan siempre.
set -euo pipefail

WRANGLER_VERSION="4.149.0"
: "${CLOUDFLARE_API_TOKEN:?falta CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?falta CLOUDFLARE_ACCOUNT_ID}"
: "${DEFAULT_TENANT_SLUG:?falta DEFAULT_TENANT_SLUG (inmobiliaria de las casillas sin +slug)}"

cd "$(dirname "$0")/.."

vars=("DEFAULT_TENANT_SLUG:${DEFAULT_TENANT_SLUG}")
[ -n "${API_BASE_URL:-}" ] && vars+=("API_BASE_URL:${API_BASE_URL}")
[ -n "${FALLBACK_FORWARD_TO:-}" ] && vars+=("FALLBACK_FORWARD_TO:${FALLBACK_FORWARD_TO}")

exec npx --yes "wrangler@${WRANGLER_VERSION}" deploy --var "${vars[@]}" "$@"
