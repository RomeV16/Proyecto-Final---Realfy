# Manual de pruebas

El proyecto tiene dos suites, con propósitos y requisitos distintos. Las
unitarias corren en memoria y no necesitan nada instalado; las de integración
levantan la aplicación NestJS completa y pegan contra una base PostgreSQL real.
Las dos corren en cada cambio contra `main`.

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
grupo y dos en el segundo.

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

### Cobertura

```bash
pnpm --filter @realfy/api test:coverage
```

El piso vigente está declarado en `apps/api/jest.config.ts` y es de **38 % de
líneas, funciones y sentencias, y 27 % de ramas**. Es un piso, no una meta: está
unos puntos por debajo de lo que las suites cubren hoy —la medición al fijarlo dio
42,07 % de líneas, 43,22 % de funciones, 31,69 % de ramas y 42,03 % de
sentencias—, de modo que la integración continua se pone en rojo cuando la
cobertura baja, no cuando alguien no llega a un número aspiracional. Si el piso
se sube, tiene que ser porque la cobertura real subió primero.

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

### Qué cubre cada suite

Son treinta archivos. Los que están en la raíz de `apps/api/test` cubren
comportamientos transversales; los de `apps/api/test/e2e`, un módulo cada uno.

| Suite | Qué verifica |
|---|---|
| `tenant-isolation.e2e-spec.ts` | Dos inmobiliarias con datos propios recorren los endpoints sensibles y ninguna llega a los datos de la otra. |
| `rbac.e2e-spec.ts` | Cada rol alcanza lo que le corresponde y recibe 403 en lo que no. |
| `audit-trail.e2e-spec.ts` | Las operaciones sensibles dejan traza con el usuario y la entidad afectada. |
| `invitation-flow.e2e-spec.ts` | Invitación de un usuario, aceptación y definición de contraseña. |
| `e2e/smoke.e2e-spec.ts` | La aplicación levanta, el punto de salud responde y el circuito de sesión funciona. |
| `e2e/properties.e2e-spec.ts` | Alta, edición, operaciones, transiciones de estado y media. |
| `e2e/persons.e2e-spec.ts` | Personas, sus roles múltiples y sus documentos. |
| `e2e/contracts.e2e-spec.ts` | Alta de contratos con partes y garantías. |
| `e2e/contracts-lifecycle.e2e-spec.ts` | El ciclo de vida del contrato hasta la rescisión y el resumen de cierre. |
| `e2e/contract-templates.e2e-spec.ts` | Plantillas y generación del documento del contrato. |
| `e2e/index-data.e2e-spec.ts` | Carga de índices y cálculo y aplicación de ajustes. |
| `e2e/liquidaciones.e2e-spec.ts` | Generación del mes, líneas, transiciones de estado y pagos. |
| `e2e/penalties.e2e-spec.ts` | Cálculo de punitorios, morosos y condonación. |
| `e2e/renditions.e2e-spec.ts` | Rendición al propietario, comisión, conceptos y envío. |
| `e2e/services.e2e-spec.ts` | Servicios de la propiedad y sus pagos. |
| `e2e/tickets.e2e-spec.ts` | Circuito de reclamos, transiciones, comentarios y asignación de proveedor. |
| `e2e/providers.e2e-spec.ts` | Proveedores y su selección por rubro y zona. |
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

Los servicios de ARCA no se consultan de verdad: `ARCA_MOCK=1` responde las
llamadas desde el simulador incluido en el repositorio.

No hay pruebas de navegador. Las pruebas que este documento llama de integración
son de nivel HTTP contra la API real, no recorridos de interfaz.

## Integración continua

El flujo de trabajo es `.github/workflows/ci.yml`, y corre en cada empuje a
`main` y en cada pedido de incorporación de cambios hacia `main`. Usa Node 22 y
pnpm con caché, cancela las corridas anteriores de la misma rama, y son cinco
trabajos.

**Lint.** Instala, compila el paquete compartido, genera el cliente de Prisma y
corre el linter sobre todos los paquetes. Los dos pasos previos no son
decorativos: el linter resuelve tipos que provienen de ahí, y sin ellos falla por
tipos inexistentes.

**Build.** Compila el paquete compartido, genera el cliente de Prisma y compila
la API y la web. Es el trabajo que atrapa los errores de tipos.

**Unit Tests & Coverage.** Corre las unitarias con cobertura, con lo cual el piso
declarado en la configuración de Jest se convierte en una condición de la
integración continua. El reporte HTML se sube como artefacto y se conserva
catorce días.

**Migrations from scratch.** Levanta un PostgreSQL 16 como servicio, valida el
esquema y aplica **todas** las migraciones sobre una base vacía, terminando con
`prisma migrate status` para verificar que el esquema coincida con las
migraciones. Este trabajo existe por un incidente concreto: una migración quedó
con una línea que no era SQL, y como los demás trabajos compilan pero nunca
ejecutan migraciones, el error apareció recién contra la base real. Peor todavía,
al quedar registrada como fallida, bloqueó también todas las migraciones
siguientes y trabó el despliegue entero. Aplicarlas desde cero en cada cambio es
lo que detecta eso antes de producción.

**API E2E Tests.** Depende del trabajo de unitarias, así que solo corre si esas
pasaron. Levanta PostgreSQL 16, aplica las migraciones y corre la suite de
integración con `NODE_ENV=test`, `RATE_LIMIT_DISABLED=1` y secretos de sesión
propios del entorno de integración.

Los cinco trabajos tienen tiempo máximo declarado —quince minutos, veinticinco el
de integración— para que una prueba colgada no ocupe la cola indefinidamente.

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
