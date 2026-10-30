# Registro de defectos

Versión 1.3 — 28 de octubre de 2026 (1.0: 19 de octubre; 1.2: 20 de octubre). Cada defecto se registra con la
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
