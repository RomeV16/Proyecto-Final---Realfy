# Realfy — Real Estate SaaS CRM

[![CI](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml/badge.svg)](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml)

Multi-tenant SaaS CRM for Argentine real estate agencies — the full monthly rental cycle (contracts with lessors and negotiable rules, index adjustments, liquidations, collections, cash and owner statements, invoicing on behalf of lessors), plus contract lifecycle, incidents, messaging, publication and sales. Since October 2026 it is being validated in a pilot with a real agency.

> **Documentación:** manual de usuario, guía de despliegue, referencia de API,
> manual de pruebas y guion de la demostración están en [`docs/`](./docs/) —
> ver el índice al final de este archivo.

---

## Features

Grouped by area; each one is described in the [user manual](./docs/manual-de-usuario.md) and its decision, where there is one, in the [ADR index](./docs/adr/README.md).

**Parties and contracts**
- Properties with operations, prices, media, valuations, ownership and keys.
- People with several roles, bank accounts and identity data; contracts with one or more **lessors**, each with a collection percentage, and **attorneys-in-fact** (ADR-0007).
- **Negotiable rules**: agency defaults, versioned contract rules and dated agreements (ADR-0010); index adjustments (IPC, ICL, CCP, UVA, fixed, stepped) with lag, estimate and later correction (ADR-0011).
- **Expirations**: traffic-light follow-ups with checklist, verbal extension, renewal as a contract period; **deposits** with currency, holder, instalments and move-out settlement.

**Monthly cycle and money**
- Liquidations generated ahead of the month, with taxes and services split among three payers (ADR-0008), one-off charges, late-payment penalties and numbered receipts.
- **Cash**: collections through three flows (split, all to the agency, all to the lessor), custody of lessors' cash, compensations between lessors, ARS/USD/EUR accounts (ADR-0012).
- **Owner statements**: a current account per lessor and a consolidated monthly statement across all their units, with carried-over balance (ADR-0009).
- **Invoicing on behalf of lessors** through ARCA with a delegated issuer, idempotent queue and credit notes (ADR-0017); the agency's own invoicing with several issuers.
- **Fees**: letting, renewal, sale and valuation fees, adjustable instalments and staff commissions.
- **Collections**: staged reminders, pre-litigation stage with a draft formal notice and suggested referral to a lawyer, off by default (ADR-0013).

**Operations and communication**
- **Incidents and repairs**: pre-authorisation, quotes, provider payment and allocation to tenant or lessor; tenant portal with tickets.
- **Messaging**: idempotent outbox for email (Resend) and WhatsApp Cloud API, per-channel consent, signed webhooks and three sending modes (off, allow-list, live), off by default (ADR-0013).
- **Publication**: status per portal, ready-to-copy listing text and the agency's public microsite, also under its own domain.
- **Sales and keys**: reservation, deposit, signing and deed, pending deposits, property documentation, sale fees and key movements.
- Leads pipeline, reports, dashboard and two model-assisted features with deterministic fallback.

**Data and quality**
- **Migration** from the previous system: idempotent batches with dry run and per-row log (ADR-0015); **data quality** panel with duplicate detection and audited merge of people.
- **Reconciliation** suite: a synthetic monthly cycle checked to the cent, through the engines and through the API, on every change.
- Users with invitations and password recovery, role-filtered navigation and configurable read policy per role; tenant isolation that fails closed (ADR-0006).

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
| Messaging | Resend (email) and WhatsApp Cloud API, through an outbox |
| External APIs | ARCA (facturación), BCRA / INDEC (inflation indices) |
| Monorepo | Turborepo |
| Testing | Jest (API and shared, unit and API e2e on Postgres), Vitest (web) |
| CI/CD | GitHub Actions |

---

## Architecture

```mermaid
flowchart LR
    subgraph users["Users"]
        staff["Agency staff"]
        tenant["Tenant portal"]
        visitor["Microsite visitor<br/>agency slug or own domain"]
    end
    staff --> web
    tenant --> web
    visitor --> web
    web["apps/web<br/>Next.js 15, port 3000"] -- "HTTP JSON" --> api["apps/api<br/>NestJS 11, REST under /api, port 3001"]
    web --> shared["packages/shared<br/>types, Zod schemas<br/>and money engines"]
    api --> shared
    api --> db[("PostgreSQL 16<br/>Prisma ORM")]
    api --> s3[("S3-compatible storage<br/>media and attachments")]
    api --> outbox["Outbox<br/>off, allow-list or live"]
    outbox --> resend["Resend<br/>email"]
    outbox --> wa["WhatsApp Cloud API"]
    resend -.->|signed webhooks| api
    wa -.->|signed webhooks| api
    api --> arca["ARCA<br/>own and delegated issuers"]
    api --> idx["BCRA and INDEC<br/>adjustment indices"]
    api --> llm["Language model provider<br/>with deterministic fallback"]
```

The outbox is a table in the same database, written in the business transaction and drained by a scheduled job, so a failed send never rolls back the operation. The detailed context and deployment diagrams are in [docs/tesis/03-arquitectura.md](./docs/tesis/03-arquitectura.md).

**Environments.** The Railway project has two environments with the same four services (`web`, `api`, `db`, `storage`) and nothing shared in data or secrets: `production`, the demo used for the thesis defence, with synthetic data only, and `piloto`, used by the pilot real-estate agency with real data. Deploys are manual (`railway up` from a clean copy of a merged commit), `production` first and `piloto` after verification, with a database backup before every `piloto` deploy. Messaging (Resend and WhatsApp) goes through the outbox and is set to `MESSAGING_MODE=off` in `piloto` until the agency approves sending to its clients and the domain and WhatsApp account are verified. See [docs/despliegue.md](./docs/despliegue.md) and [docs/operacion-piloto.md](./docs/operacion-piloto.md).

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
MESSAGING_MODE=off        # off | allowlist | live
ARCA_MOCK=1               # local ARCA simulator
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

Four levels, all run on every pull request:

- **Unitarios** — `apps/api/src/**/*.spec.ts`, `apps/api/test/unit/**` y
  `packages/shared/src/**/*.spec.ts`, sin base de datos. Incluyen las pruebas
  "golden" de los motores de dinero del paquete compartido.
- **Web** — `apps/web/**/*.test.ts(x)` con vitest: funciones, hooks y pantallas, y la
  paridad de claves entre `es.json` y `en.json`.
- **E2E de API** — `apps/api/test/**/*.e2e-spec.ts`: levantan la aplicación Nest
  completa y pegan contra una base PostgreSQL real, con las migraciones aplicadas
  desde cero. Cubren sesión, aislamiento entre inmobiliarias, permisos por rol,
  auditoría y cada módulo, del contrato a la cuenta corriente del locador.
- **Reconciliación** — un ciclo mensual sintético con la forma de la cartera real,
  comparado al centavo contra lo calculado a mano: con los motores
  (`packages/shared/src/reconciliation`) y cargado por la API
  (`apps/api/test/e2e/reconciliacion.e2e-spec.ts`).

```bash
# unitarios + cobertura
pnpm --filter @realfy/api test:coverage
pnpm --filter @realfy/shared test
pnpm --filter @realfy/web test

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
meta: la medición al fijarlo fue 42 % de líneas y 32 % de ramas. Las cifras vigentes
de pruebas y cobertura, con su fecha y su fuente, están en una sola tabla:
[docs/tesis/29-informe-final.md](./docs/tesis/29-informe-final.md), sección 9.10.

El detalle de cada suite y de los trabajos de integración continua está en
[docs/pruebas.md](./docs/pruebas.md).

---

## Documentation

- [docs/manual-de-usuario.md](./docs/manual-de-usuario.md) — Qué ve y qué puede hacer cada rol, y los recorridos habituales
- [docs/despliegue.md](./docs/despliegue.md) — Servicios, ambientes, variables de entorno, base de datos, almacenamiento, copias y restauración
- [docs/operacion-piloto.md](./docs/operacion-piloto.md) — Runbook del ambiente piloto: despliegue controlado, copias, restauración, cierre de mes e incidentes
- [docs/privacidad-datos.md](./docs/privacidad-datos.md) — Datos personales del piloto: base legal, accesos, retención y anonimización
- [docs/api.md](./docs/api.md) — Referencia de endpoints por módulo, con roles y forma de error
- [docs/pruebas.md](./docs/pruebas.md) — Cómo correr las pruebas y qué cubre cada suite
- [docs/demo.md](./docs/demo.md) — Guion de la demostración
- [docs/adr/](./docs/adr/README.md) — Architecture Decision Records, con su índice
- [docs/tesis/](./docs/tesis/) — Documentación de tesis: alcance, arquitectura, modelo de datos e hitos
- [docs/tesis/29-informe-final.md](./docs/tesis/29-informe-final.md) — Informe final, con el capítulo del piloto y la tabla única de cifras del sistema
- [docs/tesis/30-piloto.md](./docs/tesis/30-piloto.md) — Piloto en una inmobiliaria real: objetivos, fases, ciclo mensual, flujos de cobro, reconciliación y gobernanza de datos
- [docs/calidad/](./docs/calidad/) — Proceso de calidad: plan de pruebas, matriz ISO 25010, riesgos, defectos, integración externa, stress y pruebas de aceptación en campo del piloto

---

## License

Proprietary — All rights reserved.

The repository is public but contains no real data from the pilot: no names, documents, amounts or figures. Real data lives only in the `piloto` environment.
