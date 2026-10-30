# Métricas y análisis estático

Versión 1.1 — 28 de octubre de 2026 (1.0: 20 de octubre). Todos los números salen de una
ejecución identificable (commit, ejecución del pipeline o análisis de
SonarCloud). Las filas "después" se completan al cierre de cada día.

## Métricas de producto (SonarCloud + Jest)

| Métrica | Qué mide | Antes (`main` 2eb2fa7, 19 oct) | Después | Interpretación |
|---|---|---|---|---|
| Líneas de código del repositorio | Tamaño | 82.136 | | Referencia; no es objetivo subirlas ni bajarlas |
| Bugs (repositorio) | Errores probables detectados estáticamente | 41, rating C | Código del PR: 0 bugs, rating A (PR #76) | Ninguno en `index-data`; los del repositorio quedan fuera de alcance salvo los que el gate bloquee como nuevos |
| Vulnerabilidades (repositorio) | Problemas de seguridad | 42, rating E | Código del PR: 0, rating A; las 40 de `ci.yml` desaparecen al mezclar | 40 de 42 están en `ci.yml`: acciones sin SHA y `npx` sin versión. Se corrigen el día 2 |
| Code smells (repositorio) | Deuda de mantenibilidad | 818, rating A | Código del PR: 3 | Rating A pese al número: la deuda estimada es baja respecto del tamaño |
| Duplicación (repositorio) | Líneas duplicadas | 5,1 % | Código del PR: 2,4 %; sobre código nuevo 0,0 % | Justo sobre el 5 % que el TP pone como tope; dentro del módulo la duplicación `preview`/`applyDueAdjustments` se elimina el día 5 |
| Cobertura de líneas, API completa | Sentencias ejecutadas por las unitarias | 42,44 % (commit 98e34b7, informe de tesis) | 44,05 % (día 3, local) | Piso en CI: 38 % |
| Cobertura de líneas, módulo `index-data` | Ídem, acotado | 44,89 % | 94,81 % (día 3), 96,47 % (día 5), 96,63 % (DEF-07/08) | Meta 80 % |
| Cobertura de ramas, módulo | Decisiones ejecutadas | 25,26 % | 86,31 % (día 3), 92,04 % (día 5), 92,70 % (DEF-07/08) | Meta 70 %. Es la métrica que más dice sobre la lógica de CU-08 |
| Cobertura de funciones, módulo | | 46,93 % | 95,65 % (día 3) | |
| Pruebas unitarias del módulo | Cantidad de casos | 18 | 107 (día 5), 111 (DEF-07/08) + 18 del motor en el paquete compartido | |
| Pruebas de integración del módulo | Cantidad de casos | 17 | 21 (día 5) + 5 de contrato real; CP-58 en la suite de contratos | |

### SonarCloud sobre el PR #76 (análisis desde el pipeline, con cobertura)

| Métrica | Valor | Condición del gate |
|---|---|---|
| Líneas analizadas del PR | 1.371 | — |
| Cobertura sobre código nuevo | 97,3 % | ≥ 80 % ✔ |
| Bugs nuevos | 0 (rating A) | rating A ✔ |
| Vulnerabilidades nuevas | 0 (rating A) | rating A ✔ |
| Duplicación sobre código nuevo | 0,0 % | ≤ 3 % ✔ |
| Hotspots revisados | 100 % | 100 % ✔ |
| **Quality gate** | **en verde** | |

Las cifras del repositorio completo (41 bugs, 42 vulnerabilidades) son las
de `main` y cambian recién al mezclar el PR; el análisis del PR muestra
que el trabajo no agrega ninguna y que la corrección de `ci.yml` elimina
las 40 que estaban ahí.

## Métrica de proceso

**Tiempo entre la detección de un defecto y su prueba de regresión en
verde.** Se mide por defecto en `06-registro-de-defectos.md` con las fechas
del issue y del PR. Meta: todos los defectos del TP cerrados dentro del
cronograma (≤ 4 días desde la detección). Es una métrica de proceso porque
describe cómo trabaja el equipo, no el producto.

| Defecto | Detectado | Prueba en rojo | Corrección en verde | Días |
|---|---|---|---|---|
| DEF-01 | 19 oct | 20 oct (run 39336742449) | 20 oct | 1 |
| DEF-02 | 19 oct | 20 oct | 20 oct | 1 |
| DEF-03 | 19 oct | 20 oct | 20 oct | 1 |
| DEF-04 | 19 oct | — (código muerto) | 20 oct | 1 |
| DEF-05 | 19 oct (sospechado), 20 oct (confirmado) | 20 oct | 20 oct | 1 |
| DEF-06 | 19 oct (prueba contra entorno real) | 20 oct | 20 oct | 1 |
| DEF-07 | 28 oct (datos de la demostración) | 28 oct (run 40804485827) | 28 oct | 0 |
| DEF-08 | 28 oct (revisión del barrido al corregir DEF-07) | 28 oct (run 40804485827) | 28 oct | 0 |

## Métrica de proyecto

**Duración del pipeline completo y tasa de ejecuciones en verde.** Se toma
del historial de GitHub Actions de la rama `tp-calidad`. Meta: < 15 minutos
y toda ejecución en rojo explicada por un defecto real o por una
dependencia externa (R-07).

| Ejecución | Fecha | Disparador | Duración | Resultado | Causa si rojo |
|---|---|---|---|---|---|
| 39332025846 | 19 oct | PR #76, día 1 (2ad0d7b) | — | cancelada por el push siguiente | — |
| 39332624038 | 19 oct | día 2 (5abf962) | — | cancelada por el push siguiente | — |
| 39333479276 | 19 oct | día 3 (344010d) | ~12 min | **verde** (8 trabajos) | — |
| 39336402384 | 19 oct | día 4 (d1e2ff0) | — | cancelada por el push siguiente; `integration-real` y `sonar` en verde antes de cancelarse | — |
| 39336742449 | 19 oct | regresión en rojo (27a5d92) | ~3 min | **rojo** | 8 casos nuevos fallan contra el código con DEF-02, 03, 05 y 06: defecto real |
| 39337428907 | 19 oct | correcciones (b6e9eca) | ~2 min | **rojo** | `contract-closure-trigger.spec.ts` construye `ContractsService` por el inyector y no tenía el proveedor nuevo `IndexDataService`: doble de prueba faltante, no defecto de producto |
| 39337763326 | 19 oct | doble + k6 (58de3d1) | 7 min | **rojo** en el paso de stress | 7 trabajos en verde; el stress corrió completo sin errores y el p95 (720 ms) superó el umbral de 500 ms en el runner compartido. Ver `10-stress.md` |
| 39339533616 | 19 oct | mejoras medidas (bcf3f83) | 6 min | **verde** (8 trabajos) | Ejecución completa en verde: smoke, stress (p95 8,8 ms), contrato real y gate incluidos |
| 40804485827 | 28 oct | PR #85, regresión en rojo (0cfa450) | ~1 min | **rojo** | 3 casos nuevos fallan contra el código con DEF-07 y DEF-08: defecto real |
| 40804889473 | 28 oct | PR #85, corrección (a1591b4) | 7 min | **rojo** solo en `integration-real` | 7 de 8 trabajos en verde, CP-55 a CP-58 incluidos. CP-52 falla por frescura: la API de series del INDEC no publica desde julio (último dato 2026-07-01, 120,09 días contra un tope de 120). Externo (R-07), no defecto propio |

## Mejora medida antes y después

Se eligió una mejora que se pueda medir con el mismo instrumento antes y
después: **la cobertura de ramas del módulo**, porque es la que refleja si
la tabla de decisión de CU-08 está realmente ejercitada.

| Momento | Líneas | Ramas | Funciones | Pruebas | Instrumento |
|---|---|---|---|---|---|
| Antes (2eb2fa7) | 44,89 % | 25,26 % | 46,93 % | 18 | `pnpm --filter @realfy/api test:modulo` |
| Después (día 3, 20 oct) | 94,81 % | 86,31 % | 95,65 % | 91 | mismo comando, misma máquina; piso del módulo subido a 80 / 70 |
| Después (día 5, 20 oct) | 96,47 % | 92,04 % | 98,03 % | 107 | ídem, con las correcciones |

Segunda mejora medida, de desempeño (`10-stress.md`): bajo 50 usuarios
virtuales, p95 del listado 104,6 → 17,4 ms y del último valor 92,8 → 13,3 ms,
tras resolver la unión propia + sistema en SQL y reducir las consultas de
`latest` de diez a dos.

## Hallazgo sobre la suite existente

Al correr la suite unitaria completa de la API en una máquina con zona
horaria America/Argentina/Buenos_Aires fallan 12 casos de tres archivos
fuera del alcance (`reports.service.spec.ts`, `arca-client.factory.spec.ts`,
`arca-ta.manager.spec.ts`). En el pipeline (UTC) pasan. El de reportes pasa
localmente con `TZ=UTC`, lo que confirma que depende de la zona horaria; los
dos de ARCA fallan por otra causa local no investigada. Se reporta como
hallazgo: las pruebas unitarias deberían fijar `process.env.TZ` para ser
reproducibles en cualquier máquina. Las pruebas nuevas del módulo usan
fechas a mediodía UTC por esa razón (ver DEF-05).

Seguimiento al 30 de octubre: Jest fija `TZ=UTC` en un `globalSetup` (CP-73). Con
la zona de Buenos Aires en la shell, la suite completa de la API (807 casos)
dejaba entonces un único caso en rojo, `ReportsService › getCashFlow › arma un
renglon por mes del rango`; los de ARCA ya pasaban. Con el `globalSetup` los 807
pasan en cualquier zona.

## Análisis estático

- **ESLint** corre en el trabajo `lint` sobre los tres paquetes. Estado al
  19 de octubre: 0 errores, advertencias solo en la aplicación web
  (`no-img-element`), fuera de alcance.
- **SonarCloud** corre en el trabajo `sonar` con cobertura. Issues abiertos
  dentro de `apps/api/src/modules/index-data` al 19 de octubre: 0 bugs,
  0 vulnerabilidades; code smells por revisar el día 3 (complejidad
  cognitiva de `applyDueAdjustments` y duplicación con `preview`).
