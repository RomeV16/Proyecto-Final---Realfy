# Herramienta nueva: SonarCloud

Versión 1.0 — 20 de octubre de 2026. Incorporada con el proceso de cinco
pasos: requisitos, mercado, prueba de concepto, matriz de decisión y
despliegue incremental.

## Mapa de herramientas del proyecto

| Función | Herramienta | Estado antes del TP | Estado después |
|---|---|---|---|
| Pruebas unitarias e integración | Jest + ts-jest + supertest | En uso | En uso, con suite por módulo |
| Cobertura | Istanbul (vía Jest) y v8 (vía vitest, web) | Umbral global 38 % | Umbral por módulo + reporte en SonarCloud, con la cobertura de la web, del paquete compartido y de las pruebas e2e de la API |
| Análisis estático local | ESLint 9 con `typescript-eslint` | En uso | En uso |
| Análisis estático centralizado + quality gate | **SonarCloud** | No existía | Nueva |
| Integración continua | GitHub Actions | 5 trabajos | 6 trabajos (+ despliegue efímero, integración externa y stress en los días 4 y 6) |
| Registro de defectos y trazabilidad | GitHub Issues con etiquetas | No se usaba | Nueva práctica |
| Pruebas de carga | k6 | No existía | Nueva (día 6) |
| Base de datos de prueba | PostgreSQL 16 (servicio de Actions / Docker / Homebrew) | En uso | En uso |

## Paso 1 — Requisitos

Lo que la herramienta tenía que resolver, en orden de importancia:

1. Quality gate automático que bloquee un PR por bugs nuevos, duplicación y
   cobertura sobre código nuevo, sin intervención manual.
2. Lectura de cobertura generada por Jest (formato LCOV).
3. Análisis de TypeScript en un monorepo con tres paquetes.
4. Integración con GitHub Actions y comentario de estado en el PR.
5. Costo cero para un repositorio público académico.
6. Métricas consultables por API para que el informe tome los números de la
   herramienta y no de una captura.
7. Historial de métricas para mostrar evolución antes y después.

## Paso 2 — Mercado

| Opción | Gate automático | LCOV | Monorepo TS | GitHub | Costo repo público | API | Historial |
|---|---|---|---|---|---|---|---|
| SonarCloud | Sí, configurable (plan pago) o "Sonar way" | Sí | Sí | App oficial + acción | Gratis | Sí | Sí |
| Codecov | Solo cobertura (umbral por PR) | Sí | Sí | App oficial | Gratis | Sí | Sí, solo cobertura |
| CodeClimate Quality | Sí, mantenibilidad y cobertura | Sí | Sí | App oficial | Gratis | Limitada | Sí |
| ESLint + jscpd + umbral de Jest (hecho en casa) | Sí, por scripts | Sí | Sí | Sin app; scripts | Gratis | No | No, salvo que se guarde |
| DeepSource | Sí | Sí | Sí | App oficial | Gratis | Limitada | Sí |

## Paso 3 — Prueba de concepto

El 19 de octubre de 2026 se creó el proyecto `RomeV16_Proyecto-Final---Realfy`
en la organización `romev16` y SonarCloud corrió un análisis automático
sobre `main` (commit `2eb2fa7`) sin tocar el repositorio:

| Métrica | Valor |
|---|---|
| Líneas de código | 82.136 |
| Bugs | 41 (rating C) |
| Vulnerabilidades | 42 (rating E) |
| Code smells | 818 (rating A) |
| Duplicación | 5,1 % |
| Cobertura | sin dato (el análisis automático no lee LCOV) |

Lo que la prueba de concepto enseñó:

- Las 42 vulnerabilidades son casi todas del propio `ci.yml`: acciones sin
  versión fija y `npx` sin versión. Es decir, la herramienta encontró un
  problema real del pipeline en el primer análisis.
- El análisis automático no sirve para el gate de cobertura: hay que
  lanzar el análisis desde el pipeline y desactivar el automático.
- El plan gratuito no permite crear quality gates propios (la API devuelve
  "not allowed to modify Quality gates"). Se usa el gate incorporado "Sonar
  way", cuyas condiciones cubren lo que pide el TP y son más exigentes en
  duplicación:

| Condición de "Sonar way" | Exigencia del TP | Cumple |
|---|---|---|
| Rating de fiabilidad en código nuevo = A (0 bugs nuevos) | Bloquear bugs críticos | Sí, bloquea cualquier bug nuevo |
| Duplicación en código nuevo ≤ 3 % | ≤ 5 % | Sí, más estricto |
| Cobertura en código nuevo ≥ 80 % | ≥ 80 % | Sí |
| Rating de seguridad en código nuevo = A | — | Extra |
| Rating de mantenibilidad en código nuevo = A | — | Extra |
| Hotspots de seguridad revisados = 100 % | — | Extra |

- La definición de "código nuevo" se fijó en 30 días (`sonar.leak.period=30`)
  para que el trabajo del TP cuente completo como nuevo.

## Paso 4 — Matriz de decisión

Pesos según el paso 1. Puntaje 1 a 5.

| Criterio | Peso | SonarCloud | Codecov | CodeClimate | Hecho en casa | DeepSource |
|---|---|---|---|---|---|---|
| Gate con bugs + duplicación + cobertura | 5 | 5 | 2 | 4 | 3 | 4 |
| Lee LCOV de Jest | 4 | 5 | 5 | 5 | 5 | 4 |
| Monorepo TypeScript | 3 | 5 | 4 | 3 | 4 | 4 |
| Integración GitHub / comentario en PR | 3 | 5 | 5 | 4 | 2 | 4 |
| Costo | 4 | 5 | 5 | 5 | 5 | 5 |
| API para el informe | 3 | 5 | 4 | 2 | 1 | 2 |
| Historial de métricas | 2 | 5 | 3 | 4 | 1 | 4 |
| **Total ponderado** | | **120** | **94** | **95** | **81** | **94** |

Cálculo: Σ(peso × puntaje). SonarCloud: 25+20+15+15+20+15+10 = 120.

## Paso 5 — Despliegue incremental

| Etapa | Fecha | Qué se activó | Qué se verificó |
|---|---|---|---|
| 1 | 19 oct | Proyecto creado; análisis automático sobre `main` | Línea base de métricas |
| 2 | 20 oct | `sonar-project.properties`; trabajo `sonar` en el pipeline con cobertura; gate "Sonar way"; análisis automático desactivado | El PR #76 recibe el análisis con cobertura y el estado del gate |
| 3 | 21-23 oct | El gate bloquea de verdad: PRs con pruebas nuevas al 80 % | Un PR en rojo por cobertura o bug nuevo y su corrección |
| 4 | 26 oct | Métricas finales por API en el informe | Coinciden con el panel |

## Cómo se usa

- El trabajo `unit` sube un solo artefacto con los LCOV de la API (completa y
  del módulo), de la web (`apps/web/coverage`, generado por vitest, CP-72
  incluido) y del paquete compartido (`packages/shared/coverage`). Las pruebas
  de la web (`*.test.ts`, `*.spec.ts`) están declaradas como pruebas en
  `sonar-project.properties`, así que no cuentan como código a cubrir.
- El trabajo `sonar` del pipeline descarga los LCOV del trabajo `unit`,
  corre `sonarqube-scan-action` con `sonar-project.properties` y después
  `sonarqube-quality-gate-action`, que falla el trabajo si el gate está en
  rojo.
- El token vive en el secret `SONAR_TOKEN` del repositorio. No está en el
  código.
- Panel: https://sonarcloud.io/project/overview?id=RomeV16_Proyecto-Final---Realfy
- Métricas por API (sin token, proyecto público):
  `https://sonarcloud.io/api/measures/component?component=RomeV16_Proyecto-Final---Realfy&metricKeys=bugs,vulnerabilities,code_smells,coverage,duplicated_lines_density`

## Gates de código muerto y duplicación (knip y jscpd)

SonarCloud mide la duplicación del repositorio entero, pero no ve archivos sin
uso ni dependencias que nadie importa. Dos gates baratos, sin servicio externo,
cubren ese hueco. Corren en el trabajo `quality-gates` del pipeline (requisito
31, issue #89) y en local con un comando.

| Gate | Qué mide | Cómo se corre | Falla cuando |
|---|---|---|---|
| knip 5.88.1 | Archivos sin uso, exports de valor sin uso y dependencias sin uso (`--include files,exports,dependencies`; los tipos exportados quedan fuera) | `pnpm knip` | Aparece un hallazgo que no está en `knip-baseline.json` |
| jscpd 4.3.0 | Porcentaje de líneas duplicadas por paquete (70 tokens y 5 líneas mínimas; sin pruebas, mocks ni generados) | `pnpm jscpd` | El porcentaje supera el umbral del paquete |

**Umbrales de duplicación.** Son la medición al fijarlos más un margen chico,
para que sólo empeoren por una decisión consciente. Se bajan a medida que se
extraen componentes de lista y helpers de PDF; no se suben sin dejarlo escrito
en el PR.

| Paquete | Umbral | Medición (31 oct 2026) |
|---|---|---|
| api | 2,6 % | 2,32 % |
| web | 2,3 % | 1,93 % |
| shared | 1,8 % | 1,11 % |

**Política de línea base de knip.** `knip-baseline.json` lista los hallazgos
aceptados (categoría, archivo y nombre; sin número de línea). El gate falla sólo
con los nuevos y avisa cuando uno de la línea base ya se resolvió. Un hallazgo
entra a la línea base únicamente si no es código muerto trivial de quitar y
queda anotado acá con su motivo. Para regenerarla: `pnpm knip:baseline` y
revisar el diff antes de commitear. Una falsa alarma de una herramienta se
corrige en `knip.json` (`ignoreDependencies`, `ignoreBinaries`, entradas), no en
la línea base.

Falsos positivos ya cubiertos en `knip.json`: `ts-node` (jest lee
`jest.config.ts`), `ts-loader`, `tsconfig-paths`, `source-map-support` y
`@nestjs/schematics` (CLI de Nest), `@types/*`, `eslint*` y `@typescript-eslint/*`
(configuración de lint), `tailwindcss`, `postcss` y `@tailwindcss/postcss` (se
usan desde el CSS), `jscpd` (el gate lo invoca por su ruta en `node_modules/.bin`,
que knip no sigue) y el binario `k6` (herramienta del sistema).

Línea base actual (1 hallazgo):

| Hallazgo | Motivo |
|---|---|
| export `MISSING_INDEX_DATA` en `contract-adjustment.service.ts` | No es código muerto: `contracts.service.ts` repite el literal `'MISSING_INDEX_DATA'` en vez de importar la constante. Es una oportunidad de reutilización, no una baja trivial; se resuelve con ese cambio y sale de la línea base |

**Limitación.** `packages/shared/src/index.ts` es entry point, así que knip
considera usado todo lo que exporta y no detecta exports muertos del paquete
compartido. Una revisión por búsqueda de texto (octubre 2026) encontró 157
exports de shared sin consumidor en api ni web, la mayoría tipos `*Input`
inferidos de zod. Ese control sigue siendo manual.

**Despliegue.** El paso de knip es informativo (`continue-on-error`) hasta el
14 de noviembre de 2026 y después pasa a bloqueante; el de jscpd bloquea desde
el primer día.
