# Métricas y análisis estático

Versión 1.0 — 20 de octubre de 2026. Todos los números salen de una
ejecución identificable (commit, ejecución del pipeline o análisis de
SonarCloud). Las filas "después" se completan al cierre de cada día.

## Métricas de producto (SonarCloud + Jest)

| Métrica | Qué mide | Antes (`main` 2eb2fa7, 19 oct) | Después | Interpretación |
|---|---|---|---|---|
| Líneas de código del repositorio | Tamaño | 82.136 | | Referencia; no es objetivo subirlas ni bajarlas |
| Bugs (repositorio) | Errores probables detectados estáticamente | 41, rating C | | Ninguno en `index-data`; los del repositorio quedan fuera de alcance salvo los que el gate bloquee como nuevos |
| Vulnerabilidades (repositorio) | Problemas de seguridad | 42, rating E | | 40 de 42 están en `ci.yml`: acciones sin SHA y `npx` sin versión. Se corrigen el día 2 |
| Code smells (repositorio) | Deuda de mantenibilidad | 818, rating A | | Rating A pese al número: la deuda estimada es baja respecto del tamaño |
| Duplicación (repositorio) | Líneas duplicadas | 5,1 % | | Justo sobre el 5 % que el TP pone como tope; dentro del módulo la duplicación `preview`/`applyDueAdjustments` se elimina el día 5 |
| Cobertura de líneas, API completa | Sentencias ejecutadas por las unitarias | 42,44 % (commit 98e34b7, informe de tesis) | | Piso en CI: 38 % |
| Cobertura de líneas, módulo `index-data` | Ídem, acotado | 44,89 % | | Meta 80 % |
| Cobertura de ramas, módulo | Decisiones ejecutadas | 25,26 % | | Meta 70 %. Es la métrica que más dice sobre la lógica de CU-08 |
| Cobertura de funciones, módulo | | 46,93 % | | |
| Pruebas unitarias del módulo | Cantidad de casos | 18 | | |
| Pruebas de integración del módulo | Cantidad de casos | 17 | | |

## Métrica de proceso

**Tiempo entre la detección de un defecto y su prueba de regresión en
verde.** Se mide por defecto en `06-registro-de-defectos.md` con las fechas
del issue y del PR. Meta: todos los defectos del TP cerrados dentro del
cronograma (≤ 4 días desde la detección). Es una métrica de proceso porque
describe cómo trabaja el equipo, no el producto.

| Defecto | Detectado | Prueba en rojo | Corrección en verde | Días |
|---|---|---|---|---|
| DEF-01 | 19 oct | | | |
| DEF-02 | 19 oct | | | |
| DEF-03 | 19 oct | | | |
| DEF-04 | 19 oct | | | |
| DEF-05 | 19 oct (sospechado) | | | |

## Métrica de proyecto

**Duración del pipeline completo y tasa de ejecuciones en verde.** Se toma
del historial de GitHub Actions de la rama `tp-calidad`. Meta: < 15 minutos
y toda ejecución en rojo explicada por un defecto real o por una
dependencia externa (R-07).

| Ejecución | Fecha | Disparador | Duración | Resultado | Causa si rojo |
|---|---|---|---|---|---|
| 39332025846 | 19 oct | PR #76, día 1 | | | |

## Mejora medida antes y después

Se eligió una mejora que se pueda medir con el mismo instrumento antes y
después: **la cobertura de ramas del módulo**, porque es la que refleja si
la tabla de decisión de CU-08 está realmente ejercitada.

| Momento | Líneas | Ramas | Funciones | Pruebas | Instrumento |
|---|---|---|---|---|---|
| Antes (2eb2fa7) | 44,89 % | 25,26 % | 46,93 % | 18 | `pnpm --filter @realfy/api test:modulo` |
| Después | | | | | mismo comando, misma máquina, y la ejecución del pipeline |

Segunda mejora medida, de desempeño: el p95 de `GET /api/index-data` antes
y después de la optimización elegida el día 6 (`10-stress.md`).

## Análisis estático

- **ESLint** corre en el trabajo `lint` sobre los tres paquetes. Estado al
  19 de octubre: 0 errores, advertencias solo en la aplicación web
  (`no-img-element`), fuera de alcance.
- **SonarCloud** corre en el trabajo `sonar` con cobertura. Issues abiertos
  dentro de `apps/api/src/modules/index-data` al 19 de octubre: 0 bugs,
  0 vulnerabilidades; code smells por revisar el día 3 (complejidad
  cognitiva de `applyDueAdjustments` y duplicación con `preview`).
