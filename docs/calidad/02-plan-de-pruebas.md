# Plan de pruebas del módulo de índices y ajustes

| Campo | Valor |
|---|---|
| Versión | 1.0 |
| Fecha | 19 de octubre de 2026 |
| Alcance | `apps/api/src/modules/index-data`, `packages/shared/src/adjustment-engine`, endpoint `POST /api/contracts/:id/preview-adjustment` |
| Requisitos cubiertos | RF-12, RF-13, RF-14; RNF-22, RNF-23 |
| Caso de uso | CU-08 — Calcular y aplicar ajuste |
| Nivel declarado | 3 |
| Historial | 1.0: versión inicial a partir de la sección 7.9 del informe de tesis |

## 1. Qué se prueba y qué no

**Dentro del alcance.** La obtención de índices desde el BCRA y el INDEC
(`IndexScraperService`), la tarea diaria que la dispara
(`IndexScraperScheduler`), la carga, consulta y borrado de índices
(`IndexDataService`, `IndexDataController`), la previsualización y la
aplicación automática de ajustes (`ContractAdjustmentService`) y el motor de
cálculo compartido (`calculateAdjustment` y sus cinco funciones).

**Fuera del alcance.** El resto de la API, la aplicación web, la
facturación, el portal del inquilino. El cálculo manual de ajustes desde
`ContractsService.calculateAdjustment` se toca solo en lo que comparte con
el módulo: la lectura de índices.

## 2. Niveles de prueba y pirámide

| Nivel | Qué verifica | Dependencias | Dónde vive | Comando |
|---|---|---|---|---|
| Unitario | Cada servicio con sus dependencias sustituidas; el motor de cálculo con valores conocidos | Ninguna | `apps/api/src/modules/index-data/*.spec.ts`, `packages/shared/src/adjustment-engine/*.spec.ts` | `pnpm --filter @realfy/api test:modulo` |
| Integración (API) | Los endpoints por HTTP con guards, filtro de inmobiliaria y Postgres real | PostgreSQL 16 | `apps/api/test/e2e/index-data.e2e-spec.ts`, `index-data-scraper.e2e-spec.ts` | `pnpm --filter @realfy/api test:e2e:modulo` |
| Migración sobre datos | Que cada migración nueva transforma sin perder ni inventar datos: se carga un conjunto sintético con la forma de los datos reales en el esquema anterior, se aplican las migraciones nuevas y consultas de verificación (que solo devuelven filas si algo falló) comparan antes y después (CP-117 y CP-119) | PostgreSQL 16, historia del repositorio de la rama base | `apps/api/test/migration-data/` (`seed.sql`, `checks/*.sql`), `scripts/migration-rehearsal.sh` | `DATABASE_URL=... scripts/migration-rehearsal.sh origin/main` |
| Integración externa | El contrato con BCRA e INDEC: respuesta grabada (doble) y respuesta real | Red | `apps/api/test/integration/*.spec.ts` | `pnpm --filter @realfy/api test:integracion-real` |
| Unitario (web) | Funciones puras de `apps/web/src/lib` y paridad de claves i18n (CP-72) | Ninguna | `apps/web/src/lib/*.test.ts`, `apps/web/test/*.spec.ts` | `pnpm --filter @realfy/web test` |
| Control de tipos | Que los archivos de prueba también compilen (la compilación normal los excluye) | Paquete compartido compilado, cliente de Prisma generado | `tsconfig.typecheck.json` de cada paquete | `pnpm typecheck` |
| Smoke | Que un despliegue nuevo arranca, conecta a la base y sirve el módulo | Instancia desplegada | `apps/api/test/smoke/` | `pnpm --filter @realfy/api test:smoke` |
| Stress y esfuerzo sostenido | Que la consulta de índices aguanta carga y no degrada en el tiempo | Instancia desplegada | `apps/api/test/load/*.js` | `pnpm --filter @realfy/api test:stress` |

El nivel de migración sobre datos existe porque aplicar las migraciones sobre
una base vacía (nivel de integración) prueba que el SQL es válido, pero no que un
backfill deje los datos bien: sobre cero filas cualquier transformación «pasa».
El conjunto sintético (`seed.sql`) tiene datos inventados con la forma real,
incluidos los casos borde que hacen fallar un backfill: campos a medias, cadenas
vacías, personas sin datos y dos inmobiliarias para detectar mezclas entre
ellas. Se escribe contra el esquema anterior a las migraciones nuevas; el script
toma esas migraciones tal como estaban en la rama base.

La pirámide se respeta por volumen: muchas unitarias (rápidas, sin red),
menos de integración (con base), pocas externas y una de smoke. Las de
stress no cuentan en la pirámide: miden capacidad, no corrección.

## 3. Criterios de entrada y de salida

### Entrada (para empezar a ejecutar una suite)

| Suite | Criterio |
|---|---|
| Unitaria | El paquete compartido compila y el cliente de Prisma está generado; las pruebas corren con `TZ=UTC` fijada por Jest (CP-73) |
| Integración | Migraciones aplicadas sobre una base vacía sin error (`prisma migrate deploy`) y `prisma migrate diff` sin diferencias |
| Migración sobre datos | Una base vacía y la rama base disponible en el repositorio; antes de la primera migración con backfill el ensayo tiene que estar en verde |
| Externa | Las unitarias e integración están en verde; hay salida a Internet |
| Smoke | El despliegue respondió `200` en `/api/health` con `db: connected` |
| Stress | El smoke pasó sobre la misma instancia |

### Salida (para dar por cumplido el nivel)

| Suite | Criterio |
|---|---|
| Unitaria | 100 % de los casos en verde; cobertura del módulo ≥ 80 % líneas y ≥ 70 % ramas |
| Integración | 100 % en verde |
| Migración sobre datos | Todas las verificaciones sin filas; el ensayo falla si una devuelve alguna, si el conjunto sintético no carga o si una migración no aplica sobre esos datos |
| Externa | 100 % en verde o, si una fuente externa está caída, fallo clasificado como R-01/R-02 con el doble en verde |
| Smoke | Los tres pasos en verde (salud, autenticación, lectura del módulo) |
| Stress | p95 < 500 ms y tasa de error < 1 % bajo 50 usuarios virtuales durante 2 minutos; esfuerzo sostenido 10 minutos sin crecimiento del p95 mayor al 20 % |
| Quality gate | SonarCloud en verde: 0 bugs críticos nuevos, duplicación < 5 %, cobertura sobre código nuevo ≥ 80 % |

## 4. Estrategia por técnica

- **Arrange–Act–Assert** en todas las unitarias, con el criterio de
  aceptación escrito en el nombre del caso antes de la implementación.
- **Clases de equivalencia y valores límite** sobre las entradas del módulo:
  cantidad de valores de índice (0, 1, 2, n), paginación (`page` 0/1,
  `limit` 100/101), precisión decimal (6 y 7 decimales), periodicidades
  (las seis declaradas más una inválida). Detalle en `05-casos-de-prueba.md`.
- **Tabla de decisión** sobre la modalidad de ajuste × disponibilidad de
  índices × porcentaje declarado, que es la regla de negocio central de
  CU-08.
- **Cobertura de sentencia y de decisión** medidas por Jest (`% Stmts` y
  `% Branch`) y reportadas a SonarCloud.
- **Dobles de prueba** para BCRA, INDEC y Prisma en las unitarias; entorno
  real en las de contrato.
- **Prueba de regresión** por cada defecto: la prueba se escribe primero,
  se ejecuta en rojo contra el código viejo y queda en la suite.

## 5. Ambientes

| Ambiente | Base | Red externa | Quién lo usa |
|---|---|---|---|
| Local | PostgreSQL 16 (Docker o Homebrew) | Opcional | Desarrollo |
| Integración continua | PostgreSQL 16 como servicio del trabajo, creado desde cero | Sí, en el trabajo `integration-real` | Cada PR y cada push a `main` |
| Despliegue efímero | PostgreSQL 16 como servicio; API construida desde `Dockerfile.api` | No | Trabajo `smoke-deploy` y `stress` |
| Demostración (`production`) | Railway (PostgreSQL administrado), solo datos sintéticos | Sí | Defensa |
| Piloto (`piloto`) | Railway, base y almacenamiento propios, datos reales | Sí | Inmobiliaria piloto |

El ambiente piloto está aislado de la demostración y de la integración continua:
ninguna prueba, script de prueba ni carga inicial se ejecuta contra él (ver
`../despliegue.md`). Los cambios se verifican en los demás ambientes y llegan al
piloto después de `production`.

**Prueba de restauración como prueba de fiabilidad.** La copia de seguridad del
piloto solo vale si se puede restaurar. Se prueba restaurándola en un
PostgreSQL local y verificando migraciones aplicadas y conteo de filas. La
primera se hizo el 2026-10-31 sobre una base sin datos de negocio, por lo que
prueba el procedimiento; se repite después de cargar datos reales y antes de
cada cierre de ciclo, midiendo el tiempo contra el RTO declarado (2 horas o
menos).

## 6. Trazabilidad

La cadena es **requisito → caso de prueba → defecto**:

- Cada requisito tiene un issue en GitHub con etiqueta `requisito`
  (RF-12, RF-13, RF-14).
- Cada caso de prueba tiene un identificador `CP-nn` en
  `05-casos-de-prueba.md`, que indica el requisito que verifica y el archivo
  y nombre de la prueba automatizada.
- Cada defecto tiene un issue con etiqueta `defecto`, que referencia el
  caso que lo detectó y el requisito afectado, y se cierra con el PR que
  trae la corrección y la prueba de regresión.

| Requisito | Casos | Defectos |
|---|---|---|
| RF-12 Cronograma y cálculo según cinco modalidades ([#73](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/73)) | CP-05 a CP-17, CP-40 a CP-45 | DEF-02, DEF-03 |
| RF-13 Conservar los valores de índice usados ([#74](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/74)) | CP-13, CP-14, CP-45 | DEF-02 |
| RF-14 Obtención automática y carga manual ([#75](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/75)) | CP-18 a CP-34, CP-46 a CP-54 | DEF-01, DEF-04 |
| RNF-22 Salud degradada sin base | CP-60 | — |
| RNF-23 Arranque sin credenciales externas | CP-60 | — |

## 7. QA y QC: qué es cada cosa en este trabajo

| Aseguramiento de la calidad (QA): evita defectos | Control de calidad (QC): los encuentra |
|---|---|
| Plan de pruebas versionado con criterios de entrada y salida | Ejecución de las suites unitaria, integración, externa y smoke |
| Quality gate configurado antes de escribir código | Lectura del reporte de cobertura y de los issues de SonarCloud |
| Revisión por PR obligatoria en `main` | Pruebas de stress y lectura de los umbrales |
| Plantillas de caso y de defecto | Registro de cada defecto con pasos, esperado y obtenido |
| Prueba de regresión exigida por defecto corregido | Contraste rojo/verde de cada corrección |
| Riesgos priorizados y contingencia escrita | Prueba de contrato contra BCRA e INDEC |

## 8. Plantillas

### Caso de prueba

```
ID: CP-nn
Requisito: RF-xx
Nivel: unitario | integración | externa | smoke | stress
Técnica: equivalencia | límite | tabla de decisión | regresión
Precondición:
Entrada:
Resultado esperado (fijado antes de ejecutar):
Prueba automatizada: <archivo>::<nombre del caso>
Estado: pendiente | verde | rojo
```

### Defecto

```
ID: DEF-nn
Título:
Requisito afectado: RF-xx
Caso que lo detecta: CP-nn
Severidad: bloqueante | alta | media | baja
Pasos para reproducir:
Resultado esperado:
Resultado obtenido:
Causa raíz:
Corrección (commit o PR):
Prueba de regresión: <archivo>::<nombre>
Evidencia rojo/verde: enlace a la ejecución del pipeline en rojo y en verde
Issue: #nn
```

## 9. Cronograma

| Día | Fecha | Entregable |
|---|---|---|
| 1 | 19 oct | Plan, objetivos, matriz ISO, riesgos, catálogo de casos, issues de requisitos |
| 2 | 20 oct | SonarCloud en el pipeline, quality gate, versiones fijas de las acciones |
| 3 | 21 oct | Unitarias del módulo al 80 %, tablas de decisión implementadas |
| 4 | 22 oct | Contrato y pruebas de integración externa, despliegue efímero y smoke en el pipeline |
| 5 | 23 oct | Defectos con rojo/verde, regresión, ejecución fallida real del pipeline |
| 6 | 24 oct | Stress y esfuerzo sostenido con k6, mejora medida |
| 7 | 25-26 oct | Informe, presentación, demostración |
