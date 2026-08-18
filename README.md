# Realfy — Real Estate SaaS CRM

[![CI](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml/badge.svg)](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml)

Multi-tenant SaaS CRM for Argentine real estate agencies — property management, rental contracts with IPC/ICL indexing, monthly liquidations, arrears tracking, and maintenance tickets.

> **Thesis demo:** see [DEMO.md](./DEMO.md) for the Spanish-language 10-minute walkthrough.

---

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Backend | NestJS |
| Frontend | Next.js 15 |
| ORM | Prisma |
| Database | PostgreSQL 16 |
| Cache / Queue | Redis 7 + BullMQ |
| Email | Resend |
| External APIs | BCRA / INDEC (inflation indices) |
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
│  │  Next.js 15   │  HTTP  │  NestJS  (REST + BullMQ)  │ │
│  │  (port 3001)  │        │  (port 3000)               │ │
│  └───────────────┘        └──────────┬────────────────┘ │
│                                      │                   │
│                          ┌───────────┼───────────┐       │
│                          ▼           ▼           ▼       │
│                     PostgreSQL     Redis      Resend     │
│                     (Prisma ORM)  (BullMQ)   (email)     │
│                                                         │
│                    External: BCRA API · INDEC API        │
└─────────────────────────────────────────────────────────┘
```

**Multi-tenancy model:** single database, every Prisma query is scoped by `tenantId` injected from the JWT claim. See [docs/adr/0002-multi-tenant-model.md](./docs/adr/0002-multi-tenant-model.md).

---

## Project Structure

```
apps/
  api/           NestJS backend API
  web/           Next.js 15 frontend
packages/
  shared/        Zod schemas, TypeScript types, shared constants
scripts/         Build and deployment helpers
docs/
  adr/           Architecture Decision Records
```

---

## Setup

### Prerequisites

- **Node.js** 20+
- **pnpm** (version from `package.json#packageManager`)
- **Docker** (for PostgreSQL + Redis)

### Install dependencies

```bash
pnpm install
```

### Environment variables

Copy the example and fill in the blanks:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Key variables for `apps/api/.env`:

```env
DATABASE_URL=postgresql://realfy:realfy_dev@localhost:5432/realfy_dev
REDIS_URL=redis://localhost:6379
JWT_SECRET=change_me_in_production
RESEND_API_KEY=re_...
```

### Start demo environment (recommended)

The `demo-reset.sh` script tears down all volumes, starts fresh containers, runs migrations, and seeds demo data in one command:

```bash
bash scripts/demo-reset.sh
```

Then in a separate terminal:

```bash
pnpm dev
```

Open `http://localhost:3001` — login with `admin@realfy.demo.central` / `Admin123!`.

### Start services manually

```bash
docker compose up -d postgres redis
pnpm --filter @realfy/api prisma migrate deploy
pnpm --filter @realfy/api db:seed
pnpm dev
```

---

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Compile all packages via Turborepo |
| `pnpm dev` | Start API + web in watch mode |
| `pnpm test` | Run Jest unit tests across all packages |
| `pnpm test:e2e` | Run the API e2e suite (needs a Postgres database) |
| `pnpm lint` | ESLint across all packages |
| `pnpm --filter @realfy/api db:seed` | Seed demo data into the database |

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

---

## Documentation

- [DEMO.md](./DEMO.md) — Demo de tesis en español (10 minutos)
- [docs/adr/](./docs/adr/) — Architecture Decision Records
- [docs/adjustments-research.md](./docs/adjustments-research.md) — Research on IPC/ICL adjustment mechanics

---

## License

Proprietary — All rights reserved.
