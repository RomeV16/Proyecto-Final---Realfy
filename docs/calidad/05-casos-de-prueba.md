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

La tabla describe el primer ajuste de un contrato. Desde el segundo, los
índices se toman desde el último ajuste aplicado y no desde el inicio
(DEF-07): lo verifican CP-55 a CP-58.

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
| CP-81 | FB-24 | borrador sin inquilino; borrador sin propietario ni inquilino; segundo alquiler cuyas fechas se pisan con uno activo | 400 `CONTRACT_NOT_ACTIVATABLE` con la lista `problems` (`MISSING_INQUILINO`; `MISSING_PROPIETARIO` y `MISSING_INQUILINO`; `OVERLAPPING_CONTRACT` con el id del otro contrato); el contrato sigue en `Borrador` y la propiedad no cambia | `test/e2e/contract-activation.e2e-spec.ts::requisitos faltantes` (3 casos) | verde |
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

## Casos de base de proceso

Reservados CP-72 a CP-79. Verifican la propia infraestructura de pruebas, no un
requisito funcional.

| ID | Qué | Esperado (fijado antes) | Prueba | Estado |
|---|---|---|---|---|
| CP-72 | Paridad de claves i18n: `es.json` y `en.json` | mismo conjunto de claves aplanadas en ambos; ningún texto vacío; si falla, el mensaje lista las claves faltantes de cada idioma | `apps/web/test/i18n-parity.spec.ts` (3 casos) | verde (30 oct) |
| CP-73 | Independencia de la zona horaria: las pruebas unitarias dan el mismo resultado en UTC y en `America/Argentina/Buenos_Aires` | con `TZ=America/Argentina/Buenos_Aires` en la shell, la suite unitaria de la API y la del paquete compartido terminan en verde, porque Jest fija `TZ=UTC` | `apps/api/test/setup/utc.js`, `packages/shared/test-utc.js`; verificada con `reports.service.spec.ts` | verde (30 oct); antes fallaba `getCashFlow › arma un renglon por mes del rango` |
| CP-74 | Diálogo accesible: foco, Esc y apilado | Tab y Shift+Tab ciclan dentro del diálogo; Esc cierra y el foco vuelve al disparador; `aria-labelledby` resuelve al título y `aria-modal="true"`; con dos diálogos apilados Esc cierra solo el de arriba y el scroll del body se libera recién al cerrar ambos; con `busy` ni Esc ni el fondo cierran | `apps/web/src/components/ui/dialog.test.tsx` (6 casos) | verde (30 oct) |
| CP-75 | Confirmación: aceptar y cancelar | `confirm()` resuelve `true` al aceptar y `false` al cancelar o con Esc; con Esc el foco vuelve al disparador | `apps/web/src/components/ui/confirm-dialog.test.tsx` (3 casos) | verde (30 oct) |
