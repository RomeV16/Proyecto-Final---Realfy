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
| Testing | Jest (unit + e2e) · Playwright (browser e2e) |
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
e2e/             Playwright end-to-end browser tests
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
| `pnpm test:e2e` | Run Playwright browser e2e tests |
| `pnpm lint` | ESLint across all packages |
| `pnpm --filter @realfy/api db:seed` | Seed demo data into the database |

---

## Test Coverage

Unit tests target **70 % line / function / branch / statement** coverage (enforced in CI via `jest --coverageThreshold`).

Run coverage locally:

```bash
pnpm --filter @realfy/api test:coverage
```

---

## Documentation

- [DEMO.md](./DEMO.md) — Demo de tesis en español (10 minutos)
- [docs/adr/](./docs/adr/) — Architecture Decision Records
- [docs/adjustments-research.md](./docs/adjustments-research.md) — Research on IPC/ICL adjustment mechanics

---

## License

Proprietary — All rights reserved.
