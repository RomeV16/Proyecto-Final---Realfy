# Worker de recepción de mails (Cloudflare Email Routing)

Recibe los mails de `boletas@` y `consultas@` del dominio `realfy.app` y los reenvía a la API, ya
normalizados y firmados. Es el "reenvío mínimo" que pedía `docs/despliegue.md`: la API ya tiene los dos
ingresos (`POST /api/bills-intake/email-ingest` y `POST /api/inbox/email-ingest`); este Worker es lo que
les entrega los mails. Decisión: ADR-0013 (bandeja) y ADR-0018 (boletas).

## Qué hace

| Destinatario (sobre) | Qué manda | Endpoint |
|---|---|---|
| `boletas@` / `boletas+<slug>@` | `BillMailIngestSchema`: `tenantSlug`, `to`, `messageId`, `from`, `subject`, `receivedAt`, `attachments[]` (sólo PDF, en base64) | `${API_BASE_URL}/api/bills-intake/email-ingest` |
| `consultas@` / `consultas+<slug>@` | `EmailIngestSchema`: `tenantSlug`, `messageId`, `from`, `fromName`, `subject`, `text`, `receivedAt`, `automatic` | `${API_BASE_URL}/api/inbox/email-ingest` |
| cualquier otro | `FALLBACK_FORWARD_TO` si está definida; si no, `message.setReject` (error permanente) | no llama a la API |

- La inmobiliaria sale del `+<slug>` de la dirección; sin él, de `DEFAULT_TENANT_SLUG`. Si no hay ninguna de
  las dos el Worker falla (el remitente reintenta mientras se corrige la configuración).
- `automatic` es `true` con `Auto-Submitted` distinto de `no` o `Precedence: bulk` / `auto_reply`, como
  documenta la API. En boletas **no** se descarta por esos encabezados (las facturas automáticas son
  justamente el caso de uso); la API filtra por remitente (`no-reply@`, `mailer-daemon@`...).
- Límites de la API respetados en boletas: hasta 10 PDF, de hasta 10 MiB cada uno y con un total en base64 por
  debajo de 24 MiB (la API acepta cuerpos de 25 MiB). Lo que no entra se salta y queda en el registro
  (`skippedPdfs`); un mail sin PDF aceptable llega con `attachments: []` y la API lo deja en revisión.
- Sin `Message-ID` se usa el hash SHA-256 del mensaje, así el reintento lleva el mismo identificador y la
  API no duplica (la idempotencia de ambos ingresos es por `messageId`).

## Firma

Exactamente la que verifica la API (`assertEmailIngestSignature` -> `verifyMetaSignature`):

```
X-Realfy-Signature: sha256=<HMAC-SHA256 en hex minúscula del cuerpo JSON, clave INBOX_EMAIL_INGEST_SECRET>
Content-Type: application/json
```

Se calcula con Web Crypto sobre los mismos bytes UTF-8 que se envían. **La API no usa encabezado de tiempo
ni ventana anti-reenvío en estos dos ingresos** (eso es de la firma svix del webhook de Resend); la defensa
contra reenvíos es la idempotencia por `messageId`. Las pruebas verifican la firma con la función real de
la API (`apps/api/src/modules/messaging/webhook-signatures.ts`) y los cuerpos con los esquemas de
`@realfy/shared`.

## Respuestas de la API

| Respuesta | Qué hace el Worker |
|---|---|
| 2xx | Registra `delivered` (y `ignored` si la API lo informa) y termina. |
| 5xx, error de red, timeout (20 s) | `throw`: Cloudflare no da el mail por entregado. |
| 401, 403, 408, 425, 429 | También `throw`: son secreto mal cargado o momento, no un defecto del mail; rechazar perdería boletas. |
| 404 | Registra y rechaza (`Unknown recipient`): inmobiliaria desconocida. |
| otro 4xx | Registra y no reintenta: `FALLBACK_FORWARD_TO` si existe; si no, `setReject`. |

Qué hace Cloudflare con un `throw` no está detallado en su documentación oficial (la página de Email Workers
no lo dice); la intención es la falla temporal SMTP para que el servidor emisor reintente. Verificarlo con un
mail de prueba al desplegar (ver "Probar").

Los registros (`wrangler tail`) son JSON sin direcciones ni texto del mail: tipo, estado HTTP, cantidad de PDF.

## Por qué un paquete del workspace

`infra/email-worker` está en `pnpm-workspace.yaml` (`infra/*`) como `@realfy/email-worker`: así comparte el
`pnpm-lock.yaml`, las versiones de vitest/eslint/typescript y, sobre todo, puede importar `@realfy/shared`
(esquemas) y la verificación de la API para las pruebas de contrato; `pnpm -r lint` y `pnpm -r typecheck`
del CI lo incluyen sin tocar el workflow. `wrangler` **no** es dependencia: pesa mucho (`workerd`) y sólo
hace falta al desplegar, así que se usa pinneado con `npx` (`scripts/deploy.sh`).

## Desarrollo

```bash
pnpm --filter @realfy/shared build            # los esquemas que usan las pruebas
pnpm --filter @realfy/email-worker test       # vitest (mails MIME sintéticos)
pnpm --filter @realfy/email-worker lint
pnpm --filter @realfy/email-worker typecheck
```

`postal-mime` está en la versión exacta `4.0.11` (publicada el 18/10/2026).

## Despliegue

El token de la API necesita, sobre la cuenta, **Workers Scripts: Edit**; sobre la zona `realfy.app`,
**Zone: Read**, **Zone Settings: Edit** y **Email Routing Rules: Edit**. La cuenta va por variable de
entorno, no en el repo (https://developers.cloudflare.com/workers/wrangler/system-environment-variables/).

```bash
export CLOUDFLARE_API_TOKEN=...            # no se escribe en ningún archivo del repo
export CLOUDFLARE_ACCOUNT_ID=...

# 1. Compilar sin subir (comprobación local)
(cd infra/email-worker && npx wrangler@4.149.0 deploy --dry-run --outdir /tmp/email-worker-build)

# 2. Desplegar (reemplaza las variables: DEFAULT_TENANT_SLUG es obligatoria en el script)
DEFAULT_TENANT_SLUG=<slug-de-la-inmobiliaria> infra/email-worker/scripts/deploy.sh
#    opcional: FALLBACK_FORWARD_TO=<dirección verificada>, API_BASE_URL=<otra API>

# 3. Cargar el secreto (el mismo valor de INBOX_EMAIL_INGEST_SECRET del servicio `api`)
printf '%s' "$INBOX_EMAIL_INGEST_SECRET" | npx wrangler@4.149.0 secret put INBOX_EMAIL_INGEST_SECRET \
  --config infra/email-worker/wrangler.toml
```

Referencia de `deploy` (`--var`, `--dry-run`) y `secret put` (entrada por stdin):
https://developers.cloudflare.com/workers/wrangler/commands/workers/. Hacer el deploy **antes** que el
secreto y las reglas: sin reglas apuntando al Worker no recibe nada. Rotar el secreto = repetir el paso 3 y
cambiarlo en la API a la vez (los dos ingresos lo comparten).

## Email Routing de `realfy.app` por API

Referencias: reglas y subdireccionamiento en
https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/ ; reglas de la API en
https://developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/create ;
habilitar en https://developers.cloudflare.com/api/resources/email_routing/subresources/dns/methods/create ;
ajustes (subaddressing) en https://developers.cloudflare.com/api/resources/email_routing/methods/edit .

```bash
API=https://api.cloudflare.com/client/v4
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
ZONE_ID=$(curl -s -H "$AUTH" "$API/zones?name=realfy.app" | jq -r '.result[0].id')

# 1. Habilitar Email Routing en la zona (agrega y bloquea los MX y el SPF de Cloudflare)
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"realfy.app"}' "$API/zones/$ZONE_ID/email/routing/dns"

# 2. Subaddressing: que boletas+slug@ llegue a la regla de boletas@ (el +slug queda en message.to)
curl -s -X PATCH -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"support_subaddress":true}' "$API/zones/$ZONE_ID/email/routing"

# 3. Reglas: cada casilla va al Worker
for local in boletas consultas; do
  curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$local a realfy-email-worker\",\"enabled\":true,
         \"matchers\":[{\"type\":\"literal\",\"field\":\"to\",\"value\":\"$local@realfy.app\"}],
         \"actions\":[{\"type\":\"worker\",\"value\":[\"realfy-email-worker\"]}]}" \
    "$API/zones/$ZONE_ID/email/routing/rules"
done

# 4. (opcional) catch-all: todo lo demás también al Worker, que lo rechaza o lo reenvía a FALLBACK_FORWARD_TO
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"catch-all","enabled":true,"matchers":[{"type":"all"}],
       "actions":[{"type":"worker","value":["realfy-email-worker"]}]}' \
  "$API/zones/$ZONE_ID/email/routing/rules/catch_all"

# 5. Comprobar
curl -s -H "$AUTH" "$API/zones/$ZONE_ID/email/routing"          | jq '.result | {enabled,status,support_subaddress}'
curl -s -H "$AUTH" "$API/zones/$ZONE_ID/email/routing/rules"    | jq '.result[] | {name,enabled,matchers,actions}'
```

Notas:
- El subaddressing se activa en el dashboard en Email Routing -> Settings; por API es `support_subaddress` en
  `PATCH /zones/{zone_id}/email/routing`. Con el ajuste activo, `user+detalle@dominio` cae en la regla de
  `user@dominio`, y una regla para la dirección completa tiene prioridad (por ejemplo, para mandar
  `boletas+otra@` a otro destino).
- La referencia de la API no detalla el `value` de la acción `worker`: es el nombre del script
  (`realfy-email-worker`). Confirmar en el paso 5 (y en el dashboard) que la regla muestra el Worker.
- Con el catch-all al Worker, `FALLBACK_FORWARD_TO` tiene que ser una dirección de destino verificada en
  Email Routing (Destination addresses); sin ella, lo desconocido se rechaza.
- Antes del paso 1, revisar el DNS de la zona: Email Routing agrega MX y SPF en la raíz, y el SPF de Resend va
  en el subdominio de rebote (`docs/despliegue.md`, "Dominio de correo"); un SPF o MX previos en la raíz hay
  que fusionarlos, no duplicarlos.

## Probar

1. Mandar un mail con un PDF a `boletas+<slug>@realfy.app` y otro a `consultas+<slug>@realfy.app`.
2. `npx wrangler@4.149.0 tail realfy-email-worker --format json`: tiene que verse `received` y `delivered`.
3. En la API: la boleta en la pantalla de boletas recibidas (canal Mail) y la consulta en la bandeja.
4. Con la API apagada o `INBOX_EMAIL_INGEST_SECRET` distinto: el registro muestra `api-error-retry` y el
   remitente no recibe un rechazo definitivo.
