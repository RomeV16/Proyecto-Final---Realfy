# Realfy — Real Estate SaaS CRM

[![CI](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml/badge.svg)](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml)

Multi-tenant SaaS CRM for Argentine real estate agencies — property management, rental contracts with IPC/ICL indexing, monthly liquidations, arrears tracking, and maintenance tickets.

> **Documentación:** manual de usuario, guía de despliegue, referencia de API,
> manual de pruebas y guion de la demostración están en [`docs/`](./docs/) —
> ver el índice al final de este archivo.

---

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Backend | NestJS |
| Frontend | Next.js 15 |
| ORM | Prisma |
| Database | PostgreSQL 16 |
| Object storage | S3-compatible (MinIO en desarrollo) |
| Email | Resend |
| External APIs | ARCA (facturación), BCRA / INDEC (inflation indices) |
| Monorepo | Turborepo |
| Testing | Jest — unitarios + e2e de API sobre Postgres |
| CI/CD | GitHub Actions |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Turborepo monorepo                    │
│                                                         │
│  ┌───────────────┐        ┌───────────────────────────┐ │
│  │  apps/web     │◄──────►│  apps/api                 │ │
│  │  Next.js 15   │  HTTP  │  NestJS (REST, /api)      │ │
│  │  (port 3000)  │        │  (port 3001)              │ │
│  └───────────────┘        └──────────┬────────────────┘ │
│                                      │                   │
│                          ┌───────────┼───────────┐       │
│                          ▼           ▼           ▼       │
│                     PostgreSQL      S3        Resend     │
│                     (Prisma ORM)  (media)    (email)     │
│                                                         │
│              External: ARCA · BCRA API · INDEC API       │
└─────────────────────────────────────────────────────────┘
```

**Multi-tenancy model:** single database, every Prisma query is scoped by `tenantId` injected from the JWT claim, and the Prisma extension fails closed when there is no tenant in context. See [docs/adr/0003-multi-tenant-row-level.md](./docs/adr/0003-multi-tenant-row-level.md) and [docs/adr/0006-aislamiento-entre-inmobiliarias-fallando-cerrado.md](./docs/adr/0006-aislamiento-entre-inmobiliarias-fallando-cerrado.md).

---

## Project Structure

```
apps/
  api/           NestJS backend API
  web/           Next.js 15 frontend
packages/
  shared/        Zod schemas, TypeScript types, shared constants
docs/
  adr/           Architecture Decision Records
  tesis/         Documentación de tesis (alcance, arquitectura, hitos)
```

---

## Setup

### Prerequisites

- **Node.js** 22 (the version CI and both Dockerfiles use)
- **pnpm** (version from `package.json#packageManager`)
- **Docker** (for PostgreSQL + MinIO)

### Install dependencies

```bash
pnpm install
```

### Environment variables

Copy the example and fill in the blanks:

```bash
cp apps/api/.env.example apps/api/.env
```

Key variables for `apps/api/.env`:

```env
DATABASE_URL=postgresql://realfy:realfy_dev@localhost:5432/realfy_dev
JWT_SECRET=change_me_in_production
CORS_ORIGINS=http://localhost:3000
S3_ENDPOINT=http://localhost:9000
```

`apps/web` has no `.env` file: `NEXT_PUBLIC_API_URL` y `API_PROXY_TARGET` tienen
valores por defecto apuntando al backend local. La lista completa de variables,
por servicio, está en [docs/despliegue.md](./docs/despliegue.md).

### Start services

```bash
docker compose up -d postgres minio
cd apps/api && npx prisma migrate deploy && cd ../..
pnpm dev
```

Open `http://localhost:3000`. No hay datos precargados: la primera inmobiliaria y
su usuario Admin se crean desde `/es/auth/register`.

---

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile all packages via Turborepo |
| `pnpm dev` | Start API + web in watch mode |
| `pnpm test` | Run Jest unit tests across all packages |
| `pnpm test:e2e` | Run the API e2e suite (needs a Postgres database) |
| `pnpm lint` | ESLint across all packages |

---

## Tests

Two suites, both run on every pull request:

- **Unitarios** — `apps/api/src/**/*.spec.ts` y `apps/api/test/unit/**`, sin base de datos.
- **E2E de API** — `apps/api/test/**/*.e2e-spec.ts`: levantan la aplicación Nest
  completa y pegan contra una base PostgreSQL real, con las migraciones aplicadas
  desde cero. Cubren sesión, aislamiento entre inmobiliarias, RBAC, auditoría,
  propiedades, contratos, liquidaciones, pagos, rendiciones y el portal del inquilino.

```bash
# unitarios + cobertura
pnpm --filter @realfy/api test:coverage

# e2e de API contra una base propia
createdb realfy_e2e
cd apps/api
export DATABASE_URL=postgresql://localhost:5432/realfy_e2e
npx prisma migrate deploy
NODE_ENV=test RATE_LIMIT_DISABLED=1 pnpm test:e2e
```

`RATE_LIMIT_DISABLED=1` apaga el límite de peticiones, que de otro modo corta la
suite con 429 porque cada caso abre su propia sesión contra el mismo host. Se
ignora cuando `NODE_ENV=production`.

El piso de cobertura está en `apps/api/jest.config.ts` y hoy es **38 % de líneas,
funciones y sentencias, y 27 % de ramas**. Es un piso contra regresiones, no una
meta: la medición al fijarlo fue 42 % de líneas y 32 % de ramas.

El detalle de cada suite y de los trabajos de integración continua está en
[docs/pruebas.md](./docs/pruebas.md).

---

## Documentation

- [docs/manual-de-usuario.md](./docs/manual-de-usuario.md) — Qué ve y qué puede hacer cada rol, y los recorridos habituales
- [docs/despliegue.md](./docs/despliegue.md) — Servicios, variables de entorno, base de datos y almacenamiento
- [docs/api.md](./docs/api.md) — Referencia de endpoints por módulo, con roles y forma de error
- [docs/pruebas.md](./docs/pruebas.md) — Cómo correr las pruebas y qué cubre cada suite
- [docs/demo.md](./docs/demo.md) — Guion de la demostración
- [docs/adr/](./docs/adr/) — Architecture Decision Records
- [docs/tesis/](./docs/tesis/) — Documentación de tesis: alcance, arquitectura, modelo de datos e hitos

---

## License

Proprietary — All rights reserved.
