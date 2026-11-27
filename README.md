# Realfy

[![CI](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml/badge.svg)](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/workflows/ci.yml)

Realfy es un sistema de gestión para inmobiliarias argentinas que administran
alquileres. Cubre el ciclo mensual completo: contratos con sus locadores y sus
reglas, ajustes por índice, liquidaciones, cobros, caja, estados de cuenta del
locador y facturación por cuenta del locador. Varias inmobiliarias usan la misma
instalación sin ver los datos de las otras.

Es el trabajo final de carrera de Manuel Ferreras, Romeo Valdomero y Mariano
(`marianonallar`). Desde octubre de 2026 se valida en un piloto con una inmobiliaria real.

Hay una demostración con datos sintéticos en <https://demo.realfy.app>; el guion
para recorrerla está en [docs/demo.md](./docs/demo.md).

## Qué hace

Cada función está descripta en el [manual de usuario](./docs/manual-de-usuario.md)
y, cuando hubo una decisión de diseño, en un [ADR](./docs/adr/README.md).

Contratos y partes:

- Propiedades con operaciones, precios, fotos, tasaciones, titularidad y llaves.
- Personas con varios roles, cuentas bancarias y datos de identidad. Un contrato
  puede tener varios locadores, cada uno con su porcentaje de cobro, y apoderados
  (ADR-0007).
- Reglas negociables: valores por defecto de la inmobiliaria, reglas del contrato
  versionadas y acuerdos con fecha (ADR-0010).
- Ajustes por IPC, ICL, CCP, porcentaje fijo o personalizado, con rezago,
  estimación y corrección posterior (ADR-0011). UVA y escalonado están en el
  modelo, pero el alta de contratos todavía no los ofrece.
- Vencimientos con semáforo y seguimiento, prórroga de palabra y renovación;
  depósitos con moneda, tenedor, cuotas y liquidación de egreso.

Ciclo mensual y dinero:

- Liquidaciones generadas antes del mes, con impuestos y servicios repartidos
  entre tres pagadores (ADR-0008), cargos puntuales, punitorios y recibos
  numerados.
- Caja con tres flujos de cobro (repartido, todo a la inmobiliaria, todo al
  locador), custodia de efectivo de los locadores, compensaciones y cuentas en
  pesos, dólares y euros (ADR-0012).
- Cuenta corriente por locador y estado de cuenta mensual consolidado, con saldo
  arrastrado (ADR-0009).
- Facturación por cuenta del locador a través de ARCA con emisor delegado, cola
  idempotente y notas de crédito (ADR-0017), además de la facturación propia de
  la inmobiliaria.
- Honorarios de alta, renovación, venta y tasación, con cuotas y comisiones del
  personal.
- Cobranza escalonada con recordatorios y etapa prejudicial, apagada por defecto
  (ADR-0013).

Operación y comunicación:

- Incidencias y reparaciones con preautorización, presupuestos, pago al proveedor
  e imputación al inquilino o al locador. Portal del inquilino con reclamos.
- Mensajería por correo (Resend) y WhatsApp Cloud API a través de una bandeja de
  salida, con consentimiento por canal y tres modos de envío: apagado, lista
  permitida y en vivo. Viene apagada (ADR-0013).
- Bandeja de consultas que reúne WhatsApp, correo, formulario del micrositio y
  llamadas registradas, con responsable y plazo de primera respuesta (15 minutos
  por defecto).
- Publicación: estado por portal, texto del aviso listo para copiar y micrositio
  público de la inmobiliaria, también con dominio propio.
- Ventas y llaves: reserva, seña, boleto y escritura, documentación de la
  propiedad y movimientos de llaves.
- Embudo de interesados, reportes, panel y dos funciones asistidas por un modelo
  de lenguaje, con alternativa determinística cuando el modelo no está.

Datos:

- Importación desde el sistema anterior por lotes idempotentes, con ensayo sin
  escritura y registro por fila (ADR-0015).
- Panel de calidad de datos con detección de duplicados y unión auditada de
  personas.
- Obtención automática de boletas de servicios por archivo o por correo
  (ADR-0018).
- Usuarios con invitación y recupero de contraseña, menú filtrado por rol y
  política de lectura configurable. El aislamiento entre inmobiliarias falla
  cerrado (ADR-0006).

## Tecnología

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript |
| API | NestJS 11, REST bajo `/api` |
| Web | Next.js 15 (App Router), Tailwind |
| ORM y base | Prisma 6, PostgreSQL 16 |
| Archivos | Almacenamiento compatible con S3 (MinIO en desarrollo) |
| Mensajería | Resend y WhatsApp Cloud API, por bandeja de salida |
| Servicios externos | ARCA (facturación), BCRA e INDEC (índices) |
| Monorepo | pnpm y Turborepo |
| Pruebas | Jest (API y paquete compartido), Vitest (web) |
| Integración continua | GitHub Actions y SonarCloud |

## Arquitectura

```mermaid
flowchart LR
    subgraph users["Usuarios"]
        staff["Personal de la inmobiliaria"]
        tenant["Inquilino (portal)"]
        visitor["Visitante del micrositio"]
    end
    staff --> web
    tenant --> web
    visitor --> web
    web["apps/web<br/>Next.js 15, puerto 3000"] -- "HTTP JSON" --> api["apps/api<br/>NestJS 11, REST bajo /api, puerto 3001"]
    web --> shared["packages/shared<br/>tipos, esquemas Zod<br/>y motores de dinero"]
    api --> shared
    api --> db[("PostgreSQL 16<br/>Prisma")]
    api --> s3[("Almacenamiento S3<br/>fotos y adjuntos")]
    api --> outbox["Bandeja de salida<br/>apagada, lista permitida o en vivo"]
    outbox --> resend["Resend<br/>correo"]
    outbox --> wa["WhatsApp Cloud API"]
    resend -.->|webhooks firmados| api
    wa -.->|webhooks firmados| api
    api --> arca["ARCA<br/>emisores propios y delegados"]
    api --> idx["BCRA e INDEC<br/>índices de ajuste"]
    api --> llm["Proveedor de modelo de lenguaje<br/>con alternativa determinística"]
```

La bandeja de salida es una tabla de la misma base: se escribe en la transacción
del negocio y la vacía una tarea programada, de modo que un envío fallido no
deshace la operación. Los diagramas de contexto y de despliegue están en
[docs/tesis/03-arquitectura.md](./docs/tesis/03-arquitectura.md).

Todas las inmobiliarias comparten una base. Cada consulta de Prisma se filtra por
el `tenantId` que viene en el token de sesión, y si no hay inmobiliaria en el
contexto la consulta se rechaza en lugar de ejecutarse
([ADR-0003](./docs/adr/0003-multi-tenant-row-level.md),
[ADR-0006](./docs/adr/0006-aislamiento-entre-inmobiliarias-fallando-cerrado.md)).

El sistema corre en Railway, en dos ambientes con los mismos cuatro servicios
(`web`, `api`, `db`, `storage`) y sin datos ni secretos compartidos: `production`
es la demostración, con datos sintéticos, y `piloto` es el que usa la
inmobiliaria, con datos reales. El despliegue es manual (`railway up` desde un
commit ya integrado), primero a `production` y después a `piloto`, con una copia
de la base antes de cada despliegue al piloto. En `piloto` la mensajería está
apagada hasta que la inmobiliaria apruebe los envíos a sus clientes. El detalle
está en [docs/despliegue.md](./docs/despliegue.md) y
[docs/operacion-piloto.md](./docs/operacion-piloto.md).

## Estructura del repositorio

```
apps/
  api/           API NestJS
  web/           Aplicación web Next.js
packages/
  shared/        Tipos, esquemas Zod y motores de cálculo compartidos
infra/
  email-worker/  Worker de Cloudflare que recibe los mails entrantes
docs/            Documentación (ver el índice al final)
scripts/         Ensayo de migraciones y controles de código muerto y duplicación
```

## Cómo correrlo

Hace falta Node.js 22, pnpm (la versión que fija `package.json`) y Docker para
PostgreSQL y MinIO.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
docker compose up -d postgres minio
pnpm --filter @realfy/api exec prisma migrate deploy
pnpm dev
```

En `apps/api/.env` hay que ajustar al menos estas variables para que coincidan
con `docker-compose.yml`:

```env
DATABASE_URL=postgresql://realfy:realfy_dev@localhost:5432/realfy_dev
JWT_SECRET=un_valor_propio
CORS_ORIGINS=http://localhost:3000
S3_ENDPOINT=http://localhost:9000
MESSAGING_MODE=off        # off | allowlist | live
ARCA_MOCK=1               # simulador local de ARCA
```

La web queda en `http://localhost:3000` y la API en `http://localhost:3001/api`.
No hay datos precargados: la primera inmobiliaria y su usuario Admin se crean
desde `/es/auth/register`. La web no necesita archivo `.env`, porque
`NEXT_PUBLIC_API_URL` y `API_PROXY_TARGET` apuntan por defecto a la API local. La
lista completa de variables por servicio está en
[docs/despliegue.md](./docs/despliegue.md).

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta la API y la web en modo desarrollo |
| `pnpm build` | Compila todos los paquetes |
| `pnpm lint` | Corre ESLint en todos los paquetes |
| `pnpm typecheck` | Controla los tipos, archivos de prueba incluidos |
| `pnpm test` | Corre las pruebas unitarias de todos los paquetes |
| `pnpm test:e2e` | Corre las pruebas de integración de la API (necesita PostgreSQL) |

## Pruebas

Hay cuatro niveles y todos corren en cada pedido de incorporación de cambios:

- Unitarias de la API y del paquete compartido, sin base de datos. Incluyen las
  pruebas de valores conocidos de los motores de dinero.
- De la web, con Vitest: funciones, hooks y pantallas, y la paridad de claves
  entre `es.json` y `en.json`.
- De integración de la API: levantan la aplicación completa y la llaman por HTTP
  contra un PostgreSQL real con las migraciones aplicadas desde cero. Cubren
  sesión, aislamiento entre inmobiliarias, permisos por rol, auditoría y cada
  módulo.
- De reconciliación: un ciclo mensual sintético con la forma de la cartera real,
  comparado al centavo contra lo calculado a mano, con los motores y por la API.

```bash
pnpm --filter @realfy/api test:coverage
pnpm --filter @realfy/shared test
pnpm --filter @realfy/web test

# integración, contra una base propia y vacía
createdb realfy_e2e
export DATABASE_URL=postgresql://localhost:5432/realfy_e2e
pnpm --filter @realfy/api exec prisma migrate deploy
NODE_ENV=test RATE_LIMIT_DISABLED=1 pnpm test:e2e
```

`RATE_LIMIT_DISABLED=1` apaga el límite de peticiones, que de otro modo corta la
suite con 429; se ignora cuando `NODE_ENV=production`.

La integración continua exige un piso de cobertura en la API (38 % de líneas,
funciones y sentencias y 27 % de ramas, en `apps/api/jest.config.ts`) y SonarCloud
exige 80 % sobre el código nuevo de cada cambio. La cobertura medida está muy por
encima del piso. Las cantidades de pruebas y la cobertura vigentes, con su fecha y
la ejecución de la que salen, están en
[docs/tesis/29-informe-final.md](./docs/tesis/29-informe-final.md) (sección 9.10)
y en [docs/calidad/09-metricas.md](./docs/calidad/09-metricas.md). El detalle de
cada suite y de los trabajos del pipeline está en
[docs/pruebas.md](./docs/pruebas.md).

## Documentación

| Documento | Contenido |
|---|---|
| [docs/manual-de-usuario.md](./docs/manual-de-usuario.md) | Qué ve y qué puede hacer cada rol, y los recorridos habituales |
| [docs/demo.md](./docs/demo.md) | Guion de la demostración |
| [docs/api.md](./docs/api.md) | Endpoints por módulo, con sus roles y la forma de los errores |
| [docs/pruebas.md](./docs/pruebas.md) | Cómo correr las pruebas, qué cubre cada suite y qué hace el pipeline |
| [docs/despliegue.md](./docs/despliegue.md) | Servicios, ambientes, variables de entorno, base de datos, almacenamiento, copias y restauración |
| [docs/operacion-piloto.md](./docs/operacion-piloto.md) | Operación del ambiente piloto: despliegue controlado, copias, cierre de mes e incidentes |
| [docs/privacidad-datos.md](./docs/privacidad-datos.md) | Datos personales del piloto: base legal, accesos, retención y anonimización |
| [docs/adr/](./docs/adr/README.md) | Registros de decisiones de arquitectura, con su índice |
| [docs/calidad/](./docs/calidad/README.md) | Proceso de calidad: plan de pruebas, matriz ISO 25010, riesgos, casos, defectos, métricas, stress y aceptación en campo del piloto |
| [docs/tesis/](./docs/tesis/) | Documentación de la tesis: alcance, casos de uso, arquitectura, modelo de datos e hitos |
| [docs/tesis/29-informe-final.md](./docs/tesis/29-informe-final.md) | Informe final, con el capítulo del piloto y la tabla única de cifras del sistema |
| [docs/tesis/30-piloto.md](./docs/tesis/30-piloto.md) | El piloto en una inmobiliaria real: objetivos, fases, reconciliación y gobernanza de datos |

## Licencia

Software propietario, todos los derechos reservados.

El repositorio es público pero no contiene datos reales del piloto: ni nombres,
ni documentos, ni importes. Los datos reales están únicamente en el ambiente
`piloto`.
