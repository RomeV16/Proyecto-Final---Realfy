# Registro de defectos

Versión 1.4 — 31 de octubre de 2026 (1.0: 19 de octubre; 1.2: 20 de octubre; 1.3: 28 de octubre). Cada defecto se registra con la
plantilla del plan de pruebas, se vincula a su caso y a su requisito, y se
cierra únicamente con una prueba de regresión en la suite y una ejecución
del pipeline en rojo (antes) y en verde (después). El issue de GitHub es
el registro oficial; este archivo es la copia versionada.

| ID | Título | Severidad | Requisito | Caso | Issue | Estado |
|---|---|---|---|---|---|---|
| DEF-01 | Los índices obtenidos automáticamente no son visibles para ninguna inmobiliaria | Alta | RF-14 | CP-53, CP-54 | [#77](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/77) | Corregido (día 5) |
| DEF-02 | La aplicación automática informa delta 0 para contratos IPC e ICL | Media | RF-12, RF-13 | CP-14 | [#78](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/78) | Corregido (día 5) |
| DEF-03 | La modalidad CCP cae a "sin ajuste" en la previsualización y la aplicación automática | Media | RF-12 | CP-09 | [#79](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/79) | Corregido (día 5; era L-05 del informe) |
| DEF-04 | Tres DTOs de `class-validator` sin uso en el módulo | Baja | — | — | [#80](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/80) | Corregido (día 3) |
| DEF-05 | La suma de meses sobre fin de mes desplaza la fecha de ajuste | Media | RF-12 | CP-17 | [#81](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/81) | Corregido (día 5) |
| DEF-06 | El IPC se obtiene como nivel y de los 24 meses más viejos, no como variación mensual reciente | Alta | RF-14, RF-12 | CP-52, CP-54 | [#82](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/82) | Corregido (día 5) |
| DEF-07 | Los ajustes consecutivos vuelven a contar la inflación ya aplicada | Alta | RF-12, RF-13 | CP-55, CP-56, CP-58 | [#83](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/83) | Corregido (28 oct) |
| DEF-08 | El barrido automático pisa un ajuste con el siguiente del mismo contrato | Media | RF-12, RF-13 | CP-57 | [#84](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/84) | Corregido (28 oct) |
| DEF-09 | Un archivo de importación subido por una inmobiliaria se puede usar desde otra | Media | — | CP-85 | [#97](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/97) | Corregido (30 oct) |
| DEF-10 | El cronograma de ajustes encadena cada fecha a la anterior, en hora local, y un período desconocido se toma como trimestral | Media | RF-12 | CP-130 | [#93](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/93) | Corregido (31 oct) |
| DEF-11 | Períodos, "hoy" y meses de documentos se arman en hora local del proceso | Media | — | CP-131 | [#93](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/93) | Corregido (31 oct) |
| DEF-12 | La rendición muestra totales que no suman sus líneas | Media | — | CP-132 | [#93](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/93) | Corregido (31 oct) |
| DEF-13 | El motor de liquidación acepta descuentos negativos y su total puede diferir en un centavo de lo mostrado | Baja | — | CP-133 | [#93](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/93) | Corregido (31 oct) |
| DEF-14 | La comisión acepta porcentajes mayores a 100 y montos negativos | Media | — | CP-134 | [#93](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/93) | Corregido (31 oct) |
| DEF-15 | `LiquidacionStatus.Pendiente` existe en la base y no en el paquete compartido | Baja | — | CP-135 | [#93](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/93) | Corregido (31 oct) |

---

## Contraste rojo / verde

Las pruebas de regresión se subieron solas en el commit `27a5d92` y el
pipeline las registró en rojo contra el código anterior: ejecución
[39336742449](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/39336742449), trabajo "Unit Tests & Coverage" fallido en el
paso "Unit tests with coverage" con 8 casos en rojo (CP-09, CP-14, CP-17 ×3,
CP-31, CP-50 ×2); los trabajos dependientes quedaron omitidos. Es la
ejecución fallida que detecta un problema real exigida por el TP. La
corrección entra en el commit siguiente y su ejecución en verde se enlaza
en `09-metricas.md`.

Los defectos DEF-07 y DEF-08 aparecieron después del cierre del TP, al
preparar el ambiente de la demostración con contratos que llevaban más de un
ajuste: todas las pruebas del catálogo ajustaban una sola vez. Siguieron el
mismo circuito. Las regresiones se subieron solas en el commit `0cfa450` y el
pipeline las registró en rojo: ejecución
[40804485827](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/40804485827),
trabajo "Unit Tests & Coverage" fallido con 3 casos en rojo (CP-55, CP-56,
CP-57); la integración quedó omitida por depender de ese trabajo, y CP-58 se
verificó en rojo en local sobre PostgreSQL (189.131,16 contra 171.384,28
esperado). La corrección entra en `a1591b4` (PR #85).

## DEF-01 — Los índices obtenidos automáticamente no son visibles para ninguna inmobiliaria

- **Requisito afectado:** RF-14 (obtener automáticamente los valores publicados).
- **Caso que lo detecta:** CP-53, CP-54.
- **Severidad:** alta. La funcionalidad automática existe, corre todos los
  días y nunca produce efecto para el usuario.
- **Pasos para reproducir:**
  1. Con un Admin autenticado, `POST /api/index-data/refresh` (o esperar la tarea de las 06:00).
  2. Verificar en la base que existen filas en `index_data` con `tenant_id = '__system__'`.
  3. `GET /api/index-data/latest` o `POST /api/contracts/:id/preview-adjustment` sobre un contrato IPC sin carga manual.
- **Resultado esperado:** los valores obtenidos aparecen en el listado y se usan en el cálculo.
- **Resultado obtenido:** el listado no los muestra y el cálculo devuelve factor 1 (previsualización) o `MISSING_INDEX_DATA` (cálculo manual).
- **Causa raíz:** `IndexScraperService.upsertAll` escribe con `baseClient` bajo el identificador `__system__`; todas las lecturas (`IndexDataService`, `ContractAdjustmentService.preview`, `ContractsService.loadIndexData`) pasan por el cliente con la extensión de aislamiento, que agrega `tenantId = <inmobiliaria actual>`. `applyDueAdjustments` filtra explícitamente por `contract.tenantId`. Nada lee `__system__`.
- **Corrección (día 5):** `IndexDataService` lee por el cliente base con el filtro explícito `tenantId IN (propia, __system__)`, falla cerrado sin inmobiliaria en contexto (ADR-0006) y resuelve el empate por período a favor de la carga propia (`mergeVisibleRows`). `getForPeriod` acepta inmobiliaria y cliente de transacción para los barridos. `ContractAdjustmentService` y `ContractsService.loadIndexData` leen solo por ahí. El borrado sigue acotado a filas propias.
- **Prueba de regresión:** CP-53 (×3) y CP-54 en `test/e2e/index-data-scraper.e2e-spec.ts`; unitarios en `index-data.service.spec.ts` (CP-18 fail-closed, CP-53 unitario, `mergeVisibleRows`).
- **Evidencia rojo/verde:** rojo en [39336742449](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/39336742449); verde: ver `09-metricas.md`.

## DEF-02 — La aplicación automática informa delta 0 para contratos IPC e ICL

- **Requisito afectado:** RF-12, RF-13.
- **Caso que lo detecta:** CP-14.
- **Severidad:** media. El alquiler se actualiza bien dentro de la transacción, pero el resumen que devuelve el método se recalcula afuera con un `switch` que solo contempla porcentaje fijo y personalizado; para IPC e ICL informa `deltaAmount: "0.00"`.
- **Pasos:** cronograma vencido de un contrato IPC con índices cargados; ejecutar `applyDueAdjustments()`.
- **Esperado:** `deltaAmount` igual al delta aplicado.
- **Obtenido:** `"0.00"`.
- **Causa raíz:** `contract-adjustment.service.ts` líneas 293-320 (commit `2eb2fa7`): duplicación de la lógica de armado de parámetros con un `switch` incompleto.
- **Corrección (día 5):** el armado de parámetros se extrajo a `loadParams`, compartido por `preview` y `applyDueAdjustments`; el delta se calcula una vez dentro de la transacción y es el que se informa. Se eliminó el `switch` duplicado (menos duplicación para SonarCloud).
- **Prueba de regresión:** CP-14 en `contract-adjustment.service.spec.ts`.

## DEF-03 — La modalidad CCP cae a "sin ajuste"

- **Requisito afectado:** RF-12 (cinco modalidades).
- **Caso:** CP-09.
- **Severidad:** media. Declarado como limitación L-05 en el informe de tesis.
- **Esperado:** factor `Π(1 + min(0,9·CVS_i, CER_i)/100)` con los valores CVS y CER del período.
- **Obtenido:** factor 1, porque el `default` del `switch` arma un porcentaje fijo de 0.
- **Causa raíz:** el servicio solo carga un tipo de índice por contrato; CCP necesita dos series.
- **Corrección (día 5):** `loadParams` carga CVS y CER para CCP y delega en `calculateCCP`; la previsualización informa `CVS` como índice principal.
- **Prueba de regresión:** CP-09 en `contract-adjustment.service.spec.ts` (D6 y D7 encadenadas: 102.413,50).

## DEF-04 — DTOs sin uso

- `dto/create-index-data.dto.ts`, `dto/create-index-data-bulk.dto.ts` y `dto/index-data-filter.dto.ts` no se importan desde ningún archivo. El controlador recibe `Record<string, any>` y el servicio valida con los esquemas Zod del paquete compartido.
- **Severidad:** baja. Código muerto que confunde (dos fuentes de verdad para la validación) y baja la cobertura sin aportar.
- **Corrección:** eliminados el 20 de octubre (día 3) en la rama `tp-calidad`. No hay prueba de regresión posible para código muerto; la verificación es que la compilación y las suites siguen en verde sin ellos.

## DEF-05 — Suma de meses sobre fin de mes (sospechado)

- `addMonths` usa `setMonth(getMonth() + n)`. En JavaScript, 31 de enero + 1 mes produce 3 de marzo (o 2 en bisiesto) porque febrero no tiene día 31.
- **Impacto:** un contrato con ajuste mensual cuya fecha cae el 31 vería desplazarse la fecha del siguiente ajuste.
- **Confirmación (20 de octubre):** `addMonths(2026-01-31, 1)` devuelve `2026-03-03` y `addMonths(2024-02-29, 12)` devuelve `2025-03-01`. Además, como `setMonth` opera en hora local, una fecha guardada a medianoche UTC se procesa en el día anterior en Argentina (UTC-3): los casos CP-16 y CP-17 usan mediodía UTC para no depender de la zona horaria del equipo.
- **Esperado:** la fecha se recorta al último día del mes destino (31 ene + 1 → 28 feb; 29 feb 2024 + 12 → 28 feb 2025) y el cálculo se hace en UTC.
- **Corrección (día 5):** `addMonths` opera en UTC y recorta al último día del mes destino.
- **Prueba de regresión:** CP-17 con 31 ene → 28 feb, 30 nov + 3 → 28 feb, 29 feb 2024 + 12 → 28 feb 2025, más los casos normales. La misma función existe en `ContractsService` (generación del cronograma), fuera del alcance: se reporta como hallazgo para la tesis.

## DEF-06 — El IPC se obtiene como nivel y de los meses más viejos

- **Requisito afectado:** RF-14 (obtención automática) y RF-12 (cálculo IPC).
- **Caso que lo detecta:** CP-52 (contrato contra entorno real, 19 de octubre de 2026) y CP-54.
- **Severidad:** alta. Si DEF-01 se corrigiera solo, el cálculo IPC usaría niveles como porcentajes y produciría alquileres absurdos.
- **Pasos:** llamar a `https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json&limit=24` y mirar `data`.
- **Esperado:** las últimas 24 variaciones mensuales del IPC, en porcentaje, para alimentar `calculateIPC`.
- **Obtenido:** `[["2016-12-01", 100.0], ["2017-01-01", 101.5859], ... ["2018-11-01", 179.6388]]`: niveles, y los 24 primeros de la serie.
- **Causa raíz:** `fetchIPC` no pide `sort=desc` ni `representation_mode=percent_change`, y guarda `valor` sin convertir. El respaldo CSV lee la columna de nivel. La fixture de la prueba unitaria original (`7045.47`) reproducía el malentendido.
- **Corrección (día 5):** `fetchIPC` pide `sort=desc&representation_mode=percent_change`, convierte la fracción a porcentaje con seis decimales y descarta valores no numéricos; el respaldo CSV lee la columna 9 (`ipc_ng_nacional_tasa_variacion_mensual`). La fixture de la prueba original se reemplazó por fracciones.
- **Prueba de regresión:** CP-50 con las fixtures reales (`2.113772` para 2026-07; `1.933610` para 2026-09 por CSV), CP-31 unitario, CP-52 contra el entorno real.

## DEF-07 — Los ajustes consecutivos vuelven a contar la inflación ya aplicada

- **Requisito afectado:** RF-12 (cálculo del ajuste) y RF-13 (registro del nuevo alquiler).
- **Casos que lo detectan:** CP-55, CP-56 (unitarios) y CP-58 (integración).
- **Severidad:** alta. Desde el segundo ajuste de cada contrato el alquiler queda por encima del que corresponde, y el error se acumula con cada período.
- **Pasos para reproducir:**
  1. Contrato IPC trimestral desde el 1 de enero de 2025 por 150.000, con IPC cargado de enero a julio (2; 3; 1; 4; 2; 1; 0,5 %).
  2. `POST /api/contracts/:id/adjustments/calculate` y `/apply` para el ajuste de abril.
  3. `POST /api/contracts/:id/adjustments/calculate` para el ajuste de julio.
- **Resultado esperado:** abril 165.532,54; julio 165.532,54 × 1,02 × 1,01 × 1,005 = 171.384,28.
- **Resultado obtenido:** julio 189.131,16: vuelve a encadenar enero a abril sobre un alquiler que ya los incluye.
- **Causa raíz:** la ventana de índices era siempre `[inicio del contrato, fecha de ajuste]` en `ContractAdjustmentService.loadParams` y en `ContractsService.calculateAdjustment`, mientras que la base es el alquiler vigente. Afecta IPC, ICL y CCP en la previsualización, el cálculo manual y la aplicación automática.
- **Corrección:** `adjustment-window.ts` resuelve la ventana desde el último ajuste aplicado del contrato (o su inicio si no hubo ninguno). Las series de variación mensual (IPC, CVS, CER) excluyen ese límite, que ya entró en el ajuste anterior; las de nivel (ICL, UVA) lo incluyen, porque el cociente se toma contra el valor en esa fecha. `getForPeriod` acepta `startExclusive`. El primer ajuste no cambia, así que la tabla de decisión D1 a D11 sigue vigente.
- **Prueba de regresión:** CP-55 (IPC: solo el 4 % posterior, 110.355,02), CP-56 (ICL: 121 / 110 y no 121 / 100), CP-58 de punta a punta en `test/e2e/contracts.e2e-spec.ts`; CP-27 cubre `startExclusive`.

## DEF-08 — El barrido automático pisa un ajuste con el siguiente del mismo contrato

- **Requisito afectado:** RF-12, RF-13.
- **Caso que lo detecta:** CP-57.
- **Severidad:** media. Latente: hoy ninguna tarea programada invoca `applyDueAdjustments`, pero es el camino previsto para aplicar los ajustes vencidos.
- **Pasos:** contrato con porcentaje fijo 10 % por 50.000 y dos cronogramas vencidos (abril y julio); ejecutar `applyDueAdjustments()`.
- **Esperado:** 50.000 → 55.000 → 60.500.
- **Obtenido:** 50.000 → 55.000 → 55.000.
- **Causa raíz:** el barrido trae cada cronograma con su contrato incluido y usa ese `rentAmount` dentro de la transacción: el segundo ajuste de un mismo contrato parte del alquiler leído antes de aplicar el primero.
- **Corrección:** el barrido relee el contrato dentro de la transacción de cada ajuste.
- **Prueba de regresión:** CP-57 en `contract-adjustment.service.spec.ts`.

## DEF-09 — Un archivo de importación subido por una inmobiliaria se puede usar desde otra

- **Requisito afectado:** aislamiento entre inmobiliarias (ADR-0006) aplicado a la importación masiva.
- **Origen:** revisión de código del módulo de importación, al preparar el ítem 39.
- **Caso que lo detecta:** CP-85.
- **Severidad:** media. Rompe el aislamiento (lectura de las filas ajenas por la validación e importación de datos ajenos en la inmobiliaria propia), pero exige conocer un `fileId` que es un UUID aleatorio y el archivo vive 30 minutos; por eso no es alta.
- **Pasos para reproducir:**
  1. Un Admin de la inmobiliaria A sube un CSV a `POST /api/import/upload` y obtiene un `fileId`.
  2. Un Admin de la inmobiliaria B llama a `POST /api/import/validate` o `POST /api/import/execute` con ese `fileId`.
- **Resultado esperado:** 404 `FILE_NOT_FOUND`, igual que para un archivo inexistente, sin filas creadas en B.
- **Resultado obtenido:** 200 en validate (con las filas de A en la vista previa) y 201 en execute, que crea las propiedades de A dentro de B.
- **Causa raíz:** el almacén en memoria guardaba el archivo indexado solo por `fileId` y `getUpload` no comparaba la inmobiliaria de la petición con la de quien lo subió.
- **Corrección:** cada archivo guarda `tenantId` y `userId` al subirse; `getUpload` solo lo resuelve si la inmobiliaria coincide y en caso contrario responde como si no existiera. El archivo inexistente pasa de 400 a 404 para que ambos casos sean indistinguibles. Vencimiento y borrado tras importar sin cambios.
- **Prueba de regresión:** CP-85 en `test/e2e/import-export.e2e-spec.ts` y en `import-export.service.spec.ts`.
- **Evidencia rojo/verde:** commit de regresión `9857f75` en rojo (e2e: 1 caso en rojo de 16; unitario: 1 de 11); corrección en `4a3bfe0`. Ejecuciones del pipeline: se completa al abrir el PR.

## DEF-10 — El cronograma de ajustes encadena cada fecha a la anterior

- **Requisito afectado:** RF-12 (cronograma de ajustes).
- **Origen:** revisión de código (ítem 35 de la hoja de ruta).
- **Caso que lo detecta:** CP-130.
- **Severidad:** media. Todo contrato que empieza el 29, 30 o 31 de un mes arrastra un día de error en cada ajuste posterior.
- **Pasos para reproducir:** crear un contrato trimestral que empieza el 31 de enero de 2025 y ver las fechas del cronograma.
- **Resultado esperado:** 30 de abril, 31 de julio y 31 de octubre.
- **Resultado obtenido:** 1 de mayo, 1 de agosto y 1 de noviembre. Con período mensual: 3 de marzo, 3 de abril y 3 de mayo.
- **Causa raíz:** `ContractsService` tenía su propio `addMonths` con `setMonth` en hora local y generaba cada fecha a partir de la anterior, de modo que el desborde del mes corto se acumulaba. Además su copia de `periodToMonths` devolvía 3 ante un valor desconocido.
- **Corrección:** `addMonthsClamped` y `periodToMonths` en `packages/shared/src/date-utils`. Cada fecha se calcula desde el ancla (inicio del contrato o último ajuste aplicado) más k períodos, con recorte a fin de mes. Un período desconocido lanza. Se eliminan las copias locales de `ContractsService` y de `ContractAdjustmentService`, y el barrido calcula la fecha siguiente antes de escribir.
- **Prueba de regresión:** CP-130 en `contract-schedule.spec.ts`; el caso de CP-16 que fijaba la periodicidad `Inventada` como trimestral pasa a verificar que el barrido no aplica el ajuste.
- **Evidencia rojo/verde:** commit de regresión `088d4b8` en rojo (3 casos de 3); corrección en `a02b0ea`. Ejecuciones del pipeline: se completan al abrir el PR.

## DEF-11 — Períodos, "hoy" y meses de documentos en hora local del proceso

- **Requisito afectado:** ninguno funcional; consistencia de fechas de negocio (las fechas sin hora se guardan a medianoche UTC).
- **Origen:** revisión de código (ítem 35) y pruebas de caracterización (L0): el caso de flujo de caja que fallaba con la zona de Buenos Aires (CP-73).
- **Caso que lo detecta:** CP-131.
- **Severidad:** media. En un servidor en UTC no se nota; en un proceso con `America/Argentina/Buenos_Aires` el flujo de caja de un trimestre devuelve cuatro renglones, el período de una liquidación se guarda a las 03:00 UTC y el mail de una liquidación de marzo dice "02/2025".
- **Pasos para reproducir:** correr el servicio con `TZ=America/Argentina/Buenos_Aires` y pedir `getCashFlow` de enero a marzo, o `generate` y `findAll` de liquidaciones.
- **Resultado esperado:** tres renglones; período `2025-03-01T00:00:00.000Z`; asunto "Liquidación 03/2025".
- **Resultado obtenido:** cuatro renglones (con diciembre), `2025-03-01T03:00:00.000Z` y "Liquidación 02/2025".
- **Causa raíz:** `new Date(y, m, d)`, `getMonth()`, `getFullYear()` y `toLocaleDateString` sin `timeZone` en liquidaciones, rendiciones, reportes, panel, cron fiscal, PDF fiscal y los mails y PDF de liquidación y rendición. `computeNextRunAt` estaba copiada en dos archivos.
- **Corrección:** `monthStartUTC`, `periodFilter`, `periodKey`, `todayInAR` y `formatDateAR` en `date-utils`; los meses se formatean con `timeZone: 'UTC'`; `computeNextRunAt` queda en `reports/compute-next-run-at.ts`. Los punitorios quedan para el PR siguiente.
- **Prueba de regresión:** CP-131 en `reports.service.spec.ts`, `liquidaciones-periodos.spec.ts`, `renditions-periodos.spec.ts` y `liquidaciones/email.service.spec.ts`; cada una fuerza la zona de Buenos Aires con `process.env.TZ` (entorno `test/setup/tz-environment.js`) y la restaura. `pnpm --filter @realfy/api test:tz-ar` corre toda la suite unitaria en esa zona.
- **Evidencia rojo/verde:** commit de regresión `dcd1701` en rojo (7 casos); corrección en `d5e2afc`. Ejecuciones del pipeline: se completan al abrir el PR.

## DEF-12 — La rendición muestra totales que no suman sus líneas

- **Requisito afectado:** ninguno funcional; coherencia del documento de rendición al propietario.
- **Origen:** pruebas de caracterización (L0) de `rendicion-engine`, que fijaron el comportamiento tal cual.
- **Caso que lo detecta:** CP-132.
- **Severidad:** media. Una diferencia de uno o dos centavos entre las líneas y el total aparece cuando los pagos o deducciones traen más de dos decimales.
- **Pasos para reproducir:** tres pagos de 33,333 con comisión de 3,5 %; dos deducciones de 10,005.
- **Resultado esperado:** líneas 33,33 + 33,33 + 33,33 = 99,99 y cobrado 99,99; deducciones 10,01 + 10,01 = 20,02 y total 20,02.
- **Resultado obtenido:** cobrado 100,00 con líneas que suman 99,99; total de deducciones 20,01 con líneas que suman 20,02.
- **Causa raíz:** el motor redondeaba cada línea pero acumulaba `rentCollected` y `deductionTotal` sobre los montos sin redondear.
- **Corrección:** ambos totales son la suma de las líneas ya redondeadas; la comisión y el neto se calculan sobre ellos.
- **Prueba de regresión:** CP-132 en `rendicion-engine.spec.ts` (se actualizan los dos casos de caracterización y se agrega uno de suma de líneas).
- **Evidencia rojo/verde:** commit de regresión `fcd8e4c` en rojo (3 casos); corrección en `059200d`. Ejecuciones del pipeline: se completan al abrir el PR.

## DEF-13 — El motor de liquidación acepta descuentos negativos y su total no coincide con lo mostrado

- **Requisito afectado:** ninguno funcional; integridad del total de la liquidación.
- **Origen:** pruebas de caracterización (L0) de `liquidacion-engine`.
- **Caso que lo detecta:** CP-133.
- **Severidad:** baja. El esquema de la API ya rechaza montos negativos, de modo que hoy solo se alcanza con datos cargados por fuera de la API; el motor no tenía defensa propia. La diferencia de un centavo sí es alcanzable.
- **Pasos para reproducir:** alquiler de 1000 con un Descuento de -100; subtotal 20,005 con descuentos 10,004.
- **Resultado esperado:** error `INVALID_LINE_AMOUNT`; total 10,01 (20,01 menos 10,00, lo que se imprime).
- **Resultado obtenido:** total 1100,00; total 10,00 con subtotal y descuentos que muestran 20,01 y 10,00.
- **Causa raíz:** el motor no validaba el signo y redondeaba el total desde el subtotal y los descuentos sin redondear.
- **Corrección:** `InvalidLineAmountError` (código `INVALID_LINE_AMOUNT`) ante cualquier renglón negativo, que la API devuelve como 400; total = subtotal redondeado menos descuentos redondeados, con piso en cero.
- **Prueba de regresión:** CP-133 en `liquidacion-engine.spec.ts`.
- **Evidencia rojo/verde:** commit de regresión `79c672c` en rojo (7 casos); corrección en `5b342cc`. Ejecuciones del pipeline: se completan al abrir el PR.

## DEF-14 — La comisión acepta porcentajes mayores a 100 y montos negativos

- **Requisito afectado:** ninguno funcional; reglas de comisión de la rendición.
- **Origen:** pruebas de caracterización (L0) de `commission-engine` y revisión de código del esquema de comisión.
- **Caso que lo detecta:** CP-134.
- **Severidad:** media. `POST /api/contracts/:id/commission` aceptaba `percentage: "150.00"` (el esquema solo limitaba la cantidad de dígitos) y la rendición descontaba más de lo cobrado.
- **Pasos para reproducir:** `POST /api/contracts/:id/commission` con `{ "type": "FixedPercent", "percentage": "150.00" }`.
- **Resultado esperado:** 400 `VALIDATION_ERROR` y la configuración anterior intacta.
- **Resultado obtenido:** 201 y 150 guardado.
- **Causa raíz:** ni el esquema ni el motor acotaban el porcentaje a 0-100 ni validaban el signo de los montos.
- **Corrección:** `InvalidCommissionError` (código `INVALID_COMMISSION`) en el motor ante un porcentaje fuera de 0-100 o un monto negativo, que la generación de rendiciones devuelve como 400; el esquema de la configuración rechaza porcentajes mayores a 100.
- **Prueba de regresión:** CP-134 en `commission-engine.spec.ts` (se reemplazan dos casos de caracterización) y en `test/e2e/renditions.e2e-spec.ts`.
- **Evidencia rojo/verde:** commit de regresión `cb4493c` en rojo (6 casos unitarios y el e2e); corrección en `72b6f08`. Ejecuciones del pipeline: se completan al abrir el PR.

## DEF-15 — `LiquidacionStatus.Pendiente` no existe en el paquete compartido

- **Requisito afectado:** ninguno funcional; paridad entre la base y el código compartido.
- **Origen:** revisión de código; la prueba de paridad de enums lo registraba como deriva conocida.
- **Caso que lo detecta:** CP-135.
- **Severidad:** baja. Una liquidación en ese estado llega a la web sin etiqueta traducida y la máquina de estados no la conoce.
- **Pasos para reproducir:** quitar `Pendiente` de la lista de excepciones de `enum-parity.spec.ts`.
- **Resultado esperado:** la paridad pasa sin excepciones para `LiquidacionStatus`.
- **Resultado obtenido:** falla porque el valor está en Prisma y no en shared.
- **Causa raíz:** la migración `20260714120000_liquidaciones_services` creó el valor y nadie lo agregó a `enums.ts`; además un comentario de `penalties.scheduler.ts` afirmaba que no existía.
- **Corrección:** el valor entra al enum y a la máquina de estados como estado heredado sin transiciones (no se inventa un flujo), con traducción en es y en, variante de etiqueta en la web y el comentario corregido.
- **Prueba de regresión:** CP-135 en `test/unit/enum-parity.spec.ts` y `liquidacion-state-machine.spec.ts`.
- **Evidencia rojo/verde:** commit de regresión `8cf7ef1` en rojo (1 caso); corrección en `b5dc17d`. Ejecuciones del pipeline: se completan al abrir el PR.
