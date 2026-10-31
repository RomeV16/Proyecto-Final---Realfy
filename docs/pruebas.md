# Manual de pruebas

El proyecto tiene tres suites, con propósitos y requisitos distintos. Las
unitarias corren en memoria y no necesitan nada instalado; las de integración
levantan la aplicación NestJS completa y pegan contra una base PostgreSQL real;
las de la aplicación web prueban funciones puras y los catálogos de mensajes.
Todas corren en cada cambio contra `main`, junto con el control de tipos.

## Pruebas unitarias

Prueban servicios, controladores, guards y utilidades con sus dependencias
sustituidas. No necesitan base de datos ni red.

```bash
pnpm --filter @realfy/api test
```

La configuración está en `apps/api/jest.config.ts` y toma dos ubicaciones: los
archivos `*.spec.ts` que viven al lado del código en `apps/api/src`, que son la
mayoría, y los de `apps/api/test/unit`, que prueban piezas transversales cuya
ubicación natural no es un módulo. Hoy son sesenta y dos archivos en el primer
grupo y cuatro en el segundo.

El paquete compartido tiene su propia suite, la del motor de comprobantes, con
treinta pruebas:

```bash
pnpm --filter @realfy/shared test
```

Dos de esos archivos vale nombrarlos porque cubren decisiones de arquitectura y
no lógica de dominio:

- `src/common/filters/all-exceptions.filter.spec.ts` recorre cada rama del filtro
  global de errores: la forma del envoltorio, la preservación del código de
  dominio y del contexto adjunto, la traducción de los errores de Prisma y el
  hecho de que un error inesperado no filtre nada al cliente (ADR-0005).
- `test/unit/prisma-tenant.extension.spec.ts` verifica la extensión de
  aislamiento operación por operación —lectura, creación, actualización, borrado,
  `upsert`, agregaciones— y que sin inmobiliaria en el contexto la consulta se
  rechace en lugar de ejecutarse (ADR-0006).
- `test/unit/credentials-throttle.spec.ts` verifica que los endpoints que reciben
  credenciales lleven el límite estricto de intentos, que es lo que la suite de
  integración no puede comprobar porque corre con el límite apagado.

Las plantillas de PDF se sustituyen por dobles (`test/mocks/`) para que las
pruebas no dependan de la carga de fuentes.

### Zona horaria fija

Jest fija `TZ=UTC` en un `globalSetup` (`apps/api/test/setup/utc.js` y
`packages/shared/test-utc.js`), sin importar la zona de la máquina. Los cálculos
de períodos y vencimientos dependen de ella: antes de fijarla, la prueba de flujo
de caja de `reports.service.spec.ts` fallaba en una máquina con
`America/Argentina/Buenos_Aires` y pasaba en el pipeline (UTC). Es el hallazgo
registrado en `docs/calidad/09-metricas.md`, y ahora lo cubre CP-73. El mismo
`globalSetup` aplica a las pruebas del módulo, a las de contrato y a las de
integración.

Fijar la zona hace reproducibles las pruebas, pero no vuelve correcto el código en
otra zona. Para eso hay dos mecanismos:

- Los casos de CP-131 (`reports.service.spec.ts`, `liquidaciones-periodos.spec.ts`,
  `renditions-periodos.spec.ts`, `liquidaciones/email.service.spec.ts`) asignan
  `process.env.TZ = 'America/Argentina/Buenos_Aires'` en `beforeAll` y lo restauran en
  `afterAll`. Jest entrega a cada archivo una copia de `process.env`, así que el
  entorno `apps/api/test/setup/tz-environment.js` reenvía esa asignación al proceso
  real. Corren en la suite normal y fallan si alguien vuelve a armar un período en
  hora local.
- `pnpm --filter @realfy/api test:tz-ar` corre toda la suite unitaria de la API con el
  proceso en esa zona (`JEST_TZ` reemplaza el `UTC` del `globalSetup`). Sirve para
  detectar código sensible a la zona en pruebas que no la fijan por su cuenta.

### Cobertura

```bash
pnpm --filter @realfy/api test:coverage
```

El piso vigente está declarado en `apps/api/jest.config.ts` y es de **38 % de
líneas, funciones y sentencias, y 27 % de ramas**. Es un piso, no una meta: está
unos puntos por debajo de lo que las suites cubren hoy —la medición al fijarlo dio
42,07 % de líneas, 43,22 % de funciones, 31,69 % de ramas y 42,03 % de
sentencias, y la última medición da 42,44 %, 43,52 %, 32,28 % y 42,40 %—, de modo que la integración continua se pone en rojo cuando la
cobertura baja, no cuando alguien no llega a un número aspiracional. Si el piso
se sube, tiene que ser porque la cobertura real subió primero.

## Pruebas de la aplicación web

La web usa [vitest](https://vitest.dev) (entorno `node`, el alias `@/` apunta a
`src/`). Por ahora prueba solo funciones puras de `src/lib` y los catálogos de
mensajes; no hay pruebas de componentes ni de navegador.

```bash
pnpm --filter @realfy/web test            # una corrida
pnpm --filter @realfy/web test:coverage   # con cobertura (lcov y resumen JSON en apps/web/coverage)
```

- Las pruebas de `lib` viven al lado del código, con la terminación `.test.ts`.
- `apps/web/test/i18n-parity.spec.ts` es **CP-72**: aplana `es.json` y `en.json`,
  exige que tengan exactamente las mismas claves y que ninguna tenga el texto
  vacío. Si falla, el mensaje lista las claves que faltan en cada idioma.

## Control de tipos

La compilación de Nest y la de `tsc` excluyen los archivos de prueba, de modo que
un error de tipos en un spec solo aparecía al ejecutarlo. Cada paquete tiene un
`tsconfig.typecheck.json` que los incluye y un script:

```bash
pnpm typecheck      # los tres paquetes, vía turbo
pnpm --filter @realfy/api typecheck
```

En la API se necesita el paquete compartido compilado y el cliente de Prisma
generado.

## Pruebas de integración

Levantan la aplicación NestJS completa, con sus guards, su filtro de errores, su
extensión de aislamiento y su cliente de Prisma, y le pegan por HTTP con
`supertest`. Recorren el camino entero: petición, autenticación, contexto de
inmobiliaria, servicio, base de datos y respuesta.

Necesitan una base PostgreSQL propia y vacía. No una base de desarrollo con datos
adentro: los casos limpian las tablas entre pruebas, en orden de dependencia, así
que apuntarlas a una base con datos reales los borra.

```bash
createdb realfy_e2e
cd apps/api
export DATABASE_URL=postgresql://localhost:5432/realfy_e2e
npx prisma migrate deploy
NODE_ENV=test RATE_LIMIT_DISABLED=1 pnpm test:e2e
```

Desde la raíz del monorepo, `pnpm test:e2e` es un atajo al mismo comando.

Las dos variables del último paso no son opcionales. `RATE_LIMIT_DISABLED=1`
apaga el límite de peticiones, que de otro modo corta la suite con 429: cada caso
abre su propia sesión contra el mismo host, y el límite de los endpoints de
ingreso es de cinco intentos por minuto. La variable se ignora cuando
`NODE_ENV=production`, a propósito, para que un entorno mal cargado no deje la
API sin límite en producción. `NODE_ENV=test` habilita además la compuerta que
permite disparar a mano la corrida de punitorios sin esperar al planificador.

La configuración (`apps/api/test/jest-e2e.json`) fija un solo trabajador y un
tiempo máximo de treinta segundos por caso. El trabajador único es necesario: las
pruebas comparten la base, y en paralelo se pisarían entre ellas.

En el pipeline la suite corre con cobertura (`pnpm --filter @realfy/api
test:e2e:coverage`, informe en `apps/api/coverage-e2e/`). Buena parte de los
servicios sólo se ejercita contra la base real, así que SonarCloud suma este
informe al de las unitarias para medir la cobertura del código nuevo. Por eso el
trabajo de Sonar espera a que termine el e2e.

### Qué cubre cada suite

Son treinta y dos archivos. Los que están en la raíz de `apps/api/test` cubren
comportamientos transversales; los de `apps/api/test/e2e`, un módulo cada uno.

| Suite | Qué verifica |
|---|---|
| `tenant-isolation.e2e-spec.ts` | Dos inmobiliarias con datos propios recorren los endpoints sensibles y ninguna llega a los datos de la otra. |
| `rbac.e2e-spec.ts` | Cada rol alcanza lo que le corresponde y recibe 403 en lo que no. |
| `audit-trail.e2e-spec.ts` | Las operaciones sensibles dejan traza con el usuario y la entidad afectada. |
| `invitation-flow.e2e-spec.ts` | Invitación de un usuario, aceptación y definición de contraseña. |
| `e2e/smoke.e2e-spec.ts` | La aplicación levanta, el punto de salud responde y el circuito de sesión funciona. |
| `e2e/properties.e2e-spec.ts` | Alta, edición, operaciones, transiciones de estado, media y bloqueo de la baja con contratos activos. |
| `e2e/persons.e2e-spec.ts` | Personas, sus roles múltiples y sus documentos. |
| `e2e/contracts.e2e-spec.ts` | Alta de contratos con partes y garantías, y validación de monto y fechas. |
| `e2e/contracts-lifecycle.e2e-spec.ts` | El ciclo de vida del contrato hasta la rescisión y el resumen de cierre. |
| `e2e/contract-templates.e2e-spec.ts` | Plantillas y generación del documento del contrato. |
| `e2e/index-data.e2e-spec.ts` | Carga de índices y cálculo y aplicación de ajustes. |
| `e2e/liquidaciones.e2e-spec.ts` | Generación del mes, líneas, transiciones de estado y pagos, incluido el rechazo del que supera el saldo. |
| `e2e/penalties.e2e-spec.ts` | Cálculo de punitorios, morosos y condonación. |
| `e2e/invoices.e2e-spec.ts` | Emisión de facturas con ARCA simulado: numeración correlativa, dos emisores con el mismo punto de venta, tipo y número, idempotencia, aislamiento y emisor obligatorio. |
| `e2e/renditions.e2e-spec.ts` | Rendición al propietario, comisión, conceptos y envío. |
| `e2e/services.e2e-spec.ts` | Servicios de la propiedad y sus pagos. |
| `e2e/tickets.e2e-spec.ts` | Circuito de reclamos, transiciones, comentarios y asignación de proveedor. |
| `e2e/providers.e2e-spec.ts` | Proveedores, filtros por rubro y zona, y orden de los candidatos para un reclamo. |
| `e2e/leads.e2e-spec.ts` | Leads, conversión y descarte. |
| `e2e/pipelines.e2e-spec.ts` | Embudos, etapas y reordenamiento. |
| `e2e/interactions.e2e-spec.ts` | Interacciones y visitas sobre un lead. |
| `e2e/scoring.e2e-spec.ts` | Configuración de pesos y cálculo del puntaje en el servidor. |
| `e2e/valuations.e2e-spec.ts` | Tasaciones y comparables de la cartera. |
| `e2e/dashboard.e2e-spec.ts` | Métricas del panel y su restricción por rol. |
| `e2e/reports.e2e-spec.ts` | Los seis reportes, sus filtros y sus formatos de descarga. |
| `e2e/import-export.e2e-spec.ts` | Subida, mapeo, validación fila por fila y confirmación. |
| `e2e/email-templates.e2e-spec.ts` | Plantillas de correo, previsualización y envío a un lead. |
| `e2e/notifications.e2e-spec.ts` | Generación de avisos y su marcado como leídos. |
| `e2e/portal-auth.e2e-spec.ts` | Invitación al portal, definición de contraseña, ingreso, rotación del token de refresco y rechazo de tokens del ámbito equivocado. |
| `e2e/portal.e2e-spec.ts` | El inquilino ve su contrato y sus liquidaciones, y solo las suyas. |
| `e2e/portal-tickets.e2e-spec.ts` | El inquilino abre un reclamo, lo comenta y lo ve en su listado. |
| `e2e/public.e2e-spec.ts` | El micrositio sin sesión: perfil por slug, catálogo con solo las propiedades disponibles, ficha no publicada y consulta que entra como interesado. |

Los servicios de ARCA no se consultan de verdad. Las pruebas unitarias simulan
las llamadas HTTP al organismo, y la suite de facturación corre con `ARCA_MOCK=1`,
que responde desde el simulador incluido en el repositorio.

No hay pruebas de navegador. Las pruebas que este documento llama de integración
son de nivel HTTP contra la API real, no recorridos de interfaz.

## Integración continua

El flujo de trabajo es `.github/workflows/ci.yml`, y corre en cada empuje a
`main` y en cada pedido de incorporación de cambios hacia `main`. Usa Node 22 y
pnpm con caché, cancela las corridas anteriores de la misma rama, y son nueve
trabajos: Lint, Build, Unit Tests & Coverage, SonarCloud & Quality Gate,
External contract, Ephemeral deploy, Migrations from scratch, API E2E Tests y
Gates de código muerto y duplicación.

**Gates de código muerto y duplicación.** Corre `pnpm knip` (archivos, exports y
dependencias sin uso frente a `knip-baseline.json`; informativo hasta el 14 de
noviembre de 2026) y `pnpm jscpd` (duplicación por paquete contra su umbral;
bloqueante). Detalle, umbrales y política de la línea base en
`docs/calidad/08-herramienta-sonarcloud.md`. La paridad de claves i18n (CP-72) y
la de enums (`test/unit/enum-parity.spec.ts`) ya corren en el trabajo de
pruebas unitarias.

**Lint.** Instala, compila el paquete compartido, genera el cliente de Prisma,
corre el linter sobre todos los paquetes y después el control de tipos
(`pnpm -r typecheck`), que incluye los archivos de prueba. Los dos pasos previos
no son decorativos: el linter y `tsc` resuelven tipos que provienen de ahí, y sin
ellos fallan por tipos inexistentes.

**Build.** Compila el paquete compartido, genera el cliente de Prisma y compila
la API y la web. Es el trabajo que atrapa los errores de tipos.

**Unit Tests & Coverage.** Corre las unitarias de la API con cobertura, las del
módulo de índices, las del paquete compartido y las de la web, todo con `TZ=UTC`,
con lo cual el piso declarado en la configuración de Jest se convierte en una
condición de la integración continua. Los reportes (LCOV y HTML de la API, el
módulo, la web y el paquete compartido) se suben como artefacto y se conservan
catorce días.

**SonarCloud & Quality Gate.** Depende de las unitarias: descarga los LCOV,
corre el análisis y bloquea el cambio si el quality gate falla
(`docs/calidad/08-herramienta-sonarcloud.md`).

**External contract (BCRA / INDEC).** Depende de las unitarias y pega a los
servicios reales para verificar que el contrato asumido siga vigente. Está en
rojo desde el 28 de octubre por una causa externa documentada en
`docs/calidad/`.

**Ephemeral deploy, smoke & stress.** Construye la imagen de `Dockerfile.api`,
la arranca contra una base vacía y corre el smoke y las pruebas de carga con k6.

**Migrations from scratch.** Levanta un PostgreSQL 16 como servicio, valida el
esquema y aplica **todas** las migraciones sobre una base vacía. Después corre
`prisma migrate status`, que confirma que no quedan migraciones pendientes, y
`prisma migrate diff --exit-code` contra la base migrada, que falla si
`schema.prisma` y las migraciones difieren. Este trabajo existe por un incidente concreto: una migración quedó
con una línea que no era SQL, y como en ese momento la integración continua solo
compilaba, el error apareció recién contra la base real. Peor todavía,
al quedar registrada como fallida, bloqueó también todas las migraciones
siguientes y trabó el despliegue entero. Aplicarlas desde cero en cada cambio es
lo que detecta eso antes de producción.

**Migration over synthetic data.** Es un paso del trabajo anterior que corre
`scripts/migration-rehearsal.sh` sobre una segunda base vacía del mismo servicio.
El script aplica las migraciones que ya tenía la rama base (en un pull request,
`origin/<rama base>`; en un push, `HEAD~1`), carga los datos sintéticos de
`apps/api/test/migration-data/seed.sql`, aplica todas las migraciones del árbol
actual y ejecuta cada archivo de `apps/api/test/migration-data/checks/`. Una
verificación es una consulta que devuelve filas solo cuando algo salió mal
(una persona con datos bancarios viejos sin su cuenta, conteos que cambiaron,
filas huérfanas); si alguna devuelve filas el paso falla y las imprime. Si el
cambio no agrega migraciones, el script termina sin hacer nada.

Para correrlo en local hace falta una base vacía y la rama base en el
repositorio:

```bash
createdb realfy_migracion_ensayo
DATABASE_URL=postgresql://usuario:clave@localhost:5432/realfy_migracion_ensayo \
  scripts/migration-rehearsal.sh origin/main
```

Cuando una migración nueva transforma datos, se agrega el caso borde a
`seed.sql` (siempre con valores inventados) y una verificación en `checks/`; el
conjunto de datos y las verificaciones evolucionan con las migraciones.

**API E2E Tests.** Depende del trabajo de unitarias, así que solo corre si esas
pasaron. Levanta PostgreSQL 16, aplica las migraciones y corre la suite de
integración con `NODE_ENV=test`, `RATE_LIMIT_DISABLED=1` y secretos de sesión
propios del entorno de integración.

Los ocho trabajos tienen tiempo máximo declarado —quince minutos, veinticinco el
de integración y treinta el del despliegue efímero— para que una prueba colgada no ocupe la cola indefinidamente.

## Escribir una prueba nueva

Las utilidades compartidas están en `apps/api/test/helpers/test-utils.ts`:
levantan la aplicación una sola vez por archivo, exponen el cliente de Prisma y
limpian la base entre casos. La limpieza recorre las tablas en orden de
dependencia, hijos antes que padres; cuando se agrega una entidad nueva al modelo,
hay que sumarla ahí, o las pruebas van a empezar a fallar por claves foráneas de
una forma que no señala la causa.

Para una prueba de aislamiento, el patrón es crear dos inmobiliarias con datos y
verificar dos cosas distintas: que un listado devuelva únicamente los registros
propios —no que el ajeno esté al final de la página—, y que una operación sobre
un recurso de la otra inmobiliaria sea rechazada. Las dos verificaciones son
necesarias: la primera detecta un filtro faltante en la lectura, la segunda uno
faltante en la escritura, y un bug puede afectar solo a una de las dos.


## Suites del proceso de calidad del módulo de índices

Ver [`docs/calidad/`](./calidad/) para el detalle. Resumen de comandos:

| Comando | Qué corre | Necesita |
|---|---|---|
| `pnpm --filter @realfy/api test:modulo` | Unitarias del módulo `index-data`, el contrato con BCRA e INDEC sobre respuestas grabadas, y cobertura con piso propio (80 % líneas, 70 % ramas) | Nada |
| `pnpm --filter @realfy/api test:e2e:modulo` | Las pruebas de integración de `index-data` | PostgreSQL |
| `pnpm --filter @realfy/api test:integracion-real` | Contrato contra el BCRA y el INDEC reales | Internet |
| `pnpm --filter @realfy/api test:smoke -- --url=<api>` | Smoke sobre un despliegue (salud, registro, módulo de índices) | Una instancia desplegada |
