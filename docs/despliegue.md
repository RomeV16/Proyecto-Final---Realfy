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
`DATABASE_URL`.

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
| `JWT_SECRET` | Firma de los tokens de acceso, tanto del personal como del portal. | Se usa un valor de desarrollo por defecto. **Definirla siempre.** |
| `CORS_ORIGINS` | Lista de orígenes permitidos, separados por comas. | Se permite solo `http://localhost:3000`, con lo cual el frontend desplegado queda bloqueado. |
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
| `RESEND_API_KEY` | — | No se envía ningún correo. Los servicios lo registran como advertencia y siguen andando. |
| `RESEND_FROM_ADDRESS` | remitente por defecto según el tipo de correo | Los correos salen con el remitente por defecto. |
| `ARCA_MASTER_KEY` | — | Clave de 32 bytes en base64 que protege los certificados fiscales. Se valida recién cuando se sube o se usa un certificado, así que la API levanta igual: una inmobiliaria que no factura electrónicamente no depende de ella. |
| `ARCA_MOCK` | vacío | En `1` responde las llamadas a los servicios de ARCA desde el simulador del repositorio, en lugar de ir al organismo. Para desarrollo y pruebas. |
| `ARCA_ACCESS_TOKEN` | — | El PDF fiscal se genera con la plantilla local en lugar de la del servicio externo. |
| `AI_BASE_URL` | `https://api.minimax.io/v1` | Endpoint del modelo de lenguaje. |
| `AI_MODEL` | `MiniMax-M2` | Modelo a usar. |
| `AI_API_KEY` | vacío | Sin credencial la API levanta igual y las funciones que consultan al modelo resuelven por sus propias reglas. |
| `AI_TIMEOUT_MS` | `20000` | Espera máxima por respuesta del modelo. |

Dos variables aparecen en `apps/api/.env.example` y hoy **no las lee ningún
código**: `REDIS_URL` y `JWT_REFRESH_SECRET`. La primera es un resabio de una
etapa en la que se preveía una cola de trabajos; no hay ningún módulo que use
Redis, así que provisionarlo no aporta nada. La segunda tampoco hace falta: los
tokens de refresco no son JWT sino identificadores aleatorios opacos guardados en
la base, de modo que no hay nada que firmar. Ninguna de las dos debería sumarse a
la configuración del servicio.

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

Un empuje a `main` redespliega los dos servicios, si la integración con GitHub
está activa. Frente a cualquier problema, el primer paso son los registros del
servicio.

Dos operaciones merecen cuidado: dar de baja el servicio de base de datos borra
los datos de forma irreversible, y reiniciar el servicio web reutiliza la imagen
ya construida, con lo cual no toma los cambios de `NEXT_PUBLIC_API_URL`.

## Entorno local

`docker-compose.yml` levanta solamente la infraestructura —PostgreSQL, MinIO y un
Redis que hoy no se usa—; las dos aplicaciones se corren desde el monorepo.

```bash
docker compose up -d postgres minio
cp apps/api/.env.example apps/api/.env
cd apps/api && npx prisma migrate deploy && cd ../..
pnpm dev
```

Al copiar el archivo de ejemplo hay que tener en cuenta dos cosas. Le faltan las
variables `S3_*` y `RESEND_*`, que se agregan a mano; para MinIO,
`S3_ENDPOINT=http://localhost:9000` con las credenciales que declara
`docker-compose.yml`. Y su valor de `CORS_ORIGINS` apunta al puerto de la propia
API en lugar del de la web: en desarrollo el frontend corre en el 3000 y la API
en el 3001, así que `CORS_ORIGINS=http://localhost:3000` es lo correcto —que es,
de hecho, el valor que la API usa por defecto cuando la variable no está
definida—.

Para trabajar sobre facturación electrónica sin tocar los servicios del organismo,
`ARCA_MOCK=1` responde desde el simulador incluido en el repositorio.
