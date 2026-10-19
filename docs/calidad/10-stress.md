# Stress y esfuerzo sostenido

Versión 1.0 — 20 de octubre de 2026. Cierra el desvío D-05 del informe de
tesis ("no se hicieron pruebas de carga") para el módulo de índices.

## Qué se mide y por qué

La operación más consultada del módulo es la lectura de índices: el
listado paginado (`GET /api/index-data`), el listado filtrado por tipo y
el último valor por tipo (`GET /api/index-data/latest`). Son las que el
panel y la pantalla de contratos piden cada vez que alguien revisa un
ajuste, y las que crecen con el tiempo porque el scraper agrega una fila
por día y por índice.

Cada usuario virtual hace esas tres lecturas y descansa medio segundo
(stress) o un segundo (esfuerzo sostenido). Antes de empezar, el script
registra una inmobiliaria y carga 754 índices (dos años de ICL diario y
dos de IPC mensual), el volumen que una inmobiliaria real acumula tras dos
años con la obtención automática activa.

## Herramienta

k6 (`apps/api/test/load/`), elegida porque los escenarios se escriben en
JavaScript junto al resto de las pruebas, los umbrales viven en el script
y fallan la ejecución solos, y exporta el resumen en JSON para que el
pipeline lo publique sin pasos manuales.

| Script | Caso | Perfil | Umbrales |
|---|---|---|---|
| `stress.js` | CP-70 | 0 → 50 usuarios virtuales en 30 s, 60 s en 50, 30 s a 0 | p95 < 500 ms global y por endpoint; errores < 1 %; checks > 99 % |
| `soak.js` | CP-71 | 10 usuarios virtuales constantes, 10 min (5 min en el pipeline, al entrar a `main`) | los mismos, más: el p95 no crece más de un 20 % entre el primer y el último tercio |

Comandos:

```bash
K6_URL=http://localhost:3001 pnpm --filter @realfy/api test:stress
K6_URL=http://localhost:3001 K6_SOAK=10m pnpm --filter @realfy/api test:soak
```

## Dónde corre

| Ambiente | API | Base | Nota |
|---|---|---|---|
| Local (medición de referencia) | `node apps/api/dist/main.js`, modo desarrollo con el límite de peticiones apagado, Apple Silicon | PostgreSQL 16 local | Es donde se comparan el antes y el después de la mejora |
| Pipeline | Contenedor `Dockerfile.api` reiniciado con `NODE_ENV=staging` y `RATE_LIMIT_DISABLED=1` | PostgreSQL 16 como servicio del trabajo | Runner compartido de GitHub: los números son relativos a ese ambiente (riesgo R-09) |

El límite de 600 peticiones por minuto por IP (RNF-03b) no se puede apagar
en producción por diseño. Con 50 usuarios virtuales se superan enseguida y
el stress mediría el limitador, no el módulo; por eso el contenedor del
pipeline se reinicia fuera del modo producción para esta etapa, después de
que el smoke ya verificó el arranque en modo producción.

## Resultados en local (medición de referencia)

Máquina: MacBook Apple Silicon, Node 23, PostgreSQL 16 local, API
compilada (`apps/api/dist`) en modo desarrollo con el límite de peticiones
apagado. Commit del "antes": `b6e9eca` (día 5, con las correcciones de
defectos y el listado paginando en memoria).

### CP-70 — Stress, 50 usuarios virtuales, 2 minutos (antes)

| Métrica | Valor | Umbral | Cumple |
|---|---|---|---|
| Peticiones | 19.998 (165,6 por segundo) | — | — |
| Iteraciones completas | 6.663 | — | — |
| Errores HTTP | 0 (0,00 %) | < 1 % | Sí |
| Checks | 100 % | > 99 % | Sí |
| p95 global | 104,4 ms | < 500 ms | Sí |
| p95 `GET /api/index-data` | 104,6 ms | < 500 ms | Sí |
| p95 `GET /api/index-data/latest` | 92,8 ms | < 500 ms | Sí |
| p99 / máximo global | 128,0 ms / 196,3 ms | — | — |

Resumen exportado: `k6-stress-before.json` (anexo del informe).

### CP-71 — Esfuerzo sostenido, 10 usuarios virtuales, 10 minutos (antes)

| Métrica | Valor | Umbral | Cumple |
|---|---|---|---|
| Peticiones | 16.719 (27,8 por segundo) | — | — |
| Iteraciones completas | 5.570 | — | — |
| Errores HTTP | 0 (0,00 %) | < 1 % | Sí |
| p95 global | 45,1 ms | < 500 ms | Sí |
| p99 / máximo | 52,1 ms / 184,3 ms | — | — |
| p95 del primer tercio | 45,0 ms | — | — |
| p95 del último tercio | 45,5 ms | crecimiento < 20 % | Sí (+1,1 %) |

Sin degradación en el tiempo: la API no acumula memoria ni conexiones
entre iteraciones. Resumen exportado: `k6-soak-before.json`; los tercios
se calculan sobre los 16.719 puntos crudos (`k6-soak-before-points.json`).

## Resultados en el pipeline (despliegue efímero)

Ejecución [39337763326](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/39337763326),
commit `58de3d1` (antes de la mejora), runner compartido `ubuntu-latest`
con la API en contenedor, PostgreSQL y k6 en la misma máquina:

| Métrica | Valor | Umbral de referencia | Cumple |
|---|---|---|---|
| Peticiones | 8.199 (≈ 68 por segundo) | — | — |
| Errores HTTP | 0 (0,00 %) | < 1 % | Sí |
| Checks | 100 % | > 99 % | Sí |
| p95 global | 720,2 ms | < 500 ms | **No** |
| p95 `GET /api/index-data` | 637,6 ms | < 500 ms | **No** |
| p95 `GET /api/index-data/latest` | 826,8 ms | < 500 ms | **No** |
| p99 / máximo | 960,0 ms / 1,29 s | — | — |

El paso quedó en rojo: el umbral hizo su trabajo. Dos lecturas del
resultado:

1. **Capacidad del ambiente.** Las mismas peticiones tardan siete veces
   más que en local; el runner tiene dos vCPU compartidas entre la API, la
   base y el generador de carga. Por eso el pipeline pasa `K6_P95=1000` y
   publica el valor medido: el umbral de 500 ms es el criterio del ambiente
   de referencia (riesgo R-09), y lo que el pipeline vigila es que no se
   degrade respecto de su propia historia.
2. **Costo real del módulo.** `GET /api/index-data/latest` es el más lento
   aun en local (92,8 ms contra 104,6 del listado, pero con un tercio de
   datos): hacía dos consultas por cada uno de los cinco tipos de índice,
   diez por llamada. Es la segunda mejora medida.

## Mejoras medidas

| Mejora | Antes | Después | Cómo se mide |
|---|---|---|---|
| Listado: unión propia + sistema y paginación en SQL (`DISTINCT ON` + `LIMIT/OFFSET`) en lugar de traer todas las filas visibles y paginar en memoria | p95 104,6 ms (local) | p95 17,4 ms | Mismo script, misma máquina, mismos datos |
| Último valor por tipo: una consulta `DISTINCT ON ("indexType")` más una de historial, en lugar de dos consultas por tipo (10 en total) | p95 92,8 ms (local) | p95 13,3 ms | Ídem |

### CP-70 — Stress, 50 usuarios virtuales, 2 minutos (después)

Commit de las mejoras (día 6), misma máquina y mismos datos que el "antes".

| Métrica | Antes | Después | Umbral | Cumple |
|---|---|---|---|---|
| Peticiones | 19.998 (165,6 por segundo) | 25.833 (214.0 por segundo) | — | — |
| Iteraciones completas | 6.663 | 8.608 | — | — |
| Errores HTTP | 0 | 0 (0.00 %) | < 1 % | Sí |
| p95 global | 104,4 ms | 15,8 ms | < 500 ms | Sí |
| p95 `GET /api/index-data` | 104,6 ms | 17,4 ms | < 500 ms | Sí |
| p95 `GET /api/index-data/latest` | 92,8 ms | 13,3 ms | < 500 ms | Sí |
| p99 / máximo global | 128,0 ms / 196,3 ms | 21,0 ms / 182,5 ms | — | — |

Con la misma carga ofrecida, la API atendió un 29 % más de peticiones
porque cada una tarda menos: los usuarios virtuales iteran más rápido.
Resumen exportado: `k6-stress-after.json`.
