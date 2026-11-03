# Guía de despliegue

Realfy se despliega como dos servicios independientes —la API y la aplicación
web— apoyados en una base PostgreSQL administrada y en un almacenamiento de
objetos compatible con S3. El ambiente de referencia es Railway, y todo lo que
sigue está escrito para ese proveedor, pero nada del diseño lo ata: los dos
servicios se construyen con un `Dockerfile` propio en la raíz del repositorio y
corren en cualquier plataforma que sepa levantar una imagen.

Este documento reemplaza a los dos archivos de despliegue anteriores, que se
contradecían entre sí en el punto de salud de la API, en la lista de variables y
en el nombre del repositorio.

## Panorama

| Componente | Qué es | Cómo se construye |
|---|---|---|
| `api` | Backend NestJS. Expone todo bajo el prefijo `/api`. | `Dockerfile.api`, configurado por `apps/api/railway.json` |
| `web` | Frontend Next.js con salida `standalone`. | `Dockerfile.web`, configurado por `apps/web/railway.json` |
| PostgreSQL | Base única para todas las inmobiliarias. | Servicio administrado del proveedor |
| Almacenamiento S3 | Fotos de propiedades y adjuntos. | Servicio externo compatible con S3 |

Los dos servicios apuntan al mismo repositorio y a la misma rama; lo que los
distingue es el archivo de configuración que cada uno tiene asignado. En Railway
eso se define en los ajustes del servicio, indicando la raíz del repositorio como
directorio de trabajo y `apps/api/railway.json` o `apps/web/railway.json` como
archivo de configuración.

## Ambientes

El proyecto de Railway tiene dos ambientes (`environment`), con los mismos
servicios y configuración pero sin nada en común en datos ni en secretos:

| Ambiente | Para qué | Datos |
|---|---|---|
| `production` | Demostración de la defensa | Solo sintéticos |
| `piloto` | Uso real en la inmobiliaria piloto | Reales; base, almacenamiento, API y web aislados |

El ambiente `piloto` tiene sus propios secretos: contraseña de la base,
contraseña del almacenamiento, `JWT_SECRET` y `ARCA_MASTER_KEY`. Ninguno se
comparte con `production`. Las URL del ambiente piloto se guardan en la
configuración privada del equipo y no figuran en este repositorio.

Las variables de este proyecto son valores literales, no referencias entre
servicios. Por eso, cuando un ambiente se duplica, toda variable que apunte al
dominio de otro ambiente (`CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`,
`API_PROXY_TARGET`, `S3_ENDPOINT`) sigue apuntando al ambiente de origen hasta
que se la sobrescribe a mano. Es el error más fácil de cometer al crear un
ambiente: el piloto parecería andar, pero hablaría con la API o el
almacenamiento de la demostración. Después de duplicar hay que revisar una por
una las variables de cada servicio.

## Requisitos previos

Una cuenta en el proveedor, el repositorio conectado por GitHub, y una base
PostgreSQL 16. Nada más: la API no necesita ningún servicio de cola ni de caché.

## Base de datos y migraciones

La base se provisiona como servicio administrado y expone su cadena de conexión,
que se referencia desde el servicio `api` en la variable `DATABASE_URL`.

Las migraciones no se aplican a mano. El comando de arranque del servicio `api`
es, tal como está en `apps/api/railway.json`:

```
pnpm --filter @realfy/api exec prisma migrate deploy && node apps/api/dist/main.js
```

Es decir, cada despliegue aplica las migraciones pendientes antes de levantar el
servidor. El `Dockerfile.api` tiene su propia versión equivalente del mismo
comando, que es la que corre si la imagen se levanta por fuera del proveedor.

Hay una consecuencia operativa que conviene tener presente: si una migración
falla, Prisma la registra como fallida y se niega a aplicar cualquier migración
posterior, con lo cual el despliegue queda trabado hasta que se resuelva a mano
contra la base. Por eso la integración continua aplica todas las migraciones
sobre una base vacía en cada cambio (ver `docs/pruebas.md`): es la verificación
que evita llegar a producción con una migración inválida.

Para volver a foja cero durante la etapa de demostración, lo más simple es borrar
y recrear el servicio de base de datos, o correr `prisma migrate reset` contra
`DATABASE_URL`. Esto vale solo para `production`: en `piloto` está prohibido
(ver «Reglas para el ambiente piloto»).

## Servicio de API

El servidor escucha en el puerto que indica `PORT`, y usa 3001 si no está
definido. Todas las rutas cuelgan del prefijo `/api`, así que el punto de salud
está en `/api/health` —no en `/health`—, que es exactamente lo que declara
`healthcheckPath` en la configuración del servicio. Ese endpoint responde
`{"status":"ok","db":"connected",...}` cuando la base está accesible, y
`"degraded"` cuando no lo está, sin caerse.

La API confía en el proxy de la plataforma (`trust proxy`) para leer la IP real
del visitante; sin eso el límite de peticiones se aplicaría en conjunto a todo el
tráfico que entra por el frontend. El límite general es de 600 peticiones por
minuto, y los endpoints que reciben credenciales tienen el suyo, mucho más
estricto: 5 por minuto.

### Variables del servicio `api`

Las que hay que definir sí o sí en producción:

| Variable | Para qué | Si falta |
|---|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL. | La API no arranca. |
| `JWT_SECRET` | Firma de los tokens de acceso, tanto del personal como del portal. | En producción la API no arranca. Fuera de producción se usa una clave de desarrollo y se avisa en el registro. |
| `CORS_ORIGINS` | Lista de orígenes permitidos, separados por comas. | Se permite solo `http://localhost:3000`, con lo cual el frontend desplegado queda bloqueado. |
| `WEB_BASE_URL` | URL pública de la web, usada para armar los enlaces de invitación y de recupero de contraseña que ve el Admin. | Se usa el primer origen de `CORS_ORIGINS`; si tampoco está, `http://localhost:3000`. |
| `NODE_ENV` | Debe ser `production`. | Se habilitan comportamientos de desarrollo. |

Las opcionales, con su valor por defecto:

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3001` | Puerto de escucha. La plataforma normalmente lo inyecta. |
| `JWT_ACCESS_EXPIRY` | `15m` | Vida del token de acceso. |
| `JWT_REFRESH_DAYS` | `7` | Vida del token de refresco. |
| `COOKIE_DOMAIN` | vacío | Dominio de las cookies de sesión. Se usa cuando la API y la web comparten dominio padre. |
| `RATE_LIMIT_DISABLED` | vacío | En `1` apaga el límite de peticiones. **Se ignora cuando `NODE_ENV=production`**, a propósito, para que un entorno mal cargado no deje la API sin límite. |

Las que habilitan funcionalidad que, sin ellas, queda apagada en silencio:

| Variable | Por defecto | Efecto de no definirla |
|---|---|---|
| `S3_ENDPOINT` | — | Sin un endpoint válido, la carga de fotos falla. |
| `S3_REGION` | `us-east-1` | — |
| `S3_ACCESS_KEY` | vacío | Cualquier proveedor real rechaza credenciales vacías. |
| `S3_SECRET_KEY` | vacío | Ídem. |
| `S3_BUCKET` | `realfy-media` | — |
| `RESEND_API_KEY` | — | No se envía ningún correo: los mensajes por mail quedan pendientes en la bandeja de salida con el motivo «falta configurar el proveedor» y la gerencia recibe un aviso por día. |
| `RESEND_FROM` | `noreply@realfy.com.ar` | Remitente de los correos; tiene que ser del dominio verificado en Resend. Se acepta también el nombre anterior, `RESEND_FROM_ADDRESS`. |
| `RESEND_WEBHOOK_SECRET` | — | Secreto `whsec_…` del webhook de Resend. Sin él, `POST /api/webhooks/resend` rechaza todo y no se registran entregas, rebotes ni quejas. |
| `WHATSAPP_TOKEN` | — | Token de acceso permanente de un usuario del sistema de la cuenta de WhatsApp Business. Sin él (o sin el número), los mensajes por WhatsApp quedan pendientes con el motivo del proveedor. |
| `WHATSAPP_PHONE_NUMBER_ID` | — | Identificador del número de WhatsApp de la API (no es el número de teléfono). También se usa para descartar avisos de otro número. |
| `WHATSAPP_APP_SECRET` | — | Secreto de la app de Meta, con el que se verifica `X-Hub-Signature-256`. Sin él, `POST /api/webhooks/whatsapp` rechaza todo. |
| `WHATSAPP_VERIFY_TOKEN` | — | Texto que se elige al suscribir el webhook en Meta; la verificación `GET /api/webhooks/whatsapp` lo compara. |
| `WHATSAPP_GRAPH_VERSION` | `v21.0` | Versión de la Graph API. |
| `WHATSAPP_TENANT_SLUG` | — | Slug de la inmobiliaria dueña del número de WhatsApp del ambiente. Un WhatsApp de un número al que nunca se le escribió entra como consulta nueva de esa inmobiliaria; sin la variable, de la única inmobiliaria activa. |
| `INBOX_EMAIL_INGEST_SECRET` | — | Secreto con que se firma el mail reenviado a `POST /api/inbox/email-ingest` (`X-Realfy-Signature`). Sin él, la ruta rechaza todo. |
| `ARCA_MASTER_KEY` | — | Clave de 32 bytes en base64 que protege los certificados fiscales. Se valida recién cuando se sube o se usa un certificado, así que la API levanta igual: una inmobiliaria que no factura electrónicamente no depende de ella. |
| `ARCA_MOCK` | vacío | En `1` responde las llamadas a los servicios de ARCA desde el simulador del repositorio, en lugar de ir al organismo. Para desarrollo y pruebas. |
| `ARCA_ACCESS_TOKEN` | — | El PDF fiscal se genera con la plantilla local en lugar de la del servicio externo. |
| `AI_BASE_URL` | `https://api.minimax.io/v1` | Endpoint del modelo de lenguaje. |
| `AI_MODEL` | `MiniMax-M3` | Modelo a usar. |
| `AI_REASONING_EFFORT` | `none` | Esfuerzo de razonamiento pedido al proveedor. Con razonamiento activo, esos tokens salen del mismo presupuesto que la respuesta y la cortan. Vacío omite el campo. |
| `AI_API_KEY` | vacío | Sin credencial la API levanta igual y las funciones que consultan al modelo resuelven por sus propias reglas. |
| `AI_TIMEOUT_MS` | `20000` | Espera máxima por respuesta del modelo. |

### Mensajería: modo de envío por ambiente

Todo mail o WhatsApp a una persona pasa por la bandeja de salida (ADR-0013). Si
un mensaje sale o no lo decide el ambiente, no una pantalla:

| Variable | Por defecto | Para qué |
|---|---|---|
| `MESSAGING_MODE` | `off` | `off`: los mensajes se encolan y se ven en Mensajería, pero no sale ninguno. `allowlist`: solo salen a las direcciones de `MESSAGING_ALLOWLIST`; los demás quedan bloqueados. `live`: salen a quien corresponda, respetando el consentimiento y el horario. Un valor desconocido cuenta como `off`. |
| `MESSAGING_ALLOWLIST` | vacío | Mails y teléfonos permitidos en modo `allowlist`, separados por coma o punto y coma. Los teléfonos se escriben con código de país (`+54 9 351 …`) o como celular argentino de 10 dígitos. |

- `production` (demo con datos sintéticos) puede estar en `allowlist` con las
  direcciones del equipo, o en `live` si los destinatarios son ficticios.
- **`piloto` queda en `off` o en `allowlist` (solo direcciones del equipo)
  hasta que el dueño de la inmobiliaria apruebe por escrito el envío a su
  cartera.** El paso a `live` se registra como decisión del piloto.
- El modo también se aplica a los informes programados que se mandan por mail.
  El recupero de contraseña, que pide la misma persona, sale igual.
- Sin credenciales del proveedor los mensajes quedan pendientes con el motivo a
  la vista, aunque el modo sea `live`.

### Dominio de correo (Resend): SPF y DKIM

Resend solo manda desde un dominio verificado. Una vez por dominio:

1. En Resend, **Domains → Add domain**, con el dominio de la inmobiliaria o un
   subdominio dedicado al envío (por ejemplo, `avisos.<dominio>`), en la región
   más cercana.
2. Copiar en el DNS del dominio los registros que muestra Resend: el **TXT de
   SPF** (`v=spf1 include:amazonses.com ~all` en el subdominio de rebote que
   indica), el **TXT de DKIM** (`resend._domainkey…`, la clave pública) y el
   **MX** del subdominio de rebote. Si el dominio ya tiene un SPF, se suma el
   `include` al registro existente en lugar de crear otro.
3. Agregar un **DMARC** (`_dmarc`, TXT `v=DMARC1; p=none; rua=mailto:…`) para
   empezar a recibir informes; endurecerlo a `quarantine` cuando los envíos
   estén estables.
4. Esperar a que Resend marque el dominio como verificado y crear una **API
   key** con permiso solo de envío. Cargarla en `RESEND_API_KEY` y el remitente
   en `RESEND_FROM`.
5. En **Webhooks**, apuntar a `https://<api>/api/webhooks/resend` con los
   eventos `email.sent`, `email.delivered`, `email.bounced`,
   `email.complained` y `email.failed`, y cargar el secreto en
   `RESEND_WEBHOOK_SECRET`.
6. Probar con `MESSAGING_MODE=allowlist` y una dirección del equipo: el
   mensaje tiene que pasar a «Entregado» en Mensajería.

### WhatsApp Business Cloud API

Con un **número nuevo**, que no se use en la aplicación de WhatsApp:

1. Crear la cuenta de Meta Business de la inmobiliaria y completar la
   verificación de la empresa.
2. En Meta for Developers, crear una app de tipo *Business* con el producto
   WhatsApp y registrar el número nuevo. Anotar el **Phone number ID**
   (`WHATSAPP_PHONE_NUMBER_ID`).
3. Crear un usuario del sistema con permiso sobre la cuenta de WhatsApp y
   generar un **token permanente** (`WHATSAPP_TOKEN`). El **secreto de la app**
   (configuración básica) va en `WHATSAPP_APP_SECRET`.
4. Dar de alta las plantillas de **utilidad** en `es_AR` con los nombres y
   textos de ADR-0013 (`recibo_de_cobro` y `estado_de_cuenta` con encabezado de
   documento; `incidencia_estado` e `incidencia_respuesta`; y las tres de la
   cobranza, `recordatorio_de_pago_n1`, `_n2` y `_n3`) y esperar la aprobación.
   Sin las de la cobranza aprobadas no se prende la cobranza por WhatsApp.
5. Suscribir el webhook a `https://<api>/api/webhooks/whatsapp` con el campo
   `messages` y el token de verificación elegido (`WHATSAPP_VERIFY_TOKEN`).
6. Registrar el alta de WhatsApp en la ficha de una persona del equipo, ponerla
   en `MESSAGING_ALLOWLIST` y probar con `MESSAGING_MODE=allowlist`.

El sistema no usa Redis ni ninguna cola de trabajos externa (la bandeja de
salida es una tabla de la base que despacha un proceso programado de la API),
así que no hace falta provisionarlo ni definir `REDIS_URL`. Un secreto propio para los tokens de
refresco tampoco hace falta: esos tokens no son JWT sino identificadores
aleatorios opacos guardados en la base, de modo que no hay nada que firmar.

### Bandeja de consultas: mails entrantes (pendiente de configurar)

Los WhatsApp entrantes llegan por el webhook ya suscripto. Los **mails** requieren un
paso externo que queda pendiente hasta tener el dominio y la casilla:

1. Elegir la casilla de consultas (por ejemplo `consultas@<dominio>`) y apuntar su
   MX a un servicio de recepción: Resend permite recibir mails (evento
   `email.received`) o se puede usar el reenvío de la casilla del proveedor de correo.
2. Armar un reenvío mínimo (una función o un script) que, por cada mail, lea el
   `Message-ID`, el remitente, el asunto y el texto, y llame a
   `POST https://<api>/api/inbox/email-ingest` con el cuerpo JSON
   `{ tenantSlug, messageId, from, fromName, subject, text, receivedAt, automatic }`
   y el encabezado `X-Realfy-Signature: sha256=<HMAC-SHA256 del cuerpo con el secreto>`.
   `automatic` va en `true` si el mail trae `Auto-Submitted` distinto de `no` o
   `Precedence: bulk/auto_reply`.
3. Definir `INBOX_EMAIL_INGEST_SECRET` en el servicio `api` y el remitente `RESEND_FROM`
   con esa misma casilla, para que las respuestas de los clientes vuelvan a ella.
4. Probar con `MESSAGING_MODE=allowlist`: las autorrespuestas solo salen a las
   direcciones de la lista.

Sin este paso la bandeja funciona igual con WhatsApp, el micrositio y las llamadas.

## Servicio web

La aplicación se compila con la salida `standalone` de Next.js y arranca con
`node apps/web/server.js`. Escucha en el puerto 3000, fijado en el `Dockerfile`
junto con `HOSTNAME=0.0.0.0`.

### El frontend hornea la dirección de la API en tiempo de compilación

Este es el punto que más problemas causa y conviene entenderlo antes de
desplegar. `NEXT_PUBLIC_API_URL` es una variable con prefijo `NEXT_PUBLIC_`, y
Next.js reemplaza esas variables por su valor literal dentro del código que se
envía al navegador durante `next build`. No se lee en tiempo de ejecución: queda
grabada en el paquete que descarga el cliente.

De ahí se siguen dos cosas. La primera es que `Dockerfile.web` la recibe como
argumento de construcción, no como variable del contenedor, y hay que pasarla al
construir la imagen. La segunda, y la que sorprende, es que **cambiar la variable
y reiniciar el servicio no tiene ningún efecto**: hace falta reconstruir. Si el
frontend desplegado intenta hablar con `localhost:3001`, es porque se construyó
sin esa variable y tomó el valor por defecto.

`API_PROXY_TARGET` es distinta. No lleva el prefijo, y se usa en el lado del
servidor: en las reescrituras de `next.config.ts`, que redirigen `/api/*` al
backend, y en las páginas del micrositio público, que consultan la API desde el
servidor. Sirve para que el frontend hable con la API por la red privada de la
plataforma, evitando el problema de CORS y de cookies entre dominios.

### Variables del servicio `web`

| Variable | Cuándo se aplica | Valor |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | **Construcción** | URL pública de la API, terminada en `/api`. Por defecto `http://localhost:3001/api`. |
| `API_PROXY_TARGET` | Construcción y ejecución | URL del servicio de la API, sin el `/api` final. Por defecto `http://localhost:3001`. En producción conviene la dirección interna. |
| `NODE_ENV` | Ejecución | `production`. Ya viene fijado en el `Dockerfile`. |
| `PORT` | Ejecución | `3000`. Ya viene fijado en el `Dockerfile`. |

El servicio web no declara punto de salud, así que la plataforma se limita a
verificar que el puerto responda.

### Dominio propio del micrositio

El micrositio de cada inmobiliaria se sirve siempre por `/es/p/<slug>`. Para
que además responda en un dominio propio (por ejemplo
`www.inmobiliariademo.com.ar`), el servicio `web` resuelve la inmobiliaria por el
host del pedido. Hay dos maneras, que se pueden combinar:

| Variable | Cuándo se aplica | Valor |
|---|---|---|
| `MICROSITE_HOST_MAP` | Ejecución | JSON `{"www.inmobiliariademo.com.ar": "inmobiliaria-demo"}`: dominio → `slug` de la inmobiliaria. Se acepta con o sin `www.`. Un JSON roto o un slug inválido se ignoran. |
| `MICROSITE_BASE_DOMAIN` | Ejecución | Por ejemplo `sitios.realfy.app`: `<slug>.sitios.realfy.app` resuelve a ese slug (un solo nivel). |

Sin ninguna de las dos el sitio sigue entrando por la ruta con el `slug`. En el
dominio propio las direcciones quedan sin idioma ni `/p/<slug>` (`/` y
`/propiedades/<id>`), el panel y el ingreso no se alcanzan (dan 404) y el
`robots.txt` y el `sitemap.xml` salen con ese dominio. En el dominio de la
aplicación el `robots.txt` solo deja indexar las páginas públicas.

Pasos para dar de alta un dominio propio:

1. **Comprar o elegir el dominio** (cuenta externa de la inmobiliaria; no lo hace
   el equipo de desarrollo).
2. **Agregarlo al servicio `web`** de Railway como dominio personalizado.
   Railway indica el destino al que debe apuntar y emite el certificado TLS solo.
3. **DNS** en el proveedor del dominio: un `CNAME` de `www` al destino que indicó
   Railway. Un dominio sin `www` (apex) requiere un registro `ALIAS`/`ANAME` o la
   redirección del apex a `www` que ofrezca el proveedor. No se tocan los
   registros de correo (MX, SPF, DKIM) si el dominio ya los tiene.
4. **Cargar `MICROSITE_HOST_MAP`** en el servicio `web` con el dominio y el `slug`
   (la inmobiliaria tiene que tener `slug`, que se carga con
   `PATCH /tenants/:id`) y reiniciar el servicio.
5. **Verificar**: `https://<dominio>/` muestra la portada, `/robots.txt` anuncia
   `/sitemap.xml` y una propiedad con el aviso del micrositio en *Publicado*
   aparece en el sitio.

Hasta que la inmobiliaria elija y compre el dominio queda pendiente; no hace
falta para usar el micrositio por la ruta con el `slug`.

## Almacenamiento de imágenes

Las fotos de propiedades y los adjuntos no se guardan en el disco del
contenedor. El archivo llega en memoria, `sharp` produce un original de 1920
píxeles de ancho y una miniatura de 400, y las dos versiones se suben al
almacenamiento de objetos antes de crear el registro en la base —en ese orden, así
un fallo de subida no deja registros huérfanos—. La clave del objeto incluye el
identificador de la inmobiliaria, de modo que los archivos quedan separados por
inmobiliaria dentro del mismo bucket.

El cliente se configura con `forcePathStyle`, que es lo que permite usar MinIO en
desarrollo y cualquier servicio compatible con S3 en producción sin cambiar
código. Al iniciar, el servicio verifica que el bucket exista y lo crea si no
está; si eso falla, registra la advertencia y sigue, para no impedir el arranque.

Las URLs de lectura se firman por pedido y tienen vencimiento, razón por la cual
el frontend no puede usar el optimizador de imágenes de Next.js sobre ellas: el
host no se conoce al momento de compilar.

En producción hay que apuntar las variables `S3_*` a un servicio durable. Si
quedan sin definir, la carga de imágenes falla; es la única parte del sistema que
no degrada de forma silenciosa y elegante.

## Orden de puesta en marcha

Hay una dependencia circular entre los dos servicios: la API necesita el dominio
de la web para su lista de CORS, y la web necesita el dominio de la API para
compilar. Se resuelve en dos vueltas.

1. Provisionar la base de datos.
2. Crear el servicio `api` con su archivo de configuración y sus variables,
   dejando `CORS_ORIGINS` con un valor provisorio. Desplegar y generar su
   dominio público.
3. Crear el servicio `web` con su archivo de configuración, pasando
   `NEXT_PUBLIC_API_URL` con el dominio de la API ya conocido y
   `API_PROXY_TARGET` con su dirección interna. Desplegar y generar su dominio.
4. Volver al servicio `api`, poner el dominio de la web en `CORS_ORIGINS` y
   volver a desplegar.

Si en el paso 3 el dominio de la API todavía no existía, hay que reconstruir la
web —no solo reiniciarla— una vez que exista.

## Verificación

El punto de salud de la API responde sin sesión:

```bash
curl https://<dominio-de-la-api>/api/health
```

Del lado de la web, abrir el dominio raíz debería redirigir a `/es` y llevar a la
pantalla de ingreso. La primera cuenta se crea desde `/es/auth/register`, que da
de alta la inmobiliaria y su primer usuario con rol Admin en una sola operación.
No hay datos precargados: el repositorio no incluye una carga inicial de
ejemplo, así que el contenido del ambiente de demostración se arma desde la
propia aplicación.

Vale aclarar que las contraseñas y las claves de los servicios externos no viven
en el repositorio. Se cargan como variables del servicio en la plataforma y se
generan aleatoriamente; para `JWT_SECRET` y `ARCA_MASTER_KEY` alcanza con
`openssl rand -hex 64` y `openssl rand -base64 32` respectivamente.

## Operación cotidiana

Los despliegues son manuales y por ambiente (ver «Despliegue controlado»): un
empuje a `main` no redespliega nada. Frente a cualquier problema, el primer paso
son los registros del servicio.

Dos operaciones merecen cuidado: dar de baja el servicio de base de datos borra
los datos de forma irreversible, y reiniciar el servicio web reutiliza la imagen
ya construida, con lo cual no toma los cambios de `NEXT_PUBLIC_API_URL`.

## Despliegue controlado

Los despliegues no se disparan por un empuje al repositorio. Se hacen a mano con
la línea de comandos de Railway, para cada servicio y cada ambiente, desde una
copia limpia del commit integrado en `main` y no desde una copia de trabajo:

```bash
rm -rf /tmp/realfy-deploy && mkdir /tmp/realfy-deploy
git archive <commit> | tar -x -C /tmp/realfy-deploy
cd /tmp/realfy-deploy
```

`railway up` sube el directorio en el que se corre, incluidos los archivos que no
están versionados; desde la copia limpia sube exactamente lo que está en el commit,
y nada más. Desde ese directorio:

```bash
railway up --service api --environment <ambiente> --detach
railway up --service web --environment <ambiente> --detach
```

Reglas:

- Solo se despliega desde `main`, y con la integración continua en verde.
- Primero `production`. Se verifica allí (punto de salud, ingreso y una
  pantalla) y recién después se despliega a `piloto`, con la misma verificación.
- Antes de cada despliegue a `piloto` se toma una copia lógica de la base, haya o
  no migraciones (ver «Copias de seguridad y restauración»).
- Si el despliegue trae migraciones, se ensayan antes sobre una restauración local
  de esa copia: se aplican con `prisma migrate deploy` y se comparan conteos antes y
  después. Las que reescriben o rellenan datos (backfill) además se revisan fila por
  fila en lo que tocan. Solo con el ensayo limpio se despliega.
- Después del despliegue se verifica la salud, el ingreso y que las migraciones
  aplicadas coincidan con las del commit; si hubo migraciones, se toma una segunda
  copia como punto de partida del estado nuevo.

El paso a paso está en `operacion-piloto.md`.

## Almacenamiento (MinIO)

La imagen `minio/minio` fue retirada de Docker Hub. Los dos ambientes corren
ahora `bitnamilegacy/minio:2025.7.23-debian-12-r5`, con la variable
`RAILWAY_RUN_UID=0` y el volumen montado en `/bitnami/minio/data`. La versión
está fijada a propósito: una etiqueta móvil volvería a exponer el servicio a que
otra imagen de terceros desaparezca o cambie sin aviso. El almacenamiento de
`production` se cambió a esta imagen el 2026-10-31.

Hay una trampa al cambiar la imagen. Un «redeploy» de un despliegue existente
reutiliza la imagen de **ese** despliegue, así que el servicio sigue corriendo la
imagen vieja aunque la configuración ya apunte a la nueva. Después de cambiar la
imagen hay que desplegar la configuración vigente del servicio: en el panel,
con «Deploy», o con `serviceInstanceDeployV2` en la API. «Redeploy» no sirve.

## Copias de seguridad y restauración

Hay dos capas, porque cada una cubre un fallo distinto.

**Copias nativas de Railway.** Están activadas en el volumen de `db` y en el de
`storage` del ambiente `piloto`, con frecuencia diaria y semanal. Activarlas
reinició la base una vez. Cubren el borrado o la corrupción del volumen con una
granularidad de un día.

**Copia lógica fuera del proveedor.** Una vez por semana, los lunes a las 06:30
UTC, una tarea programada corre `pg_dump -Fc` a través de `railway ssh` y el
archivo se guarda en el servidor del equipo con permisos 600. Cada copia se
verifica con `pg_restore -l` y se le calcula un `sha256`. Se conservan las
últimas 12 copias semanales. Además, se toma una copia con el mismo procedimiento
antes de cada despliegue a `piloto` y antes de cada carga de datos. Cubre la
pérdida de la cuenta o del proyecto en el proveedor, y es la que se restaura para
ensayar las migraciones.

Objetivos declarados:

| Objetivo | Valor |
|---|---|
| RPO con la copia nativa diaria | 24 horas |
| RPO con la copia externa | 7 días como máximo; cero respecto del estado previo a cada despliegue, porque se copia justo antes |
| RTO de la base (restauración de la copia) | Medido el 2026-11-02: unos 3 segundos en local para la copia completa de la base del piloto con sus datos reales, de alrededor de 1 MB |
| RTO total del servicio | Meta de 2 horas o menos; sin medir de punta a punta |

El RTO medido es el de restaurar la copia sobre una base vacía y verificarla; no
incluye crear la base nueva en el proveedor, apuntar la API a ella y volver a
desplegar, que son pasos manuales y dominan el tiempo total. Con el volumen de una
inmobiliaria del tamaño del piloto la restauración en sí es prácticamente
instantánea, así que la meta de 2 horas depende del procedimiento y no del tamaño
de los datos. Se vuelve a medir antes de cada cierre de ciclo.

**Restauración**, de forma genérica:

1. Crear una base PostgreSQL vacía (local para ensayar; nueva en el proveedor
   para recuperar).
2. Restaurar con `pg_restore --no-owner --no-privileges` sobre esa base.
3. Verificar: conteo de filas de las tablas principales y migraciones aplicadas
   iguales a las de la copia.
4. Solo si se está recuperando: apuntar `DATABASE_URL` del servicio `api` a la
   base restaurada y desplegar la configuración.

La primera prueba de restauración se hizo el 2026-10-31, sobre un PostgreSQL
local, cuando la base del piloto todavía no tenía datos de negocio: demostró el
procedimiento y no el volumen ni el tiempo. La segunda se hizo el 2026-11-02, con
la copia tomada después de cargar la cartera real: la restauración completa tardó
unos 3 segundos, y los conteos de personas y contratos de la base restaurada
coincidieron con los de la carga. Se repite antes de cada cierre
de ciclo.

## Reglas para el ambiente piloto

`piloto` tiene datos reales de personas y de una cartera en uso. Todo lo que en
`production` se puede rehacer, ahí no.

- Nunca `prisma migrate reset` en `piloto`, ni borrar y recrear su base: con datos
  reales no hay foja cero.
- Nunca correr scripts de prueba ni cargas iniciales (seeds) contra `piloto`.
- Nunca borrar el servicio `db` de `piloto`.
- Antes de cada despliegue: copia de la base. Si hay migraciones, ensayo local
  sobre su restauración.
- Solo se despliega un commit integrado en `main`, desde su copia limpia, y después
  de verificarlo en `production`.
- El correo (`RESEND_API_KEY` y `RESEND_FROM`) es necesario en `piloto` para
  invitaciones, recuperos y envío de documentos, y se configura junto con el dominio
  propio, que está pendiente. Mientras falte, el Admin comparte los enlaces a mano,
  los documentos se descargan en PDF y el sistema no marca como enviado lo que no se
  envió.
- `MESSAGING_MODE` queda en `off` (o `allowlist` con direcciones del equipo) hasta
  que el dueño de la inmobiliaria apruebe el envío a su cartera. Pasar a `live` sin
  esa aprobación está prohibido, aunque el proveedor esté configurado.
- Ningún dato, dominio, contraseña ni identificador de recursos del ambiente
  piloto se escribe en el repositorio.

## Entorno local

`docker-compose.yml` levanta solamente la infraestructura —PostgreSQL y MinIO—;
las dos aplicaciones se corren desde el monorepo.

```bash
docker compose up -d postgres minio
cp apps/api/.env.example apps/api/.env
cd apps/api && npx prisma migrate deploy && cd ../..
pnpm dev
```

Al copiar el archivo de ejemplo hay que tener en cuenta dos cosas. Las
variables `S3_*`, `RESEND_*` y `WHATSAPP_*` vienen vacías y se completan a mano
(la mensajería arranca en `MESSAGING_MODE=off`: no sale nada); para MinIO,
`S3_ENDPOINT=http://localhost:9000` con las credenciales que declara
`docker-compose.yml`. Y su valor de `CORS_ORIGINS` apunta al puerto de la propia
API en lugar del de la web: en desarrollo el frontend corre en el 3000 y la API
en el 3001, así que `CORS_ORIGINS=http://localhost:3000` es lo correcto —que es,
de hecho, el valor que la API usa por defecto cuando la variable no está
definida—.

Para trabajar sobre facturación electrónica sin tocar los servicios del organismo,
`ARCA_MOCK=1` responde desde el simulador incluido en el repositorio.
