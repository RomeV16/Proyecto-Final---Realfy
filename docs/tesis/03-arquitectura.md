# Arquitectura

## Vista de alto nivel

Realfy se implementa como un monorepo TypeScript gestionado con Turborepo y workspaces de pnpm. El monorepo agrupa dos aplicaciones desplegables (`apps/api` y `apps/web`) y al menos un paquete compartido (`packages/shared`) donde viven tipos, enums y utilidades que ambas aplicaciones consumen.

```
+---------------------------------------------------------------+
|                         Realfy Monorepo                       |
|                                                               |
|   +-----------------+        +-------------------------+      |
|   |   apps/web      |        |   apps/api              |      |
|   |   Next.js 15    | <----> |   NestJS 10             |      |
|   |   App Router    |  HTTP  |   Controllers/Services  |      |
|   |   next-intl     |  JSON  |   Prisma Client         |      |
|   +-----------------+        +-------------------------+      |
|                                       |                       |
|                                       v                       |
|                              +------------------+             |
|                              |   PostgreSQL     |             |
|                              |   (Railway)      |             |
|                              +------------------+             |
|                                                               |
|   +----------------------+      +------------------------+    |
|   | packages/shared      |      | Servicios externos     |    |
|   |  - tipos             |      |  - ARCA (WSAA/WSFEv1)  |    |
|   |  - enums             |      |  - SMTP notificaciones |    |
|   |  - validadores zod   |      |  - Index INDEC/BCRA    |    |
|   +----------------------+      +------------------------+    |
+---------------------------------------------------------------+
```

## Capas dentro del backend

El backend NestJS se organiza por módulos de dominio (uno por cada carpeta listada en la estructura del proyecto). Cada módulo respeta tres capas:

- **Controller**: expone endpoints REST, valida el contrato HTTP con DTOs y aplica `guards` de autenticación y permisos.
- **Service**: contiene la lógica de negocio, orquesta operaciones transaccionales y delega persistencia.
- **Persistencia (Prisma)**: cliente único inyectado a través de un módulo global. No se accede a `prisma` desde controladores.

Los servicios reciben el `tenantId` desde el contexto autenticado, jamás desde el body de la request. Esto es central para garantizar el aislamiento.

## Frontend

`apps/web` está construido sobre Next.js 15 con App Router. Cada ruta vive bajo `/[locale]/...` para habilitar i18n con `next-intl`. El idioma por defecto es español (`es`) y existe un stub inicial de inglés (`en`) para sostener la trazabilidad de claves de traducción.

El frontend consume la API del backend a través de un cliente HTTP tipado, con el token JWT en `Authorization: Bearer`. El portal del inquilino vive en una rama de rutas separada (`/[locale]/portal/...`) y utiliza un flujo de autenticación distinto al de los usuarios internos.

## Multi-tenant por row-level

Todas las tablas de dominio incluyen una columna `tenantId` que referencia a la entidad `Tenant` (inmobiliaria). Cada consulta a Prisma se filtra por ese identificador. Para evitar olvidos, se trabaja con repositorios o servicios envoltorios que inyectan el filtro automáticamente.

El detalle de esta decisión se documenta en el ADR 0003.

## Autenticación

Se utiliza JWT de acceso de corta duración (configurable, por defecto 15 minutos) y refresh tokens persistidos en la tabla `RefreshToken`. Cuando un refresh se usa, se rota: el anterior queda invalidado y se emite uno nuevo. Esto permite revocar sesiones puntualmente.

El portal del inquilino tiene su propio flujo con la tabla `InquilinoCredential` y `PortalRefreshToken`, totalmente separado del flujo de usuarios internos. No hay reutilización de tokens entre ámbitos.

## i18n

La internacionalización se resuelve con `next-intl`. Las claves de traducción viven en `apps/web/src/i18n/messages/es.json` y `en.json`. La regla operativa es que toda clave nueva agregada a `es.json` debe existir en `en.json`, aunque sea con el mismo valor en español, para no romper builds.

## Despliegue y CI

- Despliegue en Railway. Cada aplicación corre como servicio independiente con su propia URL pública.
- Base de datos PostgreSQL administrada también por Railway.
- CI en GitHub Actions: lint, build, test unitarios y suite de Playwright sobre cada PR a `main`.
- Migraciones de Prisma versionadas en `apps/api/prisma/migrations`.

