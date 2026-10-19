# Catálogo de casos de prueba

Versión 1.1 — 20 de octubre de 2026 (1.0: 19 de octubre). El resultado esperado de cada caso se
fijó antes de ejecutar la prueba. La columna "prueba" apunta al archivo y
al nombre del caso en la suite; "estado" se actualiza con cada ejecución.
Los casos CP-01 a CP-04 y CP-40 a CP-49 ya existían en la tesis y se
conservan con su numeración nueva.

## Clases de equivalencia y valores límite

### Cantidad de valores de índice disponibles para el período

| Clase | Valores | Representante | Resultado esperado |
|---|---|---|---|
| Vacía | 0 | `[]` | IPC: factor 1, alquiler sin cambio. ICL: factor 1 (valor inicial y final en 1). Cálculo manual (`ContractsService`): `MISSING_INDEX_DATA` |
| Un solo valor | 1 | `[100]` | IPC: encadena un solo factor. ICL: inicio = fin, factor 1 |
| Dos o más | ≥ 2 | `[100, 120]` | IPC: producto de los factores. ICL: cociente fin / inicio |

### Paginación de `GET /index-data`

| Parámetro | Inválido bajo | Límite inferior válido | Límite superior válido | Inválido alto |
|---|---|---|---|---|
| `page` | 0 → 400 | 1 | — | — |
| `limit` | 0 → 400 | 1 | 100 | 101 → 400 |
| Ausentes | — | `page=1`, `limit=50` por defecto | — | — |

### Precisión decimal de `value` en `POST /index-data`

| Entrada | Clase | Esperado |
|---|---|---|
| `"1234.123456"` | 6 decimales | 201 |
| `"1234.1234567"` | 7 decimales | 400 `VALIDATION_ERROR` |
| `"-0.5"` | Negativo (deflación) | 201 |
| `"abc"` | No numérico | 400 |
| `1234.5` (número) | Número en vez de cadena | 201 (el esquema lo convierte) |

### Periodicidad del contrato → meses

| Entrada | Esperado |
|---|---|
| Mensual | 1 |
| Bimestral | 2 |
| Trimestral | 3 |
| Cuatrimestral | 4 |
| Semestral | 6 |
| Anual | 12 |
| Valor desconocido | 3 (valor por defecto declarado en el código) |

### Suma de meses sobre fin de mes (valor límite de fecha)

| Fecha | Meses | Esperado | Nota |
|---|---|---|---|
| 2026-01-15 | 1 | 2026-02-15 | caso normal |
| 2026-01-31 | 1 | 2026-02-28 | fin de mes: no debe saltar a marzo |
| 2026-12-01 | 1 | 2027-01-01 | cambio de año |
| 2024-02-29 | 12 | 2025-02-28 | bisiesto |

## Tabla de decisión: modalidad × datos × porcentaje (CU-08)

Alquiler base 100.000,00 en todos los casos.

| Regla | Modalidad | Valores de índice | `customAdjustmentPct` | Nuevo alquiler esperado | Factor | Caso |
|---|---|---|---|---|---|---|
| D1 | IPC | `[2.0, 3.0]` (variaciones %) | — | 105.060,00 | 1,0506 | CP-05 |
| D2 | IPC | `[]` | — | 100.000,00 | 1 | CP-06 |
| D3 | ICL | `[100, 120]` (niveles) | — | 120.000,00 | 1,2 | CP-04 |
| D4 | ICL | `[]` | — | 100.000,00 | 1 | CP-07 |
| D5 | ICL | `[100]` | — | 100.000,00 | 1 | CP-08 |
| D6 | CCP | CVS `[2.0]`, CER `[1.5]` | — | 101.500,00 (min(0,9·2,0; 1,5) = 1,5 %) | 1,015 | CP-09 |
| D7 | CCP | CVS `[1.0]`, CER `[1.5]` | — | 100.900,00 (min(0,9; 1,5) = 0,9 %) | 1,009 | CP-09 |
| D8 | Porcentaje fijo | — | 10,00 | 110.000,00 | 1,1 | CP-01 |
| D9 | Porcentaje fijo | — | null | 100.000,00 | 1 | CP-10 |
| D10 | Personalizado | — | 7,50 | 107.500,00 | 1,075 | CP-10 |
| D11 | IPC | `[2.0, 3.0]` | 10,00 (ignorado) | 105.060,00 | 1,0506 | CP-05 |

La regla D1 es la que el informe de tesis señala como la más fácil de
equivocar: 2 % y 3 % encadenados dan 5,06 %, no 5 %. D6 y D7 hoy no se
pueden cumplir en `ContractAdjustmentService` porque CCP cae al valor por
defecto (DEF-03).

## Casos unitarios

Además de los casos del servicio, la tabla de decisión completa (D1 a D11
más límites de redondeo, deflación, inicio cero y series de distinta
longitud) se verifica directamente sobre el motor en
`packages/shared/src/adjustment-engine/adjustment-engine.spec.ts` (18 casos).
Resultado del día 3: 91 casos unitarios en el módulo (eran 18), cobertura
94,81 % líneas / 86,31 % ramas (era 44,89 % / 25,26 %).

| ID | Requisito | Técnica | Entrada | Esperado | Prueba | Estado |
|---|---|---|---|---|---|---|
| CP-01 | RF-12 | decisión D8 | contrato fijo 10 % | 55.000 sobre 50.000 | `contract-adjustment.service.spec.ts::returns projected rent for FixedPercent contract` | verde |
| CP-02 | RF-12 | equivalencia | contrato inexistente | `NotFoundException` | `::throws NotFoundException when contract not found` | verde |
| CP-03 | RF-12 | equivalencia | sin cronograma pendiente | período = mes actual | `::falls back to today when no pending schedule exists` | verde |
| CP-04 | RF-12 | decisión D3 | ICL 100 → 120 | 60.000 sobre 50.000 | `::correctly computes ICL factor when index data present` | verde |
| CP-05 | RF-12 | decisión D1, D11 | IPC `[2.0, 3.0]` | factor 1,0506 | pendiente día 3 | verde |
| CP-06 | RF-12 | decisión D2 | IPC sin datos | factor 1 | ver spec del módulo | verde |
| CP-07 | RF-12 | decisión D4 | ICL sin datos | factor 1 | ver spec del módulo | verde |
| CP-08 | RF-12 | límite | ICL un valor | factor 1 | ver spec del módulo | verde |
| CP-09 | RF-12 | decisión D6, D7 | CCP con CVS y CER | min(0,9·CVS, CER) | pendiente (hoy DEF-03) | pendiente |
| CP-10 | RF-12 | decisión D9, D10 | fijo sin pct; personalizado 7,5 | factor 1; 1,075 | ver spec del módulo | verde |
| CP-11 | RF-12 | límite | alquiler 0 | factor 1 sin división por cero | ver spec del módulo | verde |
| CP-12 | RF-12 | equivalencia | sin cronogramas vencidos | `[]` y ninguna escritura | ver spec del módulo | verde |
| CP-13 | RF-12, RF-13 | decisión | vencido fijo 10 % | alquiler actualizado, cronograma `Applied`, auditoría con valores previos y nuevos | ver spec del módulo | verde |
| CP-14 | RF-12, RF-13 | decisión D1 | vencido IPC `[2.0, 3.0]` | delta informado 5.060,00 (hoy DEF-02 informa 0) | pendiente | pendiente |
| CP-15 | RF-12 | equivalencia | dos vencidos, el primero falla en la transacción | el segundo se aplica igual | ver spec del módulo | verde |
| CP-16 | RF-12 | límite | seis periodicidades + desconocida | tabla de meses | ver spec del módulo | verde |
| CP-17 | RF-12 | límite | fin de mes, cambio de año, bisiesto | tabla de fechas | ver spec del módulo | verde |
| CP-18 | RF-14 | equivalencia | `findAll({})` | `page 1`, `limit 50`, `skip 0` | ver spec del módulo | verde |
| CP-19 | RF-14 | equivalencia | filtros `indexType`, `periodFrom`, `periodTo` | `where` con tipo y rango | ver spec del módulo | verde |
| CP-20 | RF-14 | límite | `page 0`, `limit 101`, `limit 100`, `page 1` | 400, 400, ok, ok | ver spec del módulo | verde |
| CP-21 | RF-14 | equivalencia | `periodFrom` no fecha | 400 `VALIDATION_ERROR` | ver spec del módulo | verde |
| CP-22 | RF-14 | equivalencia | `create` válido | `upsert` por (inmobiliaria, tipo, período) | ver spec del módulo | verde |
| CP-23 | RF-14 | límite | 6 y 7 decimales, negativo, número | tabla de precisión | ver spec del módulo | verde |
| CP-24 | RF-14 | equivalencia | `indexType` fuera del enum | 400 | ver spec del módulo | verde |
| CP-25 | RF-14 | equivalencia y límite | `createBulk` con no-array, `[]`, 3 ítems | 400, `[]`, 3 upserts | ver spec del módulo | verde |
| CP-26 | RF-14 | equivalencia | `delete` inexistente / existente | 404 / `{deleted: true}` | ver spec del módulo | verde |
| CP-27 | RF-14 | equivalencia | `getForPeriod` | rango inclusivo ordenado ascendente | ver spec del módulo | verde |
| CP-28 | RF-14 | equivalencia | `findLatest` con un tipo sin filas | ese tipo no aparece | ver spec del módulo | verde |
| CP-29 | RF-14 | equivalencia | BCRA responde 500 | `[]` y error registrado | ver spec del módulo | verde |
| CP-30 | RF-14 | equivalencia | BCRA falla por TLS | reintento y advertencia | ver spec del módulo | verde |
| CP-31 | RF-14 | equivalencia | INDEC JSON vacío, CSV con filas inválidas | parsea el CSV, descarta inválidas, últimas 24 | ver spec del módulo | verde |
| CP-32 | RF-14 | equivalencia | un `upsert` falla | cuenta los demás y sigue | ver spec del módulo | verde |
| CP-33 | RF-14 | límite | períodos `2026-04-14` y `2026-02` | fechas UTC a medianoche; mensual al día 1 | ver spec del módulo | verde |
| CP-34 | RF-14 | equivalencia | `findAll` con `page="2"` | número 2 | ver spec del módulo | verde |
| CP-35 a CP-39 | RF-14 | (ya existentes) | scraper y tarea programada | ver `index-scraper.service.spec.ts`, `index-scraper.scheduler.spec.ts` | verde |

## Casos de integración de API (PostgreSQL real)

| ID | Requisito | Entrada | Esperado | Prueba | Estado |
|---|---|---|---|---|---|
| CP-40 a CP-49 | RF-14, RF-12 | CRUD, `latest`, `refresh`, RBAC, aislamiento, previsualización | ver suite | `test/e2e/index-data.e2e-spec.ts` (17 casos) | verde |
| CP-53 | RF-14 | `POST /refresh` con scraper que devuelve filas, luego `GET /latest` | las filas obtenidas aparecen para la inmobiliaria | pendiente (hoy DEF-01) | pendiente |
| CP-54 | RF-12, RF-14 | contrato IPC sin carga manual, `refresh`, `preview-adjustment` | factor calculado con los índices obtenidos | pendiente (hoy DEF-01) | pendiente |

## Casos de integración externa

| ID | Fuente | Esperado | Prueba | Estado |
|---|---|---|---|---|
| CP-50 | BCRA ICL, respuesta grabada | parser produce filas `{period, value, source}` idénticas a la fixture | pendiente día 4 | pendiente |
| CP-51 | BCRA v4.0 variable 40 y 31, entorno real | HTTP 200, `results[0].detalle[]` con `fecha` ISO y `valor` numérico, al menos una fila en 60 días | pendiente | pendiente |
| CP-52 | INDEC series, entorno real | HTTP 200, `data[]` de pares `[fecha, valor]` | pendiente | pendiente |

## Smoke y carga

| ID | Qué | Esperado | Estado |
|---|---|---|---|
| CP-60 | Despliegue nuevo: `/api/health`, registro, `GET /api/index-data` | 200 `ok`/`connected`, 201, 200 con paginación | pendiente |
| CP-70 | Stress: 50 VU, 2 min, `GET /api/index-data` | p95 < 500 ms, errores < 1 % | pendiente |
| CP-71 | Esfuerzo sostenido: 10 VU, 10 min | p95 estable (crecimiento < 20 %), errores < 1 % | pendiente |
