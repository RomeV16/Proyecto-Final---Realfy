# Catálogo de casos de prueba

Versión 1.4 — 31 de octubre de 2026 (1.0: 19 de octubre; 1.1: 20 de octubre; 1.2: 28 de octubre; 1.3: 30 de octubre). El resultado esperado de cada caso se
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
| D2 | IPC | `[]` | — | error `MISSING_INDEX_DATA` (antes de DEF-26: 100.000,00) | — | CP-06 |
| D3 | ICL | `[100, 120]` (niveles) | — | 120.000,00 | 1,2 | CP-04 |
| D4 | ICL | `[]` | — | error `MISSING_INDEX_DATA` (antes de DEF-26: 100.000,00) | — | CP-07 |
| D5 | ICL | `[100]` | — | error `MISSING_INDEX_DATA` (antes de DEF-25: 100.000,00) | — | CP-08 |
| D6 | CCP | CVS `[2.0]`, CER `[1.5]` | — | 101.500,00 (min(0,9·2,0; 1,5) = 1,5 %) | 1,015 | CP-09 |
| D7 | CCP | CVS `[1.0]`, CER `[1.5]` | — | 100.900,00 (min(0,9; 1,5) = 0,9 %) | 1,009 | CP-09 |
| D8 | Porcentaje fijo | — | 10,00 | 110.000,00 | 1,1 | CP-01 |
| D9 | Porcentaje fijo | — | null | error `MISSING_ADJUSTMENT_PCT` (antes de DEF-25: 100.000,00) | — | CP-10 |
| D10 | Personalizado | — | 7,50 | 107.500,00 | 1,075 | CP-10 |
| D11 | IPC | `[2.0, 3.0]` | 10,00 (ignorado) | 105.060,00 | 1,0506 | CP-05 |

La tabla describe el primer ajuste de un contrato. Desde el segundo, los
índices se toman desde el último ajuste aplicado y no desde el inicio
(DEF-07): lo verifican CP-55 a CP-58. Los tres caminos que calculan un
ajuste (manual, previsualización y barrido) aplican la misma tabla desde DEF-25 y
DEF-26: CP-270 a CP-272.

La regla D1 es la que el informe de tesis señala como la más fácil de
equivocar: 2 % y 3 % encadenados dan 5,06 %, no 5 %. D6 y D7 no se cumplían
en `ContractAdjustmentService` hasta el día 5 porque CCP caía al valor por
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
| CP-09 | RF-12 | decisión D6, D7 | CCP con CVS y CER | min(0,9·CVS, CER) | `contract-adjustment.service.spec.ts::CP-09` | verde (DEF-03 corregido) |
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
| CP-27 | RF-14 | equivalencia | `getForPeriod`, con y sin `startExclusive` | rango inclusivo ordenado ascendente; con `startExclusive`, sin la fecha de inicio | ver spec del módulo | verde |
| CP-28 | RF-14 | equivalencia | `findLatest` con un tipo sin filas | ese tipo no aparece | ver spec del módulo | verde |
| CP-29 | RF-14 | equivalencia | BCRA responde 500 | `[]` y error registrado | ver spec del módulo | verde |
| CP-30 | RF-14 | equivalencia | BCRA falla por TLS | reintento y advertencia | ver spec del módulo | verde |
| CP-31 | RF-14 | equivalencia | INDEC JSON vacío, CSV con filas inválidas | parsea el CSV, descarta inválidas, últimas 24 | ver spec del módulo | verde |
| CP-32 | RF-14 | equivalencia | un `upsert` falla | cuenta los demás y sigue | ver spec del módulo | verde |
| CP-33 | RF-14 | límite | períodos `2026-04-14` y `2026-02` | fechas UTC a medianoche; mensual al día 1 | ver spec del módulo | verde |
| CP-34 | RF-14 | equivalencia | `findAll` con `page="2"` | número 2 | ver spec del módulo | verde |
| CP-35 a CP-39 | RF-14 | (ya existentes) | scraper y tarea programada | ver `index-scraper.service.spec.ts`, `index-scraper.scheduler.spec.ts` | verde |
| CP-55 | RF-12 | decisión | IPC con un ajuste aplicado en abril (2; 3; 1 %) y 4 % en mayo, alquiler 106.110,60 | solo encadena el 4 %: 110.355,02, factor 1,04 | `contract-adjustment.service.spec.ts::CP-55` | verde (DEF-07 corregido) |
| CP-56 | RF-12 | decisión | ICL 100 / 110 / 121 con un ajuste aplicado en abril, alquiler 55.000 | 121 / 110: 60.500, factor 1,1 | `contract-adjustment.service.spec.ts::CP-56` | verde (DEF-07 corregido) |
| CP-57 | RF-12, RF-13 | equivalencia | barrido con dos cronogramas vencidos del mismo contrato, fijo 10 % sobre 50.000 | 55.000 y después 60.500 | `contract-adjustment.service.spec.ts::CP-57` | verde (DEF-08 corregido) |

## Casos de integración de API (PostgreSQL real)

| ID | Requisito | Entrada | Esperado | Prueba | Estado |
|---|---|---|---|---|---|
| CP-40 a CP-49 | RF-14, RF-12 | CRUD, `latest`, `refresh`, RBAC, aislamiento, previsualización | ver suite | `test/e2e/index-data.e2e-spec.ts` (17 casos) | verde |
| CP-53 | RF-14 | `POST /refresh` con red sustituida, luego `GET /index-data` y `GET /latest`; carga manual del mismo período; otra inmobiliaria | las filas obtenidas aparecen; la manual gana; el aislamiento se mantiene | `test/e2e/index-data-scraper.e2e-spec.ts` (3 casos) | verde (DEF-01 corregido) |
| CP-54 | RF-12, RF-14 | contrato IPC sin carga manual, `refresh`, `preview-adjustment` | factor 1,050600 y alquiler 105.060,00 con los índices obtenidos | `test/e2e/index-data-scraper.e2e-spec.ts` | verde (DEF-01 y DEF-06 corregidos) |
| CP-58 | RF-12, RF-13 | contrato IPC trimestral por 150.000 con IPC de enero a julio; calcular y aplicar abril, calcular julio | abril 165.532,54; julio 171.384,28 | `test/e2e/contracts.e2e-spec.ts::CP-58` | verde (DEF-07 corregido) |
| CP-80 | FB-24 | borrador completo (propietario, inquilino, fechas válidas) sobre una propiedad con operación de alquiler `Disponible`, `POST /contracts/:id/activate`; otra variante sin operación de alquiler; otra desde `Borrador` | 201 con el contrato en `Activo`; la operación queda en `Alquilado` (se crea ya alquilada si no existía; recorre `Disponible` y `Reservado` si partía de `Borrador`) | `test/e2e/contract-activation.e2e-spec.ts::POST /contracts/:id/activate` (3 casos) | verde |
| CP-81 | FB-24 | borrador sin inquilino; borrador sin locadores ni inquilino; segundo alquiler cuyas fechas se pisan con uno activo | 400 `CONTRACT_NOT_ACTIVATABLE` con la lista `problems` (`MISSING_INQUILINO`; `LESSOR_SHARES_INVALID` y `MISSING_INQUILINO`; `OVERLAPPING_CONTRACT` con el id del otro contrato); el contrato sigue en `Borrador` y la propiedad no cambia | `test/e2e/contract-activation.e2e-spec.ts::requisitos faltantes` (3 casos) | verde |
| CP-82 | FB-24 | activar un contrato ya `Activo`; activar uno `Rescindido`; id inexistente | 400 `INVALID_TRANSITION` con `validTransitions` (`Vencido`, `Rescindido`, `Renovado`; `Archivado`); 404 `CONTRACT_NOT_FOUND` | `test/e2e/contract-activation.e2e-spec.ts::transición inválida` (3 casos) | verde |
| CP-83 | FB-24 | activar con Gerente, Ventas, Lectura, Liquidaciones, Soporte, Marketing y sin token | Gerente y Ventas 201; los otros cuatro roles 403 `FORBIDDEN` sin cambiar el contrato; sin token 401 | `test/e2e/contract-activation.e2e-spec.ts::roles` (7 casos) | verde |
| CP-84 | FB-24 | administrador de otra inmobiliaria activa un contrato ajeno | 404 `CONTRACT_NOT_FOUND`; el contrato y la propiedad no cambian | `test/e2e/contract-activation.e2e-spec.ts::aislamiento entre inmobiliarias` | verde |
| CP-85 | aislamiento (ADR-0006) | archivo subido por la inmobiliaria A, `validate` y `execute` con ese `fileId` desde la inmobiliaria B; luego `execute` desde A | B recibe 404 `FILE_NOT_FOUND` en ambos, no se crean propiedades en B y A importa sus 2 filas (esperado fijado antes) | `test/e2e/import-export.e2e-spec.ts::CP-85`, `import-export.service.spec.ts::CP-85` | verde (DEF-09 corregido) |
| CP-160 | facturación (ítem 38) | `POST /invoices/emit` sin `paymentId` | 201 y la fila queda con `paymentId` nulo (esperado fijado antes) | `test/e2e/invoices.e2e-spec.ts::emite una factura sin paymentId` | verde (DEF-16 corregido) |
| CP-161 | facturación (ítem 38) | factura vinculada a un pago; borrar el pago | el comprobante sigue en la base con `paymentId` nulo y el mismo CAE | `test/e2e/invoices.e2e-spec.ts::borrar un pago no borra el comprobante` | verde (DEF-16 corregido) |
| CP-162 | facturación (ítem 38) | `monId` `DOL` con cotización 1050,5 | la fila guarda `currency` USD, `monId` DOL y la cotización; `monId` desconocido responde 400 `UNSUPPORTED_CURRENCY` antes de pedir el CAE | `test/e2e/invoices.e2e-spec.ts::guarda la moneda del DTO` | verde (DEF-16 corregido) |
| CP-163 | facturación (ítem 38) | el organismo devuelve el CAE y el guardado de la fila falla (una vez, y de forma persistente) | con un fallo se reintenta y se devuelve el comprobante; si persiste, 500 `COMPROBANTE_PERSIST_FAILED` con CAE y número y un registro `persistComprobante` en el registro de pedidos | `invoices.service.extra.spec.ts::persistencia del comprobante despues del CAE` | verde (DEF-16 corregido) |

## Casos de integración externa

| ID | Fuente | Esperado | Prueba | Estado |
|---|---|---|---|---|
| CP-50 | BCRA ICL y UVA, INDEC JSON y CSV, respuestas grabadas el 19 oct 2026 | el parser produce las filas esperadas; la fixture del INDEC evidencia DEF-06 | `test/integration/external.contract.spec.ts` (5 casos) | verde |
| CP-51 | BCRA v4.0 variable 40 y 31, entorno real | HTTP 200, `results[0].detalle[]` con `fecha` ISO y `valor` numérico en rango, ≥ 30 filas, la más reciente de menos de 10 días | `test/integration/external.real.spec.ts` | verde (19 oct) |
| CP-52 | IPC en entorno real: CSV del INDEC y variable 27 del BCRA | HTTP 200; CSV con la columna de variación mensual en la posición 9 y su último mes con menos de 120 días; BCRA con un dato por mes, en porcentaje, y su último mes con menos de 120 días | `test/integration/external.real.spec.ts` (3 casos) | rojo (28 oct, API de series); verde (30 oct, con las fuentes nuevas) |

## Smoke y carga

| ID | Qué | Esperado | Estado |
|---|---|---|---|
| CP-60 | Despliegue nuevo: salud, registro, listado, carga manual, último valor, 401 sin token | 6 pasos en verde (`test/smoke/smoke.mjs`) | verde en local (API compilada en modo producción); en el pipeline sobre la imagen Docker |
| CP-70 | Stress: 50 VU, 2 min, `GET /api/index-data` | p95 < 500 ms, errores < 1 % | pendiente |
| CP-71 | Esfuerzo sostenido: 10 VU, 10 min | p95 estable (crecimiento < 20 %), errores < 1 % | pendiente |

## Casos de fechas y dinero (ítem 35)

Reservados CP-130 a CP-139 (CP-137 a CP-139 se agregan con 0.4b). El resultado esperado se fijó antes de corregir cada defecto.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-130 | Cronograma de ajustes de un contrato que empieza el 31 de enero, período trimestral y mensual; período desconocido | 30 abr, 31 jul y 31 oct (mensual: 28 feb, 31 mar, 30 abr, 31 may); un período desconocido lanza en lugar de asumir trimestral. Regla: `inicio + k períodos` con recorte a fin de mes | `contracts/contract-schedule.spec.ts` (3 casos); `index-data/contract-adjustment.service.spec.ts::CP-16` | verde (DEF-10 corregido) |
| CP-131 | Períodos y meses de documentos con el proceso en `America/Argentina/Buenos_Aires` | flujo de caja de un trimestre: 3 renglones; período de liquidación `2025-03-01T00:00:00.000Z` y vencimiento el 10 a medianoche UTC; filtros de mes y de año de liquidaciones y rendiciones en UTC; asunto "Liquidación 03/2025". Regla: las fechas sin hora son medianoche UTC | `reports/reports.service.spec.ts`, `liquidaciones/liquidaciones-periodos.spec.ts`, `renditions/renditions-periodos.spec.ts`, `liquidaciones/email.service.spec.ts` (7 casos); `pnpm --filter @realfy/api test:tz-ar` | verde (DEF-11 corregido) |
| CP-132 | Rendición: totales contra líneas | tres pagos de 33,333: cobrado 99,99 y neto 96,49 (comisión 3,5 %); dos deducciones de 10,005: total 20,02 y neto 979,98; en todo caso el total es la suma de las líneas. Regla: un documento suma lo que muestra | `packages/shared/src/rendicion-engine/rendicion-engine.spec.ts` (3 casos) | verde (DEF-12 corregido) |
| CP-133 | Liquidación: signo de los renglones y total | un renglón negativo de cualquier tipo lanza `INVALID_LINE_AMOUNT`; 20,005 de subtotal y 10,004 de descuentos dan total 10,01; 0,005 y 0,004 dan 0,01. Regla: total = subtotal redondeado menos descuentos redondeados | `packages/shared/src/liquidacion-engine/liquidacion-engine.spec.ts` (7 casos) | verde (DEF-13 corregido) |
| CP-134 | Comisión: porcentaje y montos fuera de rango | porcentaje 150, 100,01, -1 o -0,01, cobrado, monto fijo o gastos negativos lanzan `INVALID_COMMISSION`; 0 y 100 son válidos; `POST /contracts/:id/commission` con 150,00 responde 400 `VALIDATION_ERROR`. Regla: el porcentaje está entre 0 y 100 | `packages/shared/src/commission-engine/commission-engine.spec.ts` (6 casos); `test/e2e/renditions.e2e-spec.ts::CP-134` | verde (DEF-14 corregido) |
| CP-135 | Paridad de `LiquidacionStatus` con Prisma, incluido `Pendiente` | sin excepciones registradas; la máquina de estados cubre todos los valores del enum y `Pendiente` no tiene transiciones | `test/unit/enum-parity.spec.ts`; `liquidacion-state-machine.spec.ts` | verde (DEF-15 corregido) |
| CP-136 | Utilidades compartidas de fechas (`addMonthsClamped`, `periodToMonths`, `monthStartUTC`, `periodFilter`, `periodKey`, `todayInAR`, `formatDateAR`) y de dinero (`Money`, `round2`, `toAmountString`, `sumMoney`, `allocateLargestRemainder`) | años bisiestos y fines de mes (31 ene + 1 = 28/29 feb; 29 feb + 12 = 28 feb), 02:00 UTC es el día anterior en Buenos Aires, el reparto de 100 en tres suma exactamente 100,00 y `Money` no cambia el `Decimal` global | `packages/shared/src/date-utils/date-utils.spec.ts`, `packages/shared/src/money/money.spec.ts`, `reports/compute-next-run-at.spec.ts` | verde (31 oct) |
| CP-137 | PDF de liquidación: propiedad | título "Depto Palermo" imprime `Propiedad: Depto Palermo`; sin título, `Propiedad: Av. Santa Fe 1234, piso 3 B`; sin propiedad, `Propiedad: —`. Regla: título si existe, si no calle, número y unidad | `liquidaciones/liquidaciones-pdf.spec.ts` (3 casos); `packages/shared/src/format.spec.ts` (6 casos) | verde (DEF-17 corregido) |
| CP-138 | Punitorio sobre saldo y en el día de Buenos Aires | total 1000 con pago de 600, 10 días de mora y 1 % diario: 40 sobre base 400; pagada por completo: no devenga; a las 22:30 AR del 10/03 aplica el 10/03 con 5 días de mora. Regla: la base es el saldo pendiente | `penalties/penalties.scheduler.spec.ts` (3 casos) | verde (DEF-18 corregido) |
| CP-139 | Deuda: un solo criterio sobre el saldo pendiente | con L1 Vencida 250000 (pagó 100000), L2 Enviada 90000 a vencer, L3 Enviada 60000,50 vencida (pagó 10000,25) y L4 Pagada: pagos pendiente 1 por 90000 y vencida 2 por 200000; panel total 360000, pendiente 90000, vencida 200000, tasa 19 %, morosidad 56 %; contexto diario 200000 y 90000; morosidad 200000,25; morosos 200000,25. Regla: deuda = saldo (total menos pagos) de las liquidaciones por cobrar; vencida = Vencida, o Enviada con vencimiento anterior a hoy | `liquidaciones/deuda-lectores.spec.ts` (5 casos), `liquidaciones/receivables.spec.ts`, `liquidacion-state-machine.spec.ts` | verde (DEF-19 corregido) |

## Casos de deuda, pagos y avisos (ítem 35, 0.4b)

El resultado esperado se fijó antes de corregir cada defecto.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-240 | Ajuste automático sin datos de índice | IPC o ICL sin valores, o CCP con CVS y sin CER: el cronograma sigue pendiente, no se actualiza el alquiler ni se audita, y se registra `MISSING_INDEX_DATA` con contrato, cronograma e índices; un contrato sin datos no frena a los demás; con datos se aplica. Regla: sin dato no hay ajuste | `index-data/contract-adjustment.service.spec.ts` (5 casos) | verde (DEF-20 corregido) |
| CP-241 | Pagos simultáneos | saldo 150000: dos pagos de 100000 en paralelo dan un 200 y un 400 `PAYMENT_EXCEEDS_BALANCE` y un solo pago registrado; cinco de 40000 dan tres 200 y dos 400, con 120000 pagados y saldo no negativo. Regla: la validación del saldo y el alta del pago son atómicas | `test/e2e/liquidaciones.e2e-spec.ts` (2 casos) | verde (DEF-21 corregido) |
| CP-242 | Aviso de vencimiento de contrato | un contrato a 25 días y dos usuarios: dos corridas el mismo día dan 2 avisos y 2 mails; ocho días consecutivos dan 3 avisos por usuario (30, 15 y 7 días); un contrato que entra a 6 días recibe uno; a 44 días ninguno; los cuatro crons de avisos corren en `America/Argentina/Buenos_Aires`. Regla: un aviso por usuario, contrato y umbral | `notifications/notification-scheduler.service.spec.ts` (7 casos) | verde (DEF-22 corregido) |
| CP-243 | Rendición: pagos y deducciones negativos | una deducción de -5000 o un pago de -20000 lanzan `INVALID_LINE_AMOUNT` con la descripción del renglón; el cero es válido. Regla: ningún renglón de la rendición es negativo | `packages/shared/src/rendicion-engine/rendicion-engine.spec.ts` (4 casos) | verde (DEF-23 corregido) |

## Casos de usuarios, invitaciones y contraseña (ítem 32)

Banda CP-100 a CP-109. Origen: FB-26. El resultado esperado se fijó antes de implementar. Todos los casos de API corren en `test/e2e/users-management.e2e-spec.ts` salvo que se indique otra prueba.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-100 | Invitar un usuario | el Admin recibe 201 con `token` de al menos 32 bytes, `link` con `?token=` y `expiresAt` a 7 días; en base la invitación guarda `SHA-256(token)` y nunca el token, con el rol y la inmobiliaria del Admin; Gerente, Ventas y Lectura reciben 403 y sin sesión 401; un correo ya usuario da 400 `USER_ALREADY_EXISTS`, uno con invitación vigente 409 `INVITATION_ALREADY_PENDING` (sin distinguir mayúsculas), rol o correo inválidos 400. Regla: solo el Admin invita y el secreto no se guarda | `users-management.e2e-spec.ts::CP-100` (6 casos); `users/users.service.spec.ts` | verde (31 oct) |
| CP-101 | Aceptar y reenviar una invitación | aceptar crea el usuario con el rol invitado y permite ingresar; usar el mismo token otra vez da 400 `INVITATION_ALREADY_ACCEPTED`; vencida 400 `INVITATION_EXPIRED`; inexistente, o el hash que está en la base usado como token, 400 `INVITATION_NOT_FOUND`; contraseña de menos de 8 caracteres 400; reenviar rota el token (el anterior da `INVITATION_NOT_FOUND`) y renueva el plazo; reenviar con Gerente, Ventas o Lectura da 403, con una invitación de otra inmobiliaria 404 y con una ya aceptada 404. Regla: el token es de un solo uso y reenviar invalida el anterior | `users-management.e2e-spec.ts::CP-101` (5 casos); `invitation-flow.e2e-spec.ts` | verde (31 oct) |
| CP-102 | Listado del equipo con estados | `GET /users` devuelve activos, desactivados e invitaciones pendientes con `status` `active`, `inactive` e `invited`, sin tokens ni hashes de contraseña, y solo los de la inmobiliaria propia; Admin y Gerente leen, Ventas y Lectura reciben 403 | `users-management.e2e-spec.ts::CP-102` (2 casos) | verde (31 oct) |
| CP-103 | Cambio de rol | `PATCH /users/:id` cambia el rol para el Admin y da 403 a los demás; rol inválido 400; usuario de otra inmobiliaria 404 `USER_NOT_FOUND`; degradar al último Admin activo da 409 `LAST_ADMIN` y con otro Admin activo se permite; el cambio rige en el pedido siguiente (un Gerente degradado a Lectura recibe 403 con el mismo token). Regla: la inmobiliaria nunca queda sin un Admin activo | `users-management.e2e-spec.ts::CP-103` (3 casos) y `CP-104` (rige de inmediato); `users/users.service.spec.ts` | verde (31 oct) |
| CP-104 | Baja y reactivación | desactivar cierra las sesiones (refresco revocado), bloquea el ingreso y hace que el token de acceso vigente dé 401; reactivar devuelve el ingreso; desactivarse a uno mismo da 400 `CANNOT_DEACTIVATE_SELF`; desactivar al último Admin da 409 `LAST_ADMIN` (unitaria); usuario de otra inmobiliaria 404; roles distintos de Admin 403 | `users-management.e2e-spec.ts::CP-104` (5 casos); `users/users.service.spec.ts` | verde (31 oct) |
| CP-105 | Cambio de contraseña propia | con la actual equivocada 400 `INVALID_CURRENT_PASSWORD`; la nueva de menos de 8 caracteres 400; con la correcta responde 204, la sesión desde la que se cambia puede renovar su refresco y las demás quedan revocadas; la contraseña vieja ya no ingresa y la nueva sí; sin sesión 401. Regla: cambiar la contraseña cierra las otras sesiones | `users-management.e2e-spec.ts::CP-105` (2 casos) | verde (31 oct) |
| CP-106 | Pedido de recupero sin enumeración | con una cuenta existente y con una inexistente la respuesta es 202 con el mismo cuerpo; sin servicio de correo configurado no se crea ningún token ni se envía nada; un correo mal formado da 400. Regla: la respuesta no revela quién tiene cuenta | `users-management.e2e-spec.ts::CP-106` (2 casos); `auth/password-reset.service.spec.ts` | verde (31 oct) |
| CP-107 | Enlace de recupero generado por el Admin | `POST /users/:id/password-reset-link` da 201 con enlace que vence en 1 hora y en base solo el hash; confirmar con contraseña de menos de 8 caracteres da 400 y con una válida 204 y revoca todas las sesiones del usuario; usar el enlace de nuevo da 400 `PASSWORD_RESET_USED`; un enlace nuevo invalida el anterior; vencido 400 `PASSWORD_RESET_EXPIRED`; inexistente 400 `PASSWORD_RESET_INVALID`; para un usuario dado de baja 400 `USER_INACTIVE`; roles distintos de Admin 403 y usuario de otra inmobiliaria 404 sin crear tokens. Regla: un solo uso y una hora de vida | `users-management.e2e-spec.ts::CP-107` (4 casos); `auth/password-reset.service.spec.ts` | verde (31 oct) |
| CP-108 | Bitácora de las operaciones de usuarios | el cambio de rol, la baja y la generación de un enlace dejan un registro del Admin con `changes.operation` (`role-change`, `deactivate`, `password-reset-link`) y el usuario afectado como `entityId`; ni los tokens, ni `currentPassword` ni `newPassword` aparecen en ningún registro | `users-management.e2e-spec.ts::CP-108` | verde (31 oct) |
| CP-109 | Reglas del token y pantallas web | un token tiene al menos 32 bytes aleatorios, no se repite y su hash es SHA-256 de 64 hex; el vencimiento es de 7 días para invitaciones y de 1 hora para recupero; cambio de contraseña, pedido y confirmación de recupero, y aceptar invitación tienen un límite de 5 intentos por minuto. En la web: el Admin ve y usa la gestión del equipo, el Gerente la ve sin botones, Ventas y Lectura no la ven ni la piden; el diálogo del enlace avisa que es de un solo uso y que vence, y copia; las pantallas de aceptar invitación, recuperar y cambiar contraseña validan antes de enviar y traducen cada código de error | `common/auth/one-time-token.spec.ts`; `test/unit/credentials-throttle.spec.ts`; `apps/web/src/components/users/team-manager.test.tsx`; `components/auth/auth-forms.test.tsx`; `lib/permissions.test.tsx` | verde (31 oct) |

## Casos de permisos por rol (ítem 32)

Banda CP-257 a CP-265 (la banda CP-100 a CP-109 se llenó con los casos de usuarios). Origen: FB-03. El resultado esperado se fijó antes de implementar. Los casos de API corren en `test/e2e/read-policy.e2e-spec.ts` salvo que se indique otra prueba.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-257 | Grupos de roles y paridad de rutas | cada grupo (`MANAGEMENT_ROLES`, `SALES_ROLES`, `BILLING_ROLES`, `BILLING_VIEW_ROLES`, `SUPPORT_ROLES`, `MARKETING_ROLES`, `SALES_MARKETING_ROLES`, `BILLING_READ_ROLES`, `ADMIN_ONLY`, `ALL_STAFF`) tiene exactamente los roles esperados; los roles efectivos de cada ruta de cada controlador coinciden con la referencia tomada antes de reemplazar las listas escritas a mano, y las rutas nuevas solo se suman. Regla: sacar las listas no cambia quién puede qué | `apps/api/test/unit/role-groups.spec.ts`, `find-staff.spec.ts` | verde |
| CP-258 | Política por defecto: nada cambia | sin política guardada, los siete roles leen persona, cuentas, rendiciones, facturas, reportes, auditoría y comisión como antes (ninguna respuesta es `READ_FORBIDDEN`), con `dni` y `cuit` a la vista; `GET /tenants/me/read-policy` devuelve todos los roles en todos los recursos y `read-access` todo en `true` | `read-policy.e2e-spec.ts::CP-258` | verde |
| CP-259 | Cuentas bancarias restringidas | con `persons.bankAccounts` solo para Admin y Liquidaciones, Ventas recibe 403 `READ_FORBIDDEN` con `resource` en el cuerpo; Liquidaciones y Admin leen; `read-access` de Ventas dice `false` solo para ese recurso | `read-policy.e2e-spec.ts::CP-259` | verde |
| CP-260 | Enmascarado de documento y cuentas | con `persons.document` solo para Admin y Gerente y `persons.bankAccounts` solo para Admin: Ventas lee la persona (200) con `dni`, `cuit` y `bankAccounts` en `null` y el resto intacto, también en el listado; Gerente ve el documento pero no las cuentas; Admin ve todo; la base no se modifica | `read-policy.e2e-spec.ts::CP-260`, `read-policy.spec.ts` | verde |
| CP-261 | Recursos con política | con rendiciones, facturas, reportes financieros, auditoría y comisión solo para Admin, el Gerente recibe 403 `READ_FORBIDDEN` en cada ruta y el Admin no | `read-policy.e2e-spec.ts::CP-261` | verde |
| CP-262 | Aislamiento de la política | restringir una inmobiliaria no afecta a otra: el Ventas de la segunda sigue leyendo cuentas y documento, su política sigue en el valor por defecto y su `readPolicy` en la base es `null` | `read-policy.e2e-spec.ts::CP-262` | verde |
| CP-263 | Permisos y validación del PUT | solo el Admin lee y cambia la política (los otros seis roles reciben 403 `FORBIDDEN` en GET y PUT); una política sin Admin, con recurso desconocido, con rol inválido o incompleta da 400 `VALIDATION_ERROR`; la guardada se lee igual y volver a abrir todo rige de inmediato | `read-policy.e2e-spec.ts::CP-263`, `read-policy.schema.spec.ts` | verde |
| CP-264 | Falla cerrado | con una política guardada inválida, las rutas con política responden 403 `READ_FORBIDDEN` (también al Admin) en lugar de abrir; las rutas sin política siguen funcionando. En unidad: el guard y el interceptor deniegan si la política no se puede cargar o no hay usuario | `read-policy.e2e-spec.ts::CP-264`, `read-policy.spec.ts` | verde |
| CP-265 | Web: acceso de lectura, menú y pantalla de permisos | `useCanRead` asume que sí mientras consulta, oculta si el rol no puede leer o la consulta falla, y se refresca al guardar; el menú oculta rendiciones, facturas y reportes sin lectura y muestra Permisos solo al Admin; la pantalla lista los siete recursos por rol con el Admin fijo, pide confirmación, guarda con `PUT`, muestra el error de la API y conserva los cambios, y "Abrir todo" restablece el valor por defecto | `read-access.test.tsx`, `read-gate.test.tsx`, `read-policy-manager.test.tsx`, `permissions.test.tsx` | verde |
| CP-266 | Rendición sin mail configurado | con el transporte de mail sin configurar, `POST /renditions/:id/send` responde 422 `EMAIL_NOT_CONFIGURED` y la rendición no queda marcada como enviada (`sentAt` nulo); con envío real se guarda la fecha | `renditions-send-email.spec.ts::CP-266`, `renditions.e2e-spec.ts::CP-266` | verde |
| CP-267 | Rendición sin email del locador | responde 422 `OWNER_EMAIL_MISSING`, no intenta enviar y no marca enviada | `renditions-send-email.spec.ts::CP-267` | verde |

## Casos de personas, referencias y migración (ítem 33)

Banda CP-110 a CP-119, con desborde a CP-244 en adelante (la banda se llenó). Origen: FB-01, FB-02 y el relevamiento de la inmobiliaria piloto. El resultado esperado se fijó antes de implementar.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-110 | Datos de persona: tipo, documento, domicilio, estado civil, nacionalidad y forma de cobro | una persona nueva es `Fisica` y sin forma de cobro; una `Juridica` con `Custodia` y documento queda guardada tal cual; todo es opcional. Regla: los datos nuevos no obligan a nada | `test/e2e/persons-datos.e2e-spec.ts::CP-110` | verde (31 oct) |
| CP-111 | Cuentas bancarias por moneda: una predeterminada por moneda | la primera cuenta de cada moneda es predeterminada aunque se pida lo contrario; la segunda no; `isDefault: true` intercambia solo dentro de su moneda; soltar o borrar la predeterminada con otras vivas responde 409 `BANK_ACCOUNT_DEFAULT_REQUIRED`; CBU de 22 dígitos y moneda ARS o USD (400 `VALIDATION_ERROR`). Regla: por moneda con cuentas hay exactamente una predeterminada | `persons/person-bank-accounts.service.spec.ts` (9 casos); `persons-datos.e2e-spec.ts::CP-111` | verde (31 oct) |
| CP-112 | Una sola fuente de datos bancarios | `bankName`, `cbu` y `bankAlias` en el alta o el PATCH de la persona se guardan como cuenta ARS predeterminada y se actualizan sin duplicar; las columnas viejas quedan en NULL; las respuestas no las devuelven; el export de personas lee de la cuenta | `persons-datos.e2e-spec.ts::CP-112`; `import-export/export.service.spec.ts` | verde (31 oct) |
| CP-113 | Aislamiento de las cuentas bancarias | con la persona de otra inmobiliaria, GET, POST, PATCH y DELETE de cuentas responden 404 y no cambian nada; el listado propio no trae cuentas ajenas | `persons-datos.e2e-spec.ts::CP-113`; `test/unit/tenant-scoped-models.spec.ts` | verde (31 oct) |
| CP-114 | Permisos de las cuentas bancarias | Lectura puede leer y recibe 403 al crear, editar y borrar; Ventas puede escribir. Regla: los mismos roles que gestionan personas | `persons-datos.e2e-spec.ts::CP-114` | verde (31 oct) |
| CP-115 | Referencia externa única por inmobiliaria | en personas, propiedades y contratos: repetirla en la misma inmobiliaria (alta o edición) responde 409 `EXTERNAL_REF_TAKEN`; la misma en otra inmobiliaria se permite; varios registros sin referencia conviven; `?externalRef=` devuelve solo el que coincide | `persons-datos.e2e-spec.ts::CP-115` (3 casos); `common/validation/external-ref.spec.ts` | verde (31 oct) |
| CP-116 | Catastro y edificio padre | una unidad acepta `cadastralId` y un padre de su inmobiliaria y se lista con `?parentPropertyId=`; ser su propio padre da 400 `PROPERTY_SELF_PARENT`, un padre de otra inmobiliaria 404 `PARENT_PROPERTY_NOT_FOUND`, meter el edificio en su unidad 400 `PROPERTY_PARENT_CYCLE`; soltar el padre es válido | `persons-datos.e2e-spec.ts::CP-116` (2 casos) | verde (31 oct) |
| CP-117 | Migración sobre datos sintéticos con forma real: backfill de cuentas bancarias | tras aplicar `personas_datos_y_referencias` sobre los datos de `migration-data/seed.sql`, cada persona con algún dato bancario viejo tiene exactamente una cuenta ARS predeterminada con esos datos, ninguna persona sin datos tiene cuentas, no hay cuentas huérfanas y los conteos de contratos, liquidaciones y pagos no cambian | `scripts/migration-rehearsal.sh`; `apps/api/test/migration-data/checks/` | verde (31 oct) |
| CP-118 | Locadores del contrato: reparto que suma 100 | tres propietarios en el alta quedan como locadores 33.3334 / 33.3333 / 33.3333, marcados para revisar, y no como partes del contrato; locadores 60 + 30 no se activan (400 `CONTRACT_NOT_ACTIVATABLE` con `LESSOR_SHARES_INVALID` y suma 90) y con `PUT` 60 + 40 sí; en un contrato activo un alta que lleva la suma a 150 o quitar al único locador responden 400 `LESSOR_SHARES_INVALID` y no cambian nada, y una cesión (uno sale, otro entra en la misma fecha) es válida; `?at=` devuelve los vigentes; un locador sin rol de propietario puede firmar (se le asigna) y un inquilino sin rol sigue rechazado (400 `INVALID_PERSON_ROLE`); Lectura lee y recibe 403 al escribir, otra inmobiliaria recibe 404. Regla: la suma de los locadores vigentes es exactamente 100 en cada fecha | `packages/shared/src/parties/lessor-shares.spec.ts`; `contracts/contract-activation.spec.ts`; `contracts/contract-lessors.service.spec.ts`; `contracts/contract-parties.spec.ts`; `locadores-apoderados.e2e-spec.ts::CP-118` (5 casos) | verde (31 oct) |
| CP-119 | Migración sobre datos sintéticos: backfill de locadores y titularidad | tras aplicar `locadores_y_apoderados`: cada propietario de un contrato es un locador con `100 / n` (con tres, 33.3333 + 33.3333 + 33.3334), vigente desde el inicio del contrato, marcado para revisar solo si hay más de uno; todos los contratos con propietarios suman exactamente 100; cada asignación `Propietario` con propiedad tiene su titularidad sin porcentaje y la columna `propertyId` sigue con su valor; no hay poderes ni locadores de otra inmobiliaria; las rendiciones existentes siguen y los conteos no cambian | `scripts/migration-rehearsal.sh`; `apps/api/test/migration-data/checks/04_locadores.sql`, `02_datos_sin_cambios.sql` | verde (31 oct) |
| CP-244 | Poderes: alcance, firma indistinta o conjunta, rol y cobrador | un poder general y uno de contrato se listan como poderdante y como apoderado (`?as=agent`), el contrato trae los apoderados vigentes y el apoderado recibe el rol `Apoderado`; dos apoderados con firma conjunta sobre el mismo contrato comparten `groupKey`; alcances vacíos o desconocidos, `groupKey` sin firma conjunta y poder a sí mismo dan 400 (`POWER_SELF`); el cobrador de un locador sin poder de cobro vigente da 400 `PAYEE_WITHOUT_POWER` (un poder solo de firma no alcanza), con poder se acepta y ese poder no se revoca mientras esté en uso (409 `POWER_IN_USE`); la cuenta tiene que ser del locador (400 `BANK_ACCOUNT_NOT_OF_LESSOR`) | `persons/person-powers.service.spec.ts`; `locadores-apoderados.e2e-spec.ts::CP-244` (4 casos) | verde (31 oct) |
| CP-245 | Rendición repartida entre locadores | alquiler 100000.00 con comisión 5 %: tres locadores 33.3334 / 33.3333 / 33.3333 reciben alquiler 33333.40 / 33333.30 / 33333.30, comisión 1666.67 / 1666.67 / 1666.66 y neto 31666.73 / 31666.63 / 31666.64, que suman 95000.00; cada rendición suma lo que muestra; con un locador el resultado es el de antes; generar de nuevo devuelve las mismas y no crea más; sin locadores que sumen 100 no se genera (400 `LESSOR_SHARES_INVALID`). Regla: se reparte el resultado, no cambia ninguna regla de comisión | `packages/shared/src/rendicion-engine/rendicion-engine.spec.ts` (3 casos, uno golden); `renditions/renditions.service.spec.ts`; `renditions.e2e-spec.ts::CP-245` (2 casos) | verde (31 oct) |
| CP-246 | Titularidad de propiedades opcional | se registran titulares con 30 % y sin porcentaje (no hace falta que sumen 100), se listan y se quitan, y el titular recibe el rol `Propietario`; asignar el rol `Propietario` con `propertyId` crea la titularidad y la asignación no guarda `propertyId`; Lectura recibe 403 al escribir y otra inmobiliaria 404; porcentaje fuera de rango y fechas invertidas dan 400 | `properties/property-ownerships.service.spec.ts`; `locadores-apoderados.e2e-spec.ts::CP-246` (3 casos) | verde (31 oct) |
| CP-247 | Una sola fuente de las partes y de los roles | `ensureRole` crea el rol con la inmobiliaria de la persona y es idempotente (también sin petición, en el formulario público); `getParty` y `getParties` devuelven la primera parte o todas; `getLessorsAt` filtra por vigencia y ordena por porcentaje; `getApoderadosAt` busca los poderes del contrato, su propiedad y los generales | `persons/person-roles.service.spec.ts`; `contracts/contract-parties.spec.ts`; `test/unit/tenant-scoped-models.spec.ts` | verde (31 oct) |
| CP-248 | Plantillas con locadores y apoderados | las variables traen `locadores.N.*` con nombre, documento, domicilio, capacidad y porcentaje, `locadores.cantidad`, `locadores.lista` y `locadores.nombres`; `locador.*` y `propietario.*` son alias del primero; `apoderados.N.*` trae al apoderado, su poderdante, alcances y firma; sin locadores solo informa cantidad 0; un propietario cargado solo como parte del contrato ya no se usa | `contract-templates/contract-variable-builder.spec.ts`; `locadores-apoderados.e2e-spec.ts::CP-248` | verde (31 oct) |
| CP-249 | Locadores del contrato en la web: la suma decide si se guarda | con 60 + 40 el indicador dice 100,0000 % y se puede guardar; con 60 + 30 muestra "Falta 10,0000 %" y el botón queda deshabilitado; con 70,5 + 40 muestra "Sobran 10,5000 %"; la coma decimal se acepta y más de 4 decimales o un valor fuera de 0-100 se rechazan; una cesión con fechas que cierran en 100 se guarda y un hueco entre fechas lista los días que no suman. Al guardar viaja un solo `PUT /contracts/:id/lessors` con todo el conjunto (las filas existentes con `id`, las nuevas sin él). Regla: sin 100 exacto no se envía | `components/parties/lessors-editor.test.tsx` (13 casos); `components/parties/parties.test.ts` (17 casos) | verde (31 oct) |
| CP-250 | Cobrador y cuenta limitados al locador | las opciones de cobrador son solo los apoderados con poder `Cobrar` vigente de ese locador sobre este contrato, su propiedad o general (no el que solo firma, ni el de otro contrato, ni el vencido); las cuentas son solo las de ese locador; cambiar de persona limpia el cobrador y la cuenta; sin poderes ni cuentas el editor sigue usable | `components/parties/lessors-editor.test.tsx` (4 casos); `components/parties/parties.test.ts::powerCollectsFor` | verde (31 oct) |
| CP-251 | Errores de los locadores de la API | `LESSOR_SHARES_INVALID` muestra el aviso y la lista de días con su suma (`details.invalidDates`); `PAYEE_WITHOUT_POWER` y `BANK_ACCOUNT_NOT_OF_LESSOR` muestran su mensaje localizado; en los tres el diálogo queda abierto y el botón disponible para corregir | `components/parties/lessors-editor.test.tsx` (3 casos) | verde (31 oct) |
| CP-252 | Cuentas bancarias en la ficha de la persona | la lista marca la predeterminada de cada moneda; agregar manda moneda, CBU de 22 dígitos (solo dígitos) y titular; un CBU incompleto no llega a la API; "Hacer predeterminada" manda `isDefault: true`; editar no cambia la moneda y solo manda `isDefault` si cambió; soltar o borrar la predeterminada con otras vivas muestra `BANK_ACCOUNT_DEFAULT_REQUIRED` y la cuenta sigue; borrar pide confirmación; Lectura no ve acciones | `components/parties/person-bank-accounts.test.tsx` (12 casos) | verde (31 oct) |
| CP-253 | Poderes en la ficha de la persona | los otorgados se editan y se revocan, los ejercidos como apoderada son de solo lectura; sin apoderado ni alcance no se envía; la poderdante no se ofrece como apoderada; firma conjunta pide clave de grupo; un poder de contrato o de propiedad exige elegir el contrato o la propiedad (no se envía como general); enlace inválido y vigencia invertida se marcan en el campo; `POWER_SELF` y `POWER_IN_USE` se muestran; revocar pide confirmación | `components/parties/person-powers.test.tsx` (14 casos) | verde (31 oct) |
| CP-254 | Titulares de la propiedad en la web | se listan con porcentaje, título y período; se agregan con porcentaje opcional (coma aceptada) y se quitan con confirmación; cuando los porcentajes cargados no suman 100 aparece un aviso informativo que no bloquea nada; sin porcentajes o con 100 no hay aviso; sin permiso de edición no hay botones | `components/parties/property-ownerships.test.tsx` (12 casos); `properties/[id]/page.screen.test.tsx` (2 casos) | verde (31 oct) |
| CP-255 | Alta de contrato con varios locadores | cada persona buscada puede sumarse como locadora aunque no tenga el rol de propietario; al agregar o quitar se reparte en partes iguales mientras nadie edite un porcentaje, y después deja de repartir solo; el aviso dice si suman 100 o cuánto suman; con suma distinta de 100 se puede guardar como borrador (con el aviso) pero no activar; sin locadores no se pasa de paso. El alta envía `lessors: [{ personId, payoutPct }]` en `POST /contracts` y solo inquilino y garante en `persons`. Regla: la API valida la suma al activar | `components/contracts/contract-form.test.tsx` (6 casos nuevos) | verde (31 oct) |
| CP-256 | Contrato y persona muestran las partes | el contrato lista locadores (persona, carácter, % de cobro, cobrador, cuenta, vigencia, "A revisar") y los apoderados que aplican con alcances y modo de firma, con enlaces a las fichas; sin locadores muestra los propietarios viejos como "A migrar"; solo Admin, Gerente y Ventas editan; al guardar se vuelve a leer el contrato; la ficha de persona separa Datos, Cuentas bancarias, Poderes y Contratos como locador y guarda tipo, documento, domicilio, estado civil, nacionalidad y forma de cobro (vaciar un dato lo limpia) | `components/parties/contract-parties.test.tsx` (14 casos); `components/parties/person-lessorships.test.tsx` (3 casos); `persons/[id]/page.screen.test.tsx`; `components/persons/person-form.test.tsx` (2 casos) | verde (31 oct) |

## Casos de reglas versionadas, acuerdos y valores por defecto (ítem 34, 2.1)

Banda CP-120 a CP-129. Origen: FB-13 (rezago de 2 meses y pago a cuenta), FB-05 (fin real) y la decisión D-3 (un contrato pasado de su fin sin fin real sigue activo). El resultado esperado se fijó antes de implementar.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-120 | Valores por defecto de la inmobiliaria | sin configurar, `GET /tenants/me/operational-defaults` devuelve los del código (vencimiento 10, anticipación 10, rezago 2, comisión 7 %, honorarios 5/5/3/5 %, tasación USD 100, anticipo 2 honorarios, cobranza 5/5, semáforo 0/60) a todos los roles; Admin y Gerente guardan con `PUT` y el resto recibe 403; lo no enviado toma el valor del código; un valor fuera de rango, un campo desconocido o un semáforo invertido responden 400 `VALIDATION_ERROR` y no guardan; los valores de una inmobiliaria no se ven en otra | `reglas-del-contrato.e2e-spec.ts::CP-120` (4 casos); `tenants/tenants-operational-defaults.spec.ts`; `shared/schemas/contract-rules.schema.spec.ts` | verde (31 oct) |
| CP-121 | Reglas iniciales de cada contrato | un contrato nuevo nace con su período 1 (`Original`, alquiler inicial el de alta) y una versión de reglas desde el inicio con el vencimiento y el rezago de los valores por defecto, base `Vigente` y flujo `Partido`; los contratos existentes reciben un período y una versión con sus columnas de hoy, el alquiler inicial anterior al primer ajuste aplicado y ningún cambio en columnas, ajustes ni índices | `reglas-del-contrato.e2e-spec.ts::CP-121`; `contracts/contract-activation.spec.ts`; `scripts/migration-rehearsal.sh`, `apps/api/test/migration-data/checks/05_reglas.sql` | verde (31 oct) |
| CP-122 | Un convenio de cambio de regla crea una versión | `POST /contracts/:id/agreements` con `termsPatch` crea el convenio y una versión copia de la vigente más el cambio, en la misma transacción; si rige desde hoy o antes, las columnas del contrato quedan iguales a la versión y se rehace el cronograma pendiente (semestral: 4 fechas); `GET /contracts/:id/terms?at=` devuelve la versión de cada fecha (antes del inicio, `null`) y una fecha inválida responde 400 | `reglas-del-contrato.e2e-spec.ts::CP-122` (2 casos); `contracts/contract-rules.service.spec.ts`; `contracts/contract-terms.spec.ts` | verde (31 oct) |
| CP-123 | Atomicidad y validación del convenio | un convenio con fecha futura crea la versión sin tocar las columnas; una fecha repetida responde 409 `TERMS_VERSION_EXISTS` y no deja convenio; fecha anterior al inicio, tipo sin `termsPatch` y modalidad con porcentaje sin `customPct` responden 400 (`AGREEMENT_BEFORE_START`, `VALIDATION_ERROR`, `MISSING_ADJUSTMENT_PCT`) sin escribir nada; el alta queda en la auditoría con `operation: contract-agreement` | `reglas-del-contrato.e2e-spec.ts::CP-123` (4 casos); `contracts/contract-rules.service.spec.ts` | verde (31 oct) |
| CP-124 | Permisos y aislamiento de los convenios | Admin y Gerente registran, corrigen y borran; Ventas, Liquidaciones, Marketing, Soporte y Lectura reciben 403; todos los roles leen convenios, versiones y períodos; un contrato o convenio de otra inmobiliaria responde 404 y no se toca | `reglas-del-contrato.e2e-spec.ts::CP-124` (2 casos); `contracts/contracts.controller.spec.ts` | verde (31 oct) |
| CP-125 | Un convenio solo se toca si nada depende de él | con dos convenios de cambio de regla, corregir o borrar el primero responde 409 `AGREEMENT_HAS_LATER_VERSIONS`; el último se corrige y se borra con su versión y las columnas del contrato vuelven a la versión anterior, hasta la inicial; un convenio inexistente responde 404 `AGREEMENT_NOT_FOUND`; con más de una versión, cambiar la modalidad por `PATCH /contracts/:id` responde 409 `RULES_CHANGE_REQUIRES_AGREEMENT`, y sin convenios corrige también la versión inicial | `reglas-del-contrato.e2e-spec.ts::CP-125` (2 casos); `contracts/contract-rules-lifecycle.spec.ts` | verde (31 oct) |
| CP-126 | Fin real y prórroga de palabra (FB-05) | `PATCH /contracts/:id` con `actualEndDate` la guarda sin tocar `endDate`; anterior al inicio responde 400 `VALIDATION_ERROR`; `null` la quita; el cronograma pendiente se rehace hasta el fin efectivo; extender un contrato activo no puede pisar a otro alquiler activo (el fin efectivo cuenta) | `reglas-del-contrato.e2e-spec.ts::CP-126`; `contracts/contract-rules-lifecycle.spec.ts` | verde (31 oct) |
| CP-127 | Contrato pasado de su fin sigue activo (D-3) | un contrato `Activo` con `endDate` en el pasado y sin `actualEndDate` sigue `Activo` y no se vence solo: no hay vencimiento automático; el fin efectivo es el pactado | `reglas-del-contrato.e2e-spec.ts::CP-127`; `contracts/contract-terms.spec.ts` | verde (31 oct) |
| CP-128 | El valor oficial reemplaza al estimado | cargar un estimado (`isEstimate`, `estimateSource: REM`) y después el oficial del mismo período deja una sola fila oficial y un registro del reemplazo (`GET /index-data/estimates-replaced` con `estimateValue`, `officialValue`, `via: manual`); un estimado sobre un oficial responde 409 `OFFICIAL_VALUE_EXISTS`; `estimateSource` sin `isEstimate` responde 400; el informe es de Admin y Gerente | `reglas-del-contrato.e2e-spec.ts::CP-128` (2 casos); `index-data/index-data.service.spec.ts` | verde (31 oct) |
| CP-129 | Los estimados no cuentan como dato oficial | el listado muestra el estimado con su marca, el último valor de cada índice ignora los estimados y el cálculo de ajustes solo lee oficiales (un oficial de sistema le gana a un estimado propio); la tasa activa del BNA se acepta como índice | `reglas-del-contrato.e2e-spec.ts::CP-129`; `index-data/index-data.service.spec.ts` | verde (31 oct) |

## Casos de un solo camino de ajuste (ítem 34, L3)

El resultado esperado se fijó antes de unificar el cálculo. Hasta entonces el
cálculo manual (`ContractsService.calculateAdjustment`) y la previsualización y
el barrido (`ContractAdjustmentService`) traducían la modalidad cada uno por su
cuenta.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-270 | Previsualización sin datos de índice (DEF-26) | `POST /contracts/:id/preview-adjustment` de un contrato IPC sin valores responde 400 `MISSING_INDEX_DATA` con `indexType`, `periodStart` y `periodEnd`, no una proyección sin cambios | `index-data.e2e-spec.ts::CP-270`, `contracts/contract-adjustment-paths.spec.ts` | verde |
| CP-271 | Caracterización del cálculo por modalidad | 15 casos sintéticos (IPC, ICL, CCP, fijo, personalizado, modalidad desconocida; D1 a D11): los tres caminos dan el mismo alquiler cuando hay datos (105.060, 120.000, 101.500, 100.900, 110.000, 107.500) y la misma ventana de índices tras un ajuste aplicado (DEF-07); aplicar el cálculo manual deja el alquiler en `newAmount` y el cronograma en Aplicado | `contracts/contract-adjustment-paths.spec.ts` | verde |
| CP-272 | Un solo criterio ante datos faltantes (DEF-25) | IPC o ICL sin valores, ICL con uno solo, CCP sin CVS o sin CER: 400 `MISSING_INDEX_DATA` en el cálculo manual y en la previsualización, y el barrido deja el cronograma pendiente sin tocar el alquiler; porcentaje fijo o personalizado sin porcentaje: `MISSING_ADJUSTMENT_PCT`; modalidad desconocida: `UNKNOWN_ADJUSTMENT_TYPE`; en ningún camino se aplica 0 % en silencio | `contracts/contract-adjustment-paths.spec.ts`, `index-data/contract-adjustment.service.spec.ts` (CP-06, CP-07, CP-08, CP-10) | verde |

## Casos de base de proceso

Reservados CP-72 a CP-79. Verifican la propia infraestructura de pruebas, no un
requisito funcional.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-72 | Paridad de claves i18n: `es.json` y `en.json` | mismo conjunto de claves aplanadas en ambos; ningún texto vacío; si falla, el mensaje lista las claves faltantes de cada idioma | `apps/web/test/i18n-parity.spec.ts` (3 casos) | verde (30 oct) |
| CP-73 | Independencia de la zona horaria: las pruebas unitarias dan el mismo resultado en UTC y en `America/Argentina/Buenos_Aires` | con `TZ=America/Argentina/Buenos_Aires` en la shell, la suite unitaria de la API y la del paquete compartido terminan en verde, porque Jest fija `TZ=UTC` | `apps/api/test/setup/utc.js`, `packages/shared/test-utc.js`; verificada con `reports.service.spec.ts` | verde (30 oct); antes fallaba `getCashFlow › arma un renglon por mes del rango` |
| CP-74 | Diálogo accesible: foco, Esc y apilado | Tab y Shift+Tab ciclan dentro del diálogo; Esc cierra y el foco vuelve al disparador; `aria-labelledby` resuelve al título y `aria-modal="true"`; con dos diálogos apilados Esc cierra solo el de arriba y el scroll del body se libera recién al cerrar ambos; con `busy` ni Esc ni el fondo cierran | `apps/web/src/components/ui/dialog.test.tsx` (6 casos) | verde (30 oct) |
| CP-75 | Confirmación: aceptar y cancelar | `confirm()` resuelve `true` al aceptar y `false` al cancelar o con Esc; con Esc el foco vuelve al disparador | `apps/web/src/components/ui/confirm-dialog.test.tsx` (3 casos) | verde (30 oct) |
