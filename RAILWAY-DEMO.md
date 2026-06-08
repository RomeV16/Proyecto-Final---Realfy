# Despliegue de demo en Railway

Guia para levantar una version funcional del sistema (estado actual: items 05-10) en Railway para mostrarla en clase.

Estado de la demo:
- **API** (NestJS): funcional. Auth (registro/login/refresh), multi-inmobiliaria, auditoria, propiedades y personas. Endpoints bajo `/api`.
- **Web** (Next.js): shell de la aplicacion con navegacion, dashboard y listados. En esta etapa muestra datos de ejemplo; la integracion con la API se completa en los items siguientes del roadmap.
- **Base de datos**: PostgreSQL (plugin de Railway). Las tablas se crean con `prisma migrate deploy` al desplegar la API.

No se usa Redis ni credenciales de ARCA en esta etapa.

## Requisitos

- Cuenta en https://railway.app
- El repo `RomeV16/Proyecto-Final---Realfy` conectado a Railway (GitHub).

## Pasos

### 1. Crear el proyecto y la base de datos

1. En Railway: **New Project** -> **Deploy from GitHub repo** -> elegir `Proyecto-Final---Realfy`.
2. En el proyecto: **New** -> **Database** -> **Add PostgreSQL**. Railway crea la variable `DATABASE_URL` en el plugin.

### 2. Servicio API

1. **New** -> **GitHub Repo** (el mismo) -> nombrar el servicio `api`.
2. En **Settings** del servicio `api`:
   - **Config-as-code / Railway config file**: `apps/api/railway.json`
   - (si pide Root Directory dejarlo en la raiz del repo)
3. En **Variables** del servicio `api`:

   ```
   DATABASE_URL=${{ Postgres.DATABASE_URL }}
   JWT_SECRET=<generar string aleatorio largo>
   JWT_ACCESS_EXPIRY=15m
   JWT_REFRESH_DAYS=7
   NODE_ENV=production
   PORT=3001
   CORS_ORIGINS=https://<dominio-del-servicio-web>.up.railway.app
   ```

   `CORS_ORIGINS` se completa con la URL publica del servicio web una vez creado (paso 3).
4. Deploy. El health check queda en `/api/health` (ya configurado en `apps/api/railway.json`).
   Verificacion: `GET https://<api>.up.railway.app/api/health` debe responder `{"status":"ok"}`.

### 3. Servicio Web

1. **New** -> **GitHub Repo** (el mismo) -> nombrar el servicio `web`.
2. En **Settings** del servicio `web`:
   - **Railway config file**: `apps/web/railway.json`
3. En **Variables** del servicio `web`:

   ```
   NODE_ENV=production
   PORT=3000
   ```
4. Generar el dominio publico (**Settings -> Networking -> Generate Domain**) y copiarlo.
5. Volver al servicio `api` y poner ese dominio en `CORS_ORIGINS`. Redeploy de `api`.

### 4. Probar

- Web: abrir `https://<web>.up.railway.app` -> redirige a `/es` -> shell + dashboard + listados.
- API: probar el registro y login con curl o Postman:

  ```bash
  # Registro (crea inmobiliaria + usuario admin)
  curl -X POST https://<api>.up.railway.app/api/auth/register \
    -H 'Content-Type: application/json' \
    -d '{"email":"demo@realfy.test","password":"Demo12345","firstName":"Demo","lastName":"User"}'

  # Login
  curl -X POST https://<api>.up.railway.app/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"demo@realfy.test","password":"Demo12345"}'
  ```

## Notas

- Las migraciones se aplican solas en cada deploy de la API (`prisma migrate deploy`).
- Para resetear datos: borrar y recrear el plugin de Postgres, o `prisma migrate reset` contra `DATABASE_URL`.
- El plan free de Railway alcanza para la demo.
