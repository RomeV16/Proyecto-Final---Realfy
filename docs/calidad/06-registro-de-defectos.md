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
| DEF-09 | Un archivo de importación subido por una inmobiliaria se puede usar desde otra | Media | — | CP-85 | [#111](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/111) | Corregido (30 oct) |
| DEF-10 | El cronograma de ajustes encadena cada fecha a la anterior, en hora local, y un período desconocido se toma como trimestral | Media | RF-12 | CP-130 | [#118](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/118) | Corregido (31 oct) |
| DEF-11 | Períodos, "hoy" y meses de documentos se arman en hora local del proceso | Media | — | CP-131 | [#119](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/119) | Corregido (31 oct) |
| DEF-12 | La rendición muestra totales que no suman sus líneas | Media | — | CP-132 | [#120](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/120) | Corregido (31 oct) |
| DEF-13 | El motor de liquidación acepta descuentos negativos y su total puede diferir en un centavo de lo mostrado | Baja | — | CP-133 | [#121](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/121) | Corregido (31 oct) |
| DEF-14 | La comisión acepta porcentajes mayores a 100 y montos negativos | Media | — | CP-134 | [#122](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/122) | Corregido (31 oct) |
| DEF-15 | `LiquidacionStatus.Pendiente` existe en la base y no en el paquete compartido | Baja | — | CP-135 | [#123](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/123) | Corregido (31 oct) |
| DEF-16 | Un comprobante sin pago no se puede guardar después de que el organismo ya autorizó el CAE | Alta | facturación (ítem 38) | CP-160 a CP-163 | [#124](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/124) | Corregido (31 oct) |
| DEF-17 | El PDF de la liquidación imprime "Propiedad: —" | Media | — | CP-137 | [#126](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/126) | Corregido (31 oct) |
| DEF-18 | El punitorio se calcula sobre el total de la liquidación y con el día local del servidor | Alta | — | CP-138 | [#127](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/127) | Corregido (31 oct) |
| DEF-19 | Cinco criterios distintos de "deuda", todos sobre el total y con sumas en coma flotante | Alta | — | CP-139 | [#128](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/128) | Corregido (31 oct) |
| DEF-20 | El ajuste automático sin datos de índice se aplica al 0 % y marca el cronograma como aplicado | Alta | RF-12 | CP-240 | [#129](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/129) | Corregido (31 oct) |
| DEF-21 | Dos pagos simultáneos pueden superar el saldo de la liquidación | Alta | — | CP-241 | [#130](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/130) | Corregido (31 oct) |
| DEF-22 | El aviso de vencimiento de contrato se repite cada día durante 30 días | Media | — | CP-242 | [#131](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/131) | Corregido (31 oct) |
| DEF-23 | La rendición acepta pagos y deducciones negativos | Media | — | CP-243 | [#132](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/132) | Corregido (31 oct) |
| DEF-24 | Una rendición queda marcada como enviada aunque no se envió el mail | Alta | — | CP-266, CP-267 | [#144](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/144) | Corregido (31 oct) |
| DEF-25 | El barrido y la previsualización aplican 0 % donde el cálculo manual se niega | Media | RF-12, RF-13 | CP-272 | [#146](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/146) | Corregido (31 oct) |
| DEF-26 | La previsualización de un ajuste sin datos de índice muestra 0 % | Media | RF-12 | CP-270 | [#147](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/147) | Corregido (31 oct) |
| DEF-27 | Con un mes de la ventana sin publicar el ajuste se calcula con los meses que hay y deja el alquiler corto | Media | RF-12 | CP-273 | [#152](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/152) | Corregido (31 oct) |
| DEF-28 | Cada corrida diaria suma el punitorio acumulado entero y vuelve a devengar lo condonado | Alta | — | CP-360 | [#157](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/157) | Corregido (2 nov) |
| DEF-29 | Los cobros devuelven el número del recibo sin la etiqueta impresa | Baja | — | CP-450 | [#163](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/163) | Corregido (2 nov) |
| DEF-30 | La comisión del contrato no se guarda desde la pantalla y una guardada aparece sin tipo | Media | — | CP-480 | [#164](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/164) | Corregido (2 nov) |
| DEF-65 | Un mail rechazado por Resend se informa como enviado | Alta | ítem 43 (mensajería) | CP-630 | [#171](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/171) | Corregido (3 nov) |
| DEF-70 | Un renglón Descuento suma en el reparto del cobro: comisión y neto de los locadores mal y un cobro total repartido como parcial | Alta | — | CP-660, CP-663 | [#173](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/173) | Corregido (3 nov) |
| DEF-71 | La compensación sin importe deja al locador compensado sin la comisión que ya se le había descontado | Alta | — | CP-661, CP-663 | [#174](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/174) | Corregido (3 nov) |
| DEF-72 | La compensación se asienta el día en que se carga y no se le puede indicar la fecha | Media | — | CP-662, CP-667 | [#175](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/175) | Corregido (3 nov) |
| DEF-73 | El cobro del primer mes de un contrato que empieza a mitad de mes no se reparte entre sus locadores | Alta | — | CP-668, CP-666 | [#176](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/176) | Corregido (3 nov) |
| DEF-80 | Guardar los valores por defecto pisa las convenciones de depósitos con las de fábrica | Media | — | CP-805 | [#179](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/179) | Corregido (3 nov) |
| DEF-95 | El documento de casos de uso quedó con marcas de conflicto de un merge | Baja | — | `test/unit/docs-integrity.spec.ts` | [#182](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/182) | Corregido (3 nov) |
| DEF-105 | Una unidad con consumo 0 frena el reparto por consumo de toda la boleta | Media | RF de boletas (ítem 35) | CP-1130, CP-1131 | [#188](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/188) | Corregido (3 nov) |
| DEF-106 | El consumo de las unidades sin contrato con regla se ignora y las demás pagan de más | Alta | RF de boletas (ítem 35) | CP-1133, CP-1148 | [#189](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/189) | Corregido (3 nov) |
| DEF-107 | Corregir una boleta en la planilla del mes borra su consumo por unidad, importe sin descuento y notas | Alta | RF de boletas (ítem 35) | CP-1139 | [#190](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/190) | Corregido (3 nov) |
| DEF-115 | Aplicar un ajuste no ve los índices de sistema: la previsualización lo da por listo y la aplicación lo saltea | Bloqueante | RF-12, RF-14 | CP-1200 a CP-1204 | [#200](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/200) | Corregido (3 nov) |
| DEF-125 | El importador empareja historial y cronograma por número de período sin mirar la fecha del ajuste | Alta | — | CP-1240 a CP-1245 | [#207](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/207) | Corregido (3 nov) |
| DEF-126 | Los períodos vencidos sin historial quedan salteados y no se pueden aplicar nunca | Alta | — | CP-1246 a CP-1248 | [#208](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/208) | Corregido (3 nov) |
| DEF-127 | Reenviar el lote con el ajuste en el historial no pasa el período del cronograma a aplicado | Alta | — | CP-1249, CP-1250 | [#209](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/209) | Corregido (3 nov) |
| DEF-128 | Reenviar el lote con otro período de ajuste no reconstruye el cronograma pendiente | Media | — | CP-1251 a CP-1253 | [#210](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/210) | Corregido (3 nov) |
| DEF-129 | Reenviar el lote no corrige los ajustes ya cargados con el número de período equivocado | Media | — | CP-1254, CP-1256 | [#211](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/211) | Corregido (3 nov) |
| DEF-130 | La liquidación generada antes del día del ajuste sale con el alquiler anterior | Alta | RF-12 | CP-1260, CP-1261 | [#215](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/215) | Corregido (3 nov) |
| DEF-131 | El proceso diario genera las liquidaciones antes de leer los índices y de aplicar los ajustes del día | Media | RF-12 | CP-1262 | [#216](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/216) | Corregido (3 nov) |
| DEF-132 | Sin el índice del ajuste, la liquidación sale con el alquiler anterior sin aviso y se puede aprobar | Alta | RF-12 | CP-1263 a CP-1265 | [#217](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/217) | Corregido (3 nov) |
| DEF-133 | Un ajuste aplicado después de generar el borrador no cambia el borrador | Alta | RF-12 | CP-1266 a CP-1268 | [#218](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/218) | Corregido (3 nov) |
| DEF-134 | Un ajuste aplicado después de emitir la liquidación del mes se pierde | Alta | RF-12 | CP-1269 a CP-1272 | [#219](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/219) | Corregido (3 nov) |
| DEF-135 | La prórroga de palabra de un contrato importado crea pendientes ya cubiertos por el historial de ajustes | Alta | RF-12 | CP-1280, CP-1286 | [#212](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/212) | Corregido (3 nov) |
| DEF-136 | `apply-batch` no aísla los errores no HTTP y un contrato corta el lote con 409 sin informe por contrato | Media | RF-12, FB-23 | CP-1281, CP-1286 | [#213](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/213) | Corregido (3 nov) |
| DEF-137 | Sin cronograma aplicado, el primer ajuste acumula la inflación desde el inicio del contrato aunque el alquiler importado ya esté actualizado | Alta | RF-12 | CP-1282 a CP-1285, CP-1287, CP-1288 | [#214](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/214) | Corregido (3 nov) |
| DEF-120 | Los ajustes ICL y UVA se calculan con la serie incompleta, sin aviso | Alta | RF-12, RF-13 | CP-1220 a CP-1228 | [#203](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/203) | En corrección |
| DEF-121 | No hay carga del histórico de ICL y UVA de la serie de sistema | Alta | RF-14 | CP-1230 a CP-1236 | [#205](https://github.com/RomeV16/Proyecto-Final---Realfy/issues/205) | En corrección |

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
- **Evidencia rojo/verde:** commit de regresión `92e2b99` en rojo (e2e: 1 caso en rojo de 16; unitario: 1 de 11); corrección en `5804d78`. PR [#110](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/110); pipeline verde del PR: [ejecución 41147134425](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41147134425).

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
- **Evidencia rojo/verde:** commit de regresión `d39bd85` en rojo (3 casos de 3); corrección en `848f612`. PR [#117](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/117); pipeline verde del PR: [ejecución 41153810147](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41153810147).

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
- **Evidencia rojo/verde:** commit de regresión `f934e2f` en rojo (7 casos); corrección en `708bee4`. PR [#117](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/117); pipeline verde del PR: [ejecución 41153810147](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41153810147).

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
- **Evidencia rojo/verde:** commit de regresión `670f1eb` en rojo (3 casos); corrección en `560d081`. PR [#117](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/117); pipeline verde del PR: [ejecución 41153810147](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41153810147).

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
- **Evidencia rojo/verde:** commit de regresión `9c71dc8` en rojo (7 casos); corrección en `facc2af`. PR [#117](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/117); pipeline verde del PR: [ejecución 41153810147](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41153810147).

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
- **Evidencia rojo/verde:** commit de regresión `b450fe3` en rojo (6 casos unitarios y el e2e); corrección en `e28ed88`. PR [#117](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/117); pipeline verde del PR: [ejecución 41153810147](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41153810147).

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
- **Evidencia rojo/verde:** commit de regresión `314ea95` en rojo (1 caso); corrección en `ea9a5f5`. PR [#117](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/117); pipeline verde del PR: [ejecución 41153810147](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41153810147).

## DEF-16 — Un comprobante sin pago se pierde después de que el organismo autoriza el CAE

- **Requisito afectado:** facturación electrónica (ítem 38 de la hoja de ruta).
- **Origen:** revisión de código del módulo de facturación.
- **Casos que lo detectan:** CP-160, CP-161, CP-162, CP-163.
- **Severidad:** alta. Consume un número fiscal del organismo sin dejar la fila que lo respalda.
- **Pasos para reproducir:** `POST /api/invoices/emit` sin `paymentId` (el esquema compartido lo declara opcional).
- **Resultado esperado:** 201 y un comprobante guardado sin pago asociado.
- **Resultado obtenido:** error del servidor. `Comprobante.paymentId` era NOT NULL en la base y el servicio insertaba `null`; el INSERT corre después de que el organismo ya devolvió el CAE, de modo que el comprobante quedaba autorizado y sin fila.
- **Defectos asociados en el mismo código:** la clave foránea desde `Payment` tenía `ON DELETE CASCADE`, así que borrar un pago borraba comprobantes fiscales; la moneda se guardaba siempre como `ARS` aunque el DTO trajera `monId` y cotización.
- **Causa raíz:** el modelo y el esquema compartido no coincidían, y el guardado no tenía ninguna protección después de la autorización.
- **Corrección:** migración `comprobante_pago_opcional` (`paymentId` nulo, clave foránea `ON DELETE SET NULL`); la moneda sale de `monId` (`PES` a ARS, `DOL` a USD, otro valor responde 400 antes de pedir el CAE); el guardado se reintenta tres veces y, si falla, deja el CAE, el número y los datos del comprobante en el registro de pedidos al organismo y devuelve 500 `COMPROBANTE_PERSIST_FAILED` con esos datos para recuperarlo. Limitación: el número lo asigna el organismo dentro de la emisión, por lo que no se puede reservar una fila pendiente antes de pedirlo sin volver nulos `numero` y `cae`; se eligió la variante mínima.
- **Prueba de regresión:** CP-160 a CP-162 en `test/e2e/invoices.e2e-spec.ts` y CP-163 en `invoices.service.extra.spec.ts`.

## DEF-17 — El PDF de la liquidación imprime "Propiedad: —"

- **Requisito afectado:** ninguno funcional; el comprobante de cobro al inquilino.
- **Origen:** revisión de código del backend (ítem 35).
- **Caso que lo detecta:** CP-137.
- **Severidad:** media. Todo PDF de liquidación sale sin la propiedad.
- **Pasos para reproducir:** generar el PDF de una liquidación cuyo contrato tiene una propiedad con título y dirección.
- **Resultado esperado:** `Propiedad: Depto Palermo` (título) o `Propiedad: Av. Santa Fe 1234, piso 3 B` (calle, número y unidad si no hay título).
- **Resultado obtenido:** `Propiedad: —`.
- **Causa raíz:** el servicio y el PDF leían `property.address` y `property.name`, campos que `Property` no tiene (tiene `title`, `street`, `number`, `floor` y `apartment`).
- **Corrección:** `propertyLabel` y `personName` en `packages/shared/src/format.ts` (con pruebas) y el PDF usa la etiqueta de la propiedad completa que ya traía la consulta.
- **Prueba de regresión:** CP-137 en `liquidaciones/liquidaciones-pdf.spec.ts` (verifica el contenido del `docDefinition` con el mock de pdfmake) y `packages/shared/src/format.spec.ts`.
- **Evidencia rojo/verde:** commit de regresión `e08adb7` en rojo (2 casos de 3); corrección en `ec3537d`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-18 — El punitorio se calcula sobre el total y con el día local

- **Requisito afectado:** ninguno funcional; cálculo de mora (lo que debe un inquilino).
- **Origen:** revisión de código del backend (ítem 35).
- **Caso que lo detecta:** CP-138.
- **Severidad:** alta. Se cobra mora sobre dinero que el inquilino ya pagó.
- **Pasos para reproducir:** liquidación de 1000 con un pago de 600, vencida hace 10 días, modo porcentual diario de 1 %; o liquidación pagada por completo y todavía en Enviada/Vencida; o correr el cron a las 22:30 de Buenos Aires.
- **Resultado esperado:** punitorio de 40 sobre un saldo de 400; ninguno si el saldo es 0; el día aplicado y los días de mora son los de Buenos Aires.
- **Resultado obtenido:** 100 sobre el total; un punitorio nuevo en la liquidación pagada; día aplicado y días de mora de la hora local del servidor (un día de más pasadas las 21:00).
- **Causa raíz:** el scheduler leía `total` y lo pasaba como deuda; el "hoy" salía de `setHours` local y los días de mora se contaban con getters locales sobre fechas guardadas en UTC.
- **Corrección:** la base es el saldo pendiente (`calculateRemainingBalance`, vía `receivables.ts`), sin devengo si el saldo es 0; `todayInAR()` en el scheduler y en los endpoints del controlador; `daysBetween` cuenta días UTC.
- **Prueba de regresión:** CP-138 en `penalties/penalties.scheduler.spec.ts` (3 casos).
- **Evidencia rojo/verde:** commit de regresión `c540958` en rojo (3 casos); corrección en `0320df9`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-19 — Cinco criterios distintos de deuda, sobre el total y con sumas en coma flotante

- **Requisito afectado:** ninguno funcional; cifras de morosidad que ve la inmobiliaria (panel, reportes, resumen de pagos, contexto diario).
- **Origen:** deduplicación del backend (filas 4 y 15) y limpieza L10.
- **Caso que lo detecta:** CP-139.
- **Severidad:** alta. Las mismas liquidaciones dan montos de deuda distintos según la pantalla.
- **Pasos para reproducir:** una liquidación Vencida de 250000 con un pago de 100000, una Enviada de 60000,50 con un pago de 10000,25 y ya vencida, y una Enviada de 90000 a vencer; consultar resumen de pagos, panel, contexto diario, reporte de morosidad y morosos de punitorios.
- **Resultado esperado:** todos suman el saldo pendiente de las liquidaciones por cobrar: vencido 200000,25 (150000 + 50000,25) y pendiente 90000.
- **Resultado obtenido:** vencido 250000 en el panel y los pagos, 310000,50 en la morosidad y los punitorios, y 150001 de "pendiente"; el pago parcial no se descuenta y cada lector cuenta otros estados.
- **Causa raíz:** cada lector definía por su cuenta qué estados cuentan y sumaba `total`; varias sumas de dinero usaban `Number`.
- **Corrección:** `RECEIVABLE_STATUSES` y `OVERDUE_STATUSES` en la máquina de estados compartida, `receivables.ts` (saldo por liquidación con el motor y suma con `sumMoney`) y los cinco lectores lo usan; las sumas con `Number` del panel, los pagos y las métricas de cierre pasan a `Money`.
- **Prueba de regresión:** CP-139 en `liquidaciones/deuda-lectores.spec.ts` (caracterización de los valores anteriores primero, luego los valores esperados nuevos) y `liquidaciones/receivables.spec.ts`.
- **Evidencia rojo/verde:** caracterización en verde `b549966`; regresión `103b7d5` en rojo (5 de 5 casos); corrección en `890eea6`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-20 — El ajuste automático sin datos de índice se aplica al 0 %

- **Requisito afectado:** RF-12.
- **Origen:** revisión de código del backend (ítem 35), previa al cron real.
- **Caso que lo detecta:** CP-240.
- **Severidad:** alta. El cronograma queda como aplicado y el alquiler sin actualizar, sin ningún aviso.
- **Pasos para reproducir:** `applyDueAdjustments` con un contrato IPC, ICL o CCP y ningún valor de índice en la ventana.
- **Resultado esperado:** el cronograma sigue pendiente, el alquiler no cambia y se informa `MISSING_INDEX_DATA` con el contrato, el cronograma y el índice que falta.
- **Resultado obtenido:** ajuste del 0 % (IPC vacío, ICL 1/1), cronograma marcado `Applied` y registro de auditoría con delta 0.
- **Causa raíz:** `loadParams` reemplazaba la ausencia de datos por valores neutros.
- **Corrección:** `loadParams` informa los índices faltantes y el barrido corta antes de escribir (la transacción no deja nada), registra `MISSING_INDEX_DATA` y sigue con los demás contratos.
- **Prueba de regresión:** CP-240 en `index-data/contract-adjustment.service.spec.ts` (5 casos).
- **Evidencia rojo/verde:** commit de regresión `5d4967a` en rojo (4 casos); corrección en `092e9c6`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-21 — Dos pagos simultáneos pueden superar el saldo

- **Requisito afectado:** ninguno funcional; integridad del saldo de la liquidación.
- **Origen:** revisión de código del backend (ítem 35).
- **Caso que lo detecta:** CP-241.
- **Severidad:** alta. La liquidación queda con saldo negativo.
- **Pasos para reproducir:** dos `POST /liquidaciones/:id/payments` de 100000 con `Promise.all` sobre una liquidación con saldo de 150000.
- **Resultado esperado:** uno responde 200 y el otro 400 `PAYMENT_EXCEEDS_BALANCE`; el saldo nunca es negativo.
- **Resultado obtenido:** los dos responden 200 y se registran 200000.
- **Causa raíz:** el saldo se validaba, el pago se creaba y el estado se actualizaba en operaciones separadas, sin bloqueo.
- **Corrección:** una transacción interactiva que bloquea la fila de la liquidación (`SELECT ... FOR UPDATE`, filtrando por `tenantId` a mano porque el SQL crudo no pasa por la extensión de inmobiliaria) y dentro valida el saldo, crea el pago y pasa a Pagada.
- **Prueba de regresión:** CP-241 en `test/e2e/liquidaciones.e2e-spec.ts` (dos y cinco pagos simultáneos).
- **Evidencia rojo/verde:** commit de regresión `346d028` en rojo (1 caso e2e); corrección en `2ec2616`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-22 — El aviso de vencimiento de contrato se repite cada día

- **Requisito afectado:** ninguno funcional; avisos a la inmobiliaria.
- **Origen:** revisión de código del backend (ítem 35).
- **Caso que lo detecta:** CP-242.
- **Severidad:** media. Cada usuario recibe un aviso y un mail por contrato todos los días durante 30 días.
- **Pasos para reproducir:** contrato a 25 días de vencer y correr el barrido en días consecutivos o dos veces el mismo día.
- **Resultado esperado:** un aviso por usuario, contrato y umbral (30, 15 y 7 días); ninguno repetido.
- **Resultado obtenido:** 4 avisos en dos corridas del mismo día y 8 en ocho días seguidos para un solo contrato y dos usuarios.
- **Causa raíz:** el barrido no consultaba avisos previos; la única protección de `createNotification` era una ventana de 24 horas. Además los crons no fijaban zona horaria.
- **Corrección:** umbrales en `CONTRACT_EXPIRY_THRESHOLDS_DAYS`, deduplicación por (usuario, contrato, tipo, umbral) con el umbral en el título (la tabla no tiene columna de umbral), mail solo si se creó el aviso, y los cuatro crons de avisos a las 08:00 de `America/Argentina/Buenos_Aires`.
- **Prueba de regresión:** CP-242 en `notifications/notification-scheduler.service.spec.ts` (7 casos).
- **Evidencia rojo/verde:** commit de regresión `38c23d7` en rojo (7 casos); corrección en `9f4155c`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-23 — La rendición acepta pagos y deducciones negativos

- **Requisito afectado:** ninguno funcional; lo que recibe el propietario.
- **Origen:** revisión de código del backend (ítem 35).
- **Caso que lo detecta:** CP-243.
- **Severidad:** media. Una deducción negativa sube el neto a depositar.
- **Pasos para reproducir:** `buildRendicionFromPayments` con un cobro de 100000 y una deducción de -5000, o con un pago de -20000 junto a otro positivo.
- **Resultado esperado:** error `INVALID_LINE_AMOUNT` que nombra el renglón.
- **Resultado obtenido:** neto 105000 con la deducción negativa; el pago negativo pasaba porque la comisión solo valida el cobrado total.
- **Causa raíz:** el motor validaba la comisión pero no el signo de cada renglón.
- **Corrección:** `InvalidRendicionLineError` (código `INVALID_LINE_AMOUNT`) ante un pago o deducción negativos, como el motor de liquidación; la generación de rendiciones lo devuelve como 400.
- **Prueba de regresión:** CP-243 en `rendicion-engine.spec.ts` (4 casos).
- **Evidencia rojo/verde:** commit de regresión `a5bc7e5` en rojo (3 casos); corrección en `a165c68`. PR [#133](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/133); pipeline verde del PR: [ejecución 41156766671](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41156766671).

## DEF-24 — Una rendición queda marcada como enviada aunque no se envió el mail

- **Requisito afectado:** envío de la rendición al locador (ítem 37).
- **Origen:** revisión de código al unificar el transporte de mail (L5, #143).
- **Caso que lo detecta:** CP-266 y CP-267.
- **Severidad:** alta en el piloto: el ambiente no tiene mail configurado, así que toda rendición "enviada" quedaba marcada como tal sin que el locador la recibiera.
- **Pasos para reproducir:** sin `RESEND_API_KEY`, `POST /renditions/:id/send` sobre una rendición cuyo locador tiene email; o sobre una cuyo locador no tiene email.
- **Resultado esperado:** 422 `EMAIL_NOT_CONFIGURED` (u `OWNER_EMAIL_MISSING`) con un mensaje que sugiere descargar el PDF, y `sentAt` sin cambiar.
- **Resultado obtenido:** 200; con el mail sin configurar se guardaba `sentAt` y se respondía `sent: true`; sin email del locador se respondía `sent: false` con 200, y la pantalla mostraba "enviada" en ambos casos.
- **Causa raíz:** el servicio trataba "no se envió porque no hay transporte" como un envío exitoso.
- **Corrección:** el resultado `skipped` del transporte y la falta de email responden 422 con su código y no guardan `sentAt`; la pantalla muestra el mensaje del servidor.
- **Prueba de regresión:** CP-266 y CP-267 en `renditions-send-email.spec.ts` y en `renditions.e2e-spec.ts`.
- **Evidencia rojo/verde:** commit de regresión `88bcb6f` en rojo (2 de 3 casos); corrección en `74ea392`. PR [#145](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/145).

## DEF-25 — El barrido y la previsualización aplican 0 % donde el cálculo manual se niega

- **Requisito afectado:** RF-12, RF-13.
- **Origen:** deduplicación del backend (fila 2, L3): dos caminos traducían la modalidad a parámetros del motor.
- **Caso que lo detecta:** CP-272.
- **Severidad:** media. El alquiler no se actualiza y el cronograma queda como aplicado.
- **Pasos para reproducir:** un contrato ICL con un solo valor en la ventana, un contrato de porcentaje fijo o personalizado sin `customAdjustmentPct`, o una modalidad desconocida; calcular a mano, previsualizar y correr el barrido.
- **Resultado esperado:** los tres caminos se niegan igual: 400 `MISSING_INDEX_DATA`, `MISSING_ADJUSTMENT_PCT` o `UNKNOWN_ADJUSTMENT_TYPE`, y el barrido deja el cronograma pendiente.
- **Resultado obtenido:** el cálculo manual respondía el error; la previsualización proyectaba el alquiler sin cambios y el barrido lo aplicaba con delta 0, marcaba Aplicado y auditaba.
- **Causa raíz:** `ContractsService` armaba su propio `switch` con otras reglas (ICL con al menos dos valores, porcentaje obligatorio, modalidad desconocida rechazada) y `loadParams` reemplazaba lo que faltaba por valores neutros.
- **Corrección:** `ContractsService.calculateAdjustment` delega en `ContractAdjustmentService.loadParams`, que aplica las reglas más estrictas; se eliminan el `switch` y `loadIndexData` duplicados.
- **Prueba de regresión:** CP-272 en `contracts/contract-adjustment-paths.spec.ts` (tabla de casos por modalidad).
- **Evidencia rojo/verde:** caracterización en verde `94f7793`; regresión `b3374a8` en rojo (12 casos con DEF-26); corrección en `e88da9b`. PR [#148](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/148).

## DEF-26 — La previsualización de un ajuste sin datos de índice muestra 0 %

- **Requisito afectado:** RF-12.
- **Origen:** deduplicación del backend (fila 2, L3), revisión de los caminos de ajuste.
- **Caso que lo detecta:** CP-270.
- **Severidad:** media. La pantalla del contrato muestra una proyección sin cambios que parece un resultado válido.
- **Pasos para reproducir:** `POST /contracts/:id/preview-adjustment` de un contrato IPC, ICL o CCP sin valores de índice en la ventana.
- **Resultado esperado:** 400 `MISSING_INDEX_DATA` con el índice y el período que faltan, como el cálculo manual y el barrido (DEF-20).
- **Resultado obtenido:** 201 con factor 1 y delta 0.
- **Causa raíz:** `preview` ignoraba la lista de índices faltantes que `loadParams` ya informaba desde DEF-20.
- **Corrección:** `loadParams` lanza `MISSING_INDEX_DATA` (con `indexType` y `periodStart`/`periodEnd`) y la previsualización lo propaga; la web ya muestra el error de la API.
- **Prueba de regresión:** CP-270 en `test/e2e/index-data.e2e-spec.ts` y casos de previsualización de `contracts/contract-adjustment-paths.spec.ts`.
- **Evidencia rojo/verde:** regresión `b3374a8` en rojo; corrección en `e88da9b`. PR [#148](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/148).

---

## DEF-27 — Con un mes de la ventana sin publicar el ajuste se calcula con los meses que hay

- **Requisito afectado:** RF-12.
- **Origen:** diseño del motor con rezago (ítem 34, 2.2): al revisar la ventana de índices de un ajuste.
- **Caso que lo detecta:** CP-273.
- **Severidad:** media. El alquiler queda actualizado de menos y el cronograma como aplicado, sin ningún aviso.
- **Pasos para reproducir:** un contrato IPC trimestral con el ajuste del 1 de abril y el IPC de enero, febrero y marzo cargados, sin el de abril; previsualizar o aplicar el ajuste.
- **Resultado esperado:** 400 `MISSING_INDEX_DATA` con el mes que falta (`missingPeriods: ['2025-04']`), o un ajuste provisorio con el estimado si lo hay y la inmobiliaria permite el pago a cuenta.
- **Resultado obtenido:** ajuste con tres meses de cuatro; el motor solo rechazaba una ventana sin ningún valor (DEF-20 y DEF-25 cubrieron ese caso, no el parcial).
- **Causa raíz:** `loadParams` consideraba completa cualquier ventana con al menos un valor; en las series de CVS y CER, de distinto largo, además usaba el menor de los dos.
- **Corrección:** cada mes de las series mensuales se exige por fecha; los faltantes se informan con el índice y los meses, y un mes se cubre con el estimado solo con `allowProvisional`. La caracterización cambia únicamente donde corrige una ventana parcial (el caso de CCP con series de distinto largo pasa a `MISSING_INDEX_DATA`).
- **Prueba de regresión:** CP-273 en `index-data/contract-adjustment.service.spec.ts` y casos de `contracts/contract-adjustment-paths.spec.ts`.
- **Evidencia rojo/verde:** regresión `68dc253` en rojo; corrección en `fc3f189`. PR [#153](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/153).

## DEF-28 — Cada corrida diaria suma el acumulado entero y vuelve a devengar lo condonado

- **Requisito afectado:** ninguno funcional; cálculo de mora (lo que debe un inquilino), ítem 35.
- **Origen:** al mover el cálculo de punitorios a un motor compartido (2.6).
- **Caso que lo detecta:** CP-360.
- **Severidad:** alta. Con el modo diario cada día se registraba una fila por el total de días de mora, así que la suma de las filas crecía de forma cuadrática; una fila condonada o ya cobrada no se descontaba y volvía a devengarse al día siguiente.
- **Pasos para reproducir:** monto fijo de 10 por día, una liquidación vencida; correr el cron dos días seguidos y sumar las filas, o condonar la fila y correr de nuevo.
- **Resultado esperado:** 100 el primer día y 10 el segundo (110 en total); nada nuevo tras condonar lo ya devengado.
- **Resultado obtenido:** 100 y 20 (120); el modo compuesto restaba solo las filas activas, de modo que lo condonado reaparecía.
- **Causa raíz:** `computePenalty` devolvía el devengo total para los modos simples y el scheduler lo registraba como si fuera la diferencia; la suma previa solo miraba filas activas.
- **Corrección:** el motor calcula lo devengado a la fecha sobre el saldo de cada día y el servicio registra la diferencia con todas las filas (activas, condonadas o cobradas).
- **Prueba de regresión:** CP-360 en `penalties/penalties.scheduler.def28.spec.ts` (en rojo, contra el cálculo anterior) y, ya corregido, en `penalties/penalties.scheduler.spec.ts` (devengo incremental) y `penalty-engine.spec.ts`.
- **Evidencia rojo/verde:** regresión `f05c17c` en rojo (contra el código anterior: 2 pruebas fallan y 34 pasan; se registra 110 en lugar de 10, y otra fila de 100 sobre una condonada); corrección en `400d1bc`. PR [#158](https://github.com/RomeV16/Proyecto-Final---Realfy/pull/158).

## DEF-29 — Los cobros devuelven el número del recibo sin la etiqueta impresa

- **Requisito afectado:** ninguno funcional; caja y cobros (ítem 36).
- **Origen:** revisión de la caja y cobros (3.1) al construir el estado de cuenta del locador (3.2).
- **Caso que lo detecta:** CP-450.
- **Severidad:** baja. El número que mostraba la pantalla coincidía con el impreso, pero salía de una copia de la regla en la web que podía desviarse de la de la API.
- **Pasos para reproducir:** con la serie de recibos por moneda, registrar un cobro en dólares y abrir el detalle de la liquidación o la lista de sus cobros.
- **Resultado esperado:** el cobro trae el número del recibo como se imprime (`USD-00000007`), igual que `GET /receipts`.
- **Resultado obtenido:** el cobro trae solo la serie (`RECIBO_COBRO_USD`) y el número entero (7); la web rearmaba la etiqueta con su propia copia de la regla.
- **Causa raíz:** la etiqueta impresa se armaba en el servicio de recibos y la respuesta del cobro no la incluía; la web duplicaba la regla para mostrarla.
- **Corrección:** `withReceiptLabel` arma la etiqueta en un solo lugar: el detalle de la liquidación, la lista de cobros y el cobro recién registrado devuelven `receipt.label`. La web muestra esa etiqueta y se quita su copia de la regla.
- **Prueba de regresión:** CP-450 en `apps/api/src/modules/liquidaciones/liquidaciones-cobros.def29.spec.ts`.
- **Evidencia rojo/verde:** regresión `9747812` en rojo (2 pruebas fallan: la etiqueta llega vacía en los tres cobros con recibo); corrección en `1201b92`.

## DEF-30 — La comisión del contrato no se guarda desde la pantalla y una guardada aparece sin tipo

- **Requisito afectado:** ninguno funcional; comisión del contrato (base de la cuenta corriente del locador, ítem 37).
- **Origen:** al sumar el honorario por gestión de reparaciones al formulario de comisión (3.2).
- **Caso que lo detecta:** CP-480.
- **Severidad:** media. La comisión pactada solo se podía cargar por la API; desde la pantalla guardar fallaba y el reparto de los cobros usaba el porcentaje de la inmobiliaria.
- **Pasos para reproducir:** en un contrato, abrir la comisión, elegir *Porcentaje fijo*, escribir 7 y guardar; o abrir un contrato con la comisión ya cargada.
- **Resultado esperado:** se guarda la comisión; una comisión guardada se muestra con su tipo y su porcentaje.
- **Resultado obtenido:** 400 `VALIDATION_ERROR` al guardar; una comisión guardada aparece con el tipo vacío.
- **Causa raíz:** el formulario mandaba `commissionType` y el porcentaje como número, y leía `commissionType` de la respuesta; la API usa `type` y el porcentaje como texto decimal.
- **Corrección:** el formulario usa `type` al leer y al guardar y manda el porcentaje como texto decimal.
- **Prueba de regresión:** CP-480 en `apps/web/src/components/contracts/commission-config.def30.test.tsx`.
- **Evidencia rojo/verde:** regresión `abb1338` en rojo (1 prueba falla: el tipo llega vacío); corrección en `bdb07a6`.

## DEF-65 — Un mail rechazado por Resend se informa como enviado

- **Requisito afectado:** envío de mails (ítem 43): invitaciones, liquidaciones, avisos al personal y, desde la mensajería, recibos y estados de cuenta.
- **Origen:** al montar el proveedor de mail de la bandeja de salida sobre `CommonEmailService` (PR 5.1).
- **Caso que lo detecta:** CP-630.
- **Severidad:** alta. Un mail que no salió (remitente sin verificar, dominio sin SPF/DKIM, destinatario inválido) quedaba como enviado: la bandeja de salida lo habría marcado `Sent` sin reintentar ni avisar.
- **Pasos para reproducir:** configurar `RESEND_API_KEY` con un remitente de un dominio sin verificar y mandar cualquier mail.
- **Resultado esperado:** el envío se informa como fallido con el código y el mensaje del rechazo.
- **Resultado obtenido:** `{ status: 'sent', id: 'unknown' }`.
- **Causa raíz:** el SDK de Resend (v6) no lanza ante un rechazo de la API: devuelve `{ data: null, error }`. El servicio solo trataba la excepción.
- **Corrección:** un `error` en la respuesta, o una respuesta sin id, es un envío fallido.
- **Prueba de regresión:** CP-630 en `apps/api/src/common/email/common-email.service.spec.ts`.
- **Evidencia rojo/verde:** regresión `e0040a7` en rojo (1 prueba falla: llega `status: 'sent'`); corrección en `435267e`.

## DEF-70 — Un renglón Descuento suma en el reparto del cobro

- **Requisito afectado:** ninguno funcional; reparto del cobro y cuenta corriente del locador (ítems 36 y 37).
- **Origen:** reconciliación sintética del ciclo mensual (3.5, ítem 45).
- **Caso que lo detecta:** CP-663 (la suite de reconciliación da diferencias en los contratos con devolución y con bonificación); regresión CP-660.
- **Severidad:** alta. Toda liquidación con un descuento (bonificación pactada, devolución al inquilino, corrección de un ajuste provisorio a su favor) se repartía mal: la comisión de una bonificación corría sobre el alquiler más el descuento, el neto de los locadores incluía el descuento y un cobro que saldaba la liquidación se repartía como parcial.
- **Pasos para reproducir:** liquidación de 330.000 de alquiler con una devolución de 12.000 (total 318.000); registrar un cobro de 318.000.
- **Resultado esperado:** reparto sobre 318.000: comisión 23.100 a la inmobiliaria y 294.900 a los locadores.
- **Resultado obtenido:** total del reparto 342.000, así que el cobro se trataba como parcial: 21.478,95 a la inmobiliaria y 296.521,05 a los locadores. Con una bonificación del 5 % sobre 520.000, comisión de 38.220 en lugar de 34.580.
- **Causa raíz:** la liquidación guarda el descuento en positivo y lo resta al calcular el total; el reparto sumaba todos los renglones sin mirar el tipo.
- **Corrección:** el renglón lleva su tipo al motor de reparto y un `Descuento` resta del total, de la base de la comisión y de la parte de su destino.
- **Prueba de regresión:** CP-660 en `apps/api/src/modules/cash/payment-settlement.service.spec.ts` y `packages/shared/src/settlement-engine/settlement-engine.spec.ts`; CP-663 en `packages/shared/src/reconciliation/reconciliation.characterization.spec.ts`.
- **Evidencia rojo/verde:** regresión `058a4c6` en rojo (1 prueba falla y 12 pasan); corrección en `8b50778`. Contra el reparto anterior, la suite de reconciliación da 18 diferencias en recibos y estados.

## DEF-71 — La compensación sin importe deja corto al locador compensado

- **Requisito afectado:** ninguno funcional; compensaciones entre locadores (ítem 36) y estado de cuenta (ítem 37).
- **Origen:** reconciliación sintética del ciclo mensual (3.5, ítem 45).
- **Caso que lo detecta:** CP-663; regresión CP-661.
- **Severidad:** alta. En cada compensación sin importe el locador compensado perdía la comisión (que ya tenía descontada) y quien cobró se quedaba con esa diferencia. La inmobiliaria registra unas quince compensaciones por mes.
- **Pasos para reproducir:** cobro de 100.000 de un contrato con A y B al 50 %, recibido por un locador; compensar a A desde X, otro locador, sin importe.
- **Resultado esperado:** se compensan 50.000 (lo que A figuraba teniendo en mano: su parte de 46.500 más la comisión de 3.500 que debía); A queda con 46.500 a favor y X con −50.000, como en la planilla de la inmobiliaria, donde el locador que recibe la transferencia de otro inquilino responde por todo lo que recibió.
- **Resultado obtenido:** se compensaban 46.500; A quedaba con 43.000 y X con −46.500. El ejemplo de ADR-0009 daba el resultado esperado para A pero los números de CP-401 y CP-468 fijaban el del defecto.
- **Causa raíz:** el importe por defecto era la parte neta de A en el reparto, sin la deuda que el cobro le había dejado.
- **Corrección:** `compensationDefault` en el motor de reparto: la parte del locador más lo que debía por ese cobro (su parte menos su saldo); el servicio lo usa como importe por defecto. Se corrigen los esperados de CP-401 y CP-468 y el ejemplo de ADR-0009.
- **Prueba de regresión:** CP-661 en `apps/api/src/modules/cash/compensations.service.spec.ts` y `packages/shared/src/settlement-engine/settlement-engine.spec.ts`; CP-401 y CP-468 en la suite e2e.
- **Evidencia rojo/verde:** regresión `9e20cbe` en rojo (1 prueba falla y 6 pasan: 46.500 en lugar de 50.000); corrección en `a3a30ef`.

## DEF-72 — La compensación se asienta el día en que se carga

- **Requisito afectado:** ninguno funcional; estado de cuenta del locador (ítem 37).
- **Origen:** reconciliación sintética del ciclo mensual (3.5, ítem 45), al cargar en noviembre una compensación de un cobro de julio.
- **Caso que lo detecta:** CP-667; regresión CP-662.
- **Severidad:** media. Una compensación cargada después del cierre del mes caía en el estado del mes de carga: el estado del mes del cobro de los dos locadores quedaba descuadrado y no había forma de corregirlo. La planilla de la inmobiliaria se arma con un atraso mediano de tres semanas.
- **Pasos para reproducir:** registrar un cobro con fecha 8 de enero recibido por un locador y, otro mes, compensarlo.
- **Resultado esperado:** los asientos de la compensación con la fecha del cobro (o la que se indique), en el estado de enero.
- **Resultado obtenido:** los asientos con la fecha del día de la carga.
- **Causa raíz:** el servicio tomaba siempre `todayInAR()` y el alta no aceptaba fecha.
- **Corrección:** `POST /compensations` acepta `date`; sin ella, los asientos van con la fecha del cobro. La entrega de custodia sigue con la del día salvo que se indique otra.
- **Prueba de regresión:** CP-662 en `apps/api/src/modules/cash/compensations.service.spec.ts`; CP-667 en `apps/api/test/e2e/reconciliacion.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `df2744d` en rojo (1 prueba falla y 7 pasan: los asientos salen con la fecha de hoy); corrección en `13d8da3`.

## DEF-73 — El primer mes de un contrato que empieza a mitad de mes no se reparte

- **Requisito afectado:** ninguno funcional; reparto del cobro y cuenta corriente del locador (ítems 36 y 37).
- **Origen:** reconciliación de punta a punta por la API (3.5, ítem 45), con el contrato que empieza el 15 de julio.
- **Caso que lo detecta:** CP-666; regresión CP-668.
- **Severidad:** alta. El cobro del primer mes (el proporcional) de todo contrato nuevo que no empieza el día 1 quedaba sin reparto: sin comisión, sin asientos en la cuenta corriente del locador y fuera de su estado de cuenta.
- **Pasos para reproducir:** contrato que empieza el 15 de julio; generar julio, enviar y registrar el cobro.
- **Resultado esperado:** el cobro se reparte entre los locadores vigentes al día de inicio.
- **Resultado obtenido:** el reparto queda con el error `SETTLEMENT_LESSOR_SHARES` (los porcentajes suman 0) y no deja asientos.
- **Causa raíz:** el reparto, la compensación, la boleta pagada por la inmobiliaria y los locadores del recibo en PDF leían los locadores el día 1 del mes; los del contrato rigen desde su inicio. Solo el generador de liquidaciones contemplaba el caso.
- **Corrección:** `lessorsDateFor` (el día 1 o, si el contrato empieza después, su inicio), usado en esos cuatro lugares y en el generador.
- **Prueba de regresión:** CP-668 en `apps/api/src/modules/cash/payment-settlement.service.spec.ts` y `contracts/contract-parties.spec.ts`; C11 de `apps/api/test/e2e/reconciliacion.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `d2a7af9` en rojo (1 prueba falla y 13 pasan: `SETTLEMENT_LESSOR_SHARES`); corrección en `0fae979`.

## DEF-80 — Guardar los valores por defecto pisa las convenciones de depósitos con las de fábrica

- **Requisito afectado:** ninguno funcional; valores por defecto de la inmobiliaria y depósitos de contratos (ítem 40).
- **Origen:** al sumar la sección Ventas al formulario de valores por defecto (5.6).
- **Caso que lo detecta:** CP-805.
- **Severidad:** media. Quien cambiaba cualquier valor en Configuración y guardaba perdía, sin aviso, quién guarda el depósito por defecto, el plazo de devolución y la conformidad del locador: la API los reemplazaba por los de fábrica.
- **Pasos para reproducir:** cargar por la API `operationalDefaults.deposits` con valores distintos de los de fábrica (por ejemplo, plazo de devolución de 45 días), abrir *Configuración → Valores por defecto*, cambiar el día de vencimiento y guardar; volver a leer los valores.
- **Resultado esperado:** las convenciones de depósitos quedan como estaban.
- **Resultado obtenido:** vuelven a los valores de fábrica (30 días, el locador, sin conformidad).
- **Causa raíz:** el formulario no edita `deposits` y el cuerpo que arma (`operationalDefaultsFromForm`) no lo incluye; el `PUT` reemplaza el objeto entero y completa lo que falta con los valores de fábrica.
- **Corrección:** al guardar, la pantalla reenvía las convenciones de depósitos tal como estaban guardadas.
- **Prueba de regresión:** CP-805 en `apps/web/src/components/settings/operational-defaults-form.def80.test.tsx`.
- **Evidencia rojo/verde:** regresión `36132f7` en rojo (1 prueba falla: el cuerpo llega sin `deposits`); corrección en `1be5b3a`.

## DEF-95 — El documento de casos de uso quedó con marcas de conflicto de un merge

- **Requisito afectado:** ninguno funcional; documentación de casos de uso (CU-44, CU-46 y CU-47).
- **Origen:** el merge de ventas y llaves (5.6) sobre la mensajería saliente (5.2) dejó `<<<<<<<`, `=======` y `>>>>>>>` dentro de `docs/tesis/02-roles-y-casos-uso.md`.
- **Caso que lo detecta:** `apps/api/test/unit/docs-integrity.spec.ts`.
- **Severidad:** baja. El documento se leía con marcas de git en medio y la numeración de los casos de uso parecía duplicada; no afectaba al sistema.
- **Pasos para reproducir:** buscar líneas que empiecen con `<<<<<<<`, `=======` o `>>>>>>>` en `docs/**/*.md`.
- **Resultado esperado:** ningún documento tiene marcas de conflicto.
- **Resultado obtenido:** tres marcas en `tesis/02-roles-y-casos-uso.md`.
- **Causa raíz:** un conflicto de texto (las dos ramas agregaron una sección a continuación del mismo caso de uso) se resolvió sin quitar las marcas.
- **Corrección:** se quitaron las marcas y se conservaron las dos secciones.
- **Prueba de regresión:** `apps/api/test/unit/docs-integrity.spec.ts` (ningún `.md` de `docs/` puede tener marcas de conflicto).
- **Evidencia rojo/verde:** regresión `00468e8` en rojo (1 prueba falla: tres marcas); corrección en `2720074`.

## DEF-105 — Una unidad con consumo 0 frena el reparto por consumo de toda la boleta

- **Requisito afectado:** reparto de boletas de servicios entre contratos (ítem 35, ADR-0008).
- **Origen:** al preparar la migración del piloto (edificios con una boleta para varias unidades).
- **Caso que lo detecta:** CP-1130.
- **Severidad:** media. Una unidad vacía (consumo 0) hacía que ninguna unidad recibiera su parte y la boleta quedaba sin repartir, con el motivo equivocado (`MissingConsumption`).
- **Pasos para reproducir:** repartir una boleta de 900 entre dos contratos con regla por consumo y consumos 0 y 100.
- **Resultado esperado:** la unidad en 0 no paga y la otra paga la boleta (900).
- **Resultado obtenido:** ninguna parte; las dos reglas figuran como `MissingConsumption`.
- **Causa raíz:** el motor tomaba "consumo mayor que 0" como "dato conocido", y confundía un 0 declarado con un dato faltante.
- **Corrección:** un 0 declarado es un dato (la unidad no paga); solo si todo el consumo es 0 no hay con qué repartir y se informa `MissingConsumption`.
- **Prueba de regresión:** CP-1130 y CP-1131 en `packages/shared/src/charge-split/charge-split.spec.ts`; CP-1148 en `apps/api/test/e2e/boletas-y-reglas.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `b41300a` en rojo (2 pruebas fallan); corrección en `36ddd5a`.

## DEF-106 — El consumo de las unidades sin contrato con regla se ignora y las demás pagan de más

- **Requisito afectado:** reparto de boletas de servicios entre contratos (ítem 35, ADR-0008).
- **Origen:** al revisar el reparto por consumo para cargarlo desde la pantalla.
- **Caso que lo detecta:** CP-1133.
- **Severidad:** alta, es dinero del inquilino. Con una boleta sin consumo total, las unidades con regla se repartían toda la boleta aunque otras unidades (vacías o sin regla) hubieran consumido.
- **Pasos para reproducir:** cargar una boleta de 1.000 con consumos 100 (unidad con regla) y 100 (unidad sin contrato), sin consumo total.
- **Resultado esperado:** la unidad con regla paga 500.
- **Resultado obtenido:** paga 1.000.
- **Causa raíz:** el total de consumo se calculaba solo con las unidades que tienen regla; el consumo de las demás unidades cargadas no entraba.
- **Corrección:** el total es el mayor entre el consumo declarado y la suma de todas las unidades cargadas (`billConsumption`). Además, cada unidad debe ser del edificio del servicio (`UNIT_NOT_IN_BUILDING`) y no puede repetirse.
- **Prueba de regresión:** CP-1133 en `apps/api/src/modules/services/service-bills.service.spec.ts`; CP-1148 y CP-1150 en `apps/api/test/e2e/boletas-y-reglas.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `af9f81e` en rojo (1 prueba falla: 1000.00 en vez de 500.00); corrección en `af3d3ff`.

## DEF-107 — Corregir una boleta en la planilla del mes borra su consumo por unidad, importe sin descuento y notas

- **Requisito afectado:** carga de boletas del mes (ítem 35, 2.4).
- **Origen:** al agregar el consumo por unidad a la planilla.
- **Caso que lo detecta:** CP-1139.
- **Severidad:** alta. La carga masiva reemplaza la fila completa y la planilla enviaba solo importe, vencimiento, cuota y consumo total: al corregir el importe de una boleta ya cargada, la API dejaba en blanco el consumo por unidad, el importe sin descuento y las notas, y el reparto por consumo se perdía.
- **Pasos para reproducir:** cargar por la API una boleta con `unitConsumptions`, `nominalAmount` y `notes`; en *Boletas del mes* cambiar solo el importe y guardar.
- **Resultado esperado:** los demás datos de la boleta se conservan.
- **Resultado obtenido:** quedan en blanco.
- **Causa raíz:** la planilla no reenviaba los datos que no edita.
- **Corrección:** la planilla reenvía el consumo por unidad (ahora editable), el importe sin descuento y las notas de la boleta cargada.
- **Prueba de regresión:** CP-1139 en `apps/web/src/components/service-bills/monthly-service-bills.def107.test.tsx`.
- **Evidencia rojo/verde:** regresión `60d436f` en rojo (1 prueba falla: el cuerpo no trae esos datos); corrección en `fc17ff0`.

## DEF-115 — Aplicar un ajuste no ve los índices de sistema

- **Requisito afectado:** RF-12 (ajuste de alquileres) y RF-14 (índices publicados).
- **Origen:** ensayo general del primer ciclo sobre la copia de la inmobiliaria piloto, donde todos los índices los carga el lector diario como datos de sistema (`__system__`).
- **Caso que lo detecta:** CP-1200 a CP-1204.
- **Severidad:** bloqueante. Con los índices solo de sistema ningún ajuste se podía aplicar: "Ajustes del mes" los daba por listos y al aplicarlos los salteaba con `MISSING_INDEX_DATA`; el barrido diario los dejaba pendientes y la corrección de provisorios esperaba para siempre un oficial ya publicado.
- **Pasos para reproducir:** cargar el IPC de enero y febrero solo con `tenantId = __system__`; contrato IPC trimestral desde enero con el ajuste de abril vencido; `POST /adjustments/preview-batch` con `2026-04` y después `POST /adjustments/apply-batch` con ese contrato.
- **Resultado esperado:** la previsualización y la aplicación usan los mismos índices (los propios más los de sistema, con prioridad para los propios) y el ajuste se aplica.
- **Resultado obtenido:** previsualización `ready`; aplicación `skipped` con `MISSING_INDEX_DATA` y los dos meses como faltantes.
- **Causa raíz:** la aplicación, el barrido y la corrección calculan dentro de una transacción y leen los índices con ese cliente, que pasa por la extensión de aislamiento. En las lecturas la extensión reemplazaba el filtro `tenantId in [inmobiliaria, __system__]` de `IndexDataService.getForPeriod` por `tenantId = inmobiliaria`. La previsualización lee con el cliente base y por eso sí los veía.
- **Corrección:** la extensión conserva, en los modelos con filas de sistema (`SYSTEM_SHARED_MODELS`, hoy solo `IndexData`), un filtro de lectura que pide la inmobiliaria actual y/o `__system__` y nada más; cualquier otro valor se sigue reemplazando por la inmobiliaria actual y las escrituras no cambian (ADR-0006). Se revisaron los demás lectores de datos de sistema: el listado, el último valor por índice, los estimados reemplazados, los punitorios con tasa BNA y la previsualización leen por el cliente base con el filtro explícito y no estaban afectados.
- **Prueba de regresión:** CP-1200 a CP-1203 en `apps/api/test/e2e/ajuste-masivo.e2e-spec.ts` y CP-1204 en `apps/api/test/unit/prisma-tenant.extension.spec.ts`.
- **Evidencia rojo/verde:** regresión `082a069` en rojo (4 e2e fallan: tres `MISSING_INDEX_DATA` y una corrección en espera; 2 unitarias fallan: el filtro de sistema se pisa); corrección en `f42b4d2`.

## DEF-125 — El importador empareja historial y cronograma por número de período sin mirar la fecha

- **Requisito afectado:** ninguno funcional; importación desde el sistema anterior (ítem 39, paso M7) y ajustes del mes.
- **Origen:** ensayo general del ciclo C1 sobre una copia de los datos de la inmobiliaria piloto.
- **Caso que lo detecta:** CP-1243; regresión CP-1240 a CP-1245.
- **Severidad:** alta. Quedaban aplicados períodos futuros o desalineados con la fecha de sus ajustes: el ajuste de un mes que correspondía no aparecía en "Ajustes del mes" y la ventana del siguiente arrancaba en una fecha sin ajuste.
- **Pasos para reproducir:** lote con un contrato trimestral que empieza el 1/9 y un ajuste en el historial con fecha 1/10 y `periodNumber` 1.
- **Resultado esperado:** el período se deriva de la fecha del ajuste; si la fecha no cae en el calendario del contrato (o todavía no llegó) la fila falla con `ADJUSTMENT_HISTORY_INVALID`.
- **Resultado obtenido:** el período 1 del cronograma (1/12) quedaba `Applied` y la vista previa de diciembre no lo listaba.
- **Causa raíz:** `importedSchedule` marcaba aplicados los períodos cuyo número figuraba en el historial y `checkAdjustmentHistory` sólo validaba el encadenado de montos, nunca la fecha.
- **Corrección:** `adjustmentPeriodFor` cuenta los meses calendario desde el inicio sobre la duración del período; `checkAdjustmentHistory` reemplaza el número del lote por el derivado y rechaza fechas fuera del calendario, futuras o repetidas.
- **Prueba de regresión:** CP-1240 a CP-1242 en `apps/api/src/modules/import-export/batch/contract-import-rules.spec.ts`; CP-1243 a CP-1245 en `apps/api/test/e2e/import-batches-cronograma.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `6bb3b19` en rojo (5 pruebas unitarias y 3 e2e fallan); corrección en `aa6f561`.

## DEF-126 — Los períodos vencidos sin historial quedan salteados y no se pueden aplicar nunca

- **Requisito afectado:** ninguno funcional; importación (paso M7) y ajuste masivo del mes (FB-23).
- **Origen:** ensayo general del ciclo C1.
- **Caso que lo detecta:** CP-1246; regresión CP-1246 a CP-1248.
- **Severidad:** alta. Un contrato cuyo ajuste ya había vencido al importarlo no podía ajustarse: `calculate` responde `SCHEDULE_NOT_PENDING`, la vista previa del mes no lo lista y el ajuste siguiente juntaba dos períodos.
- **Pasos para reproducir:** contrato trimestral con historial hasta el segundo ajuste y el tercer período ya vencido; consultar la vista previa de ese mes.
- **Resultado esperado:** los períodos posteriores al último ajuste del historial quedan pendientes (atrasados y aplicables); los anteriores sin historial, y todos los de un contrato sin historial, quedan como estaban definidos.
- **Resultado obtenido:** todo período vencido sin historial quedaba `Skipped`.
- **Causa raíz:** `importedSchedule` salteaba todo período vencido que no estuviera en el historial, sin distinguir los posteriores al último ajuste.
- **Corrección:** `importedSchedule` deja `Pending` lo posterior al último ajuste aunque esté vencido. El cobro retroactivo de un ajuste atrasado no se decide en la importación: lo resuelve el flujo de ajuste (ADR-0011).
- **Prueba de regresión:** CP-1246 a CP-1248 en `contract-import-rules.spec.ts` y `import-batches-cronograma.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `6bb3b19` en rojo (2 pruebas unitarias y 2 e2e fallan; CP-1248 es una guarda que ya pasaba); corrección en `aa6f561`.

## DEF-127 — Reenviar el lote con el ajuste en el historial no pasa el período del cronograma a aplicado

- **Requisito afectado:** ninguno funcional; importación idempotente (ADR-0015).
- **Origen:** ensayo general del ciclo C1.
- **Caso que lo detecta:** CP-1249; regresión CP-1249 y CP-1250.
- **Severidad:** alta. La corrección del dato en el lote (agregar el ajuste que faltaba) no llegaba al cronograma: el ajuste figuraba en el historial y el período seguía salteado o pendiente.
- **Pasos para reproducir:** importar un contrato con el último período vencido sin historial y reenviar el lote con ese ajuste agregado.
- **Resultado esperado:** el período queda `Applied` y los siguientes `Pending`; reenviar otra vez es `SinCambios`.
- **Resultado obtenido:** el cronograma guardado no se tocaba.
- **Causa raíz:** `addMissingSchedule` sólo agregaba los períodos que faltaban.
- **Corrección:** `syncSchedule` y `planScheduleSync` reconcilian el cronograma con el que sale del lote: corrigen estado y fecha de pendientes y salteados, y no tocan los aplicados que tienen un ajuste detrás ni los calculados.
- **Prueba de regresión:** CP-1249 y CP-1250 en `import-batches-cronograma.e2e-spec.ts`; CP-1255 en `contract-import-rules.spec.ts`.
- **Evidencia rojo/verde:** regresión `6bb3b19` en rojo (CP-1249 falla; CP-1250 es una guarda que ya pasaba); corrección en `aa6f561`.

## DEF-128 — Reenviar el lote con otro período de ajuste no reconstruye el cronograma pendiente

- **Requisito afectado:** ninguno funcional; importación idempotente (ADR-0015).
- **Origen:** ensayo general del ciclo C1.
- **Caso que lo detecta:** CP-1251; regresión CP-1251 a CP-1253.
- **Severidad:** media. Se mezclaban fechas viejas y nuevas y quedaba el mismo mes duplicado, uno aplicado y otro pendiente.
- **Pasos para reproducir:** importar un contrato con ajuste cuatrimestral o semestral y reenviarlo como trimestral.
- **Resultado esperado:** se reconstruyen los pendientes con el período nuevo, sin tocar los aplicados.
- **Resultado obtenido:** los períodos existentes conservaban su fecha y sólo se agregaban los que faltaban.
- **Causa raíz:** la misma que DEF-127: el cronograma existente no se reconciliaba.
- **Corrección:** `planScheduleSync` actualiza la fecha de los pendientes y salteados, quita los pendientes que el calendario nuevo ya no tiene y no toca los aplicados con ajuste ni los aplicados por el flujo de ajuste.
- **Prueba de regresión:** CP-1251 a CP-1253 en `import-batches-cronograma.e2e-spec.ts`.
- **Evidencia rojo/verde:** regresión `6bb3b19` en rojo (CP-1251 a CP-1253 fallan); corrección en `aa6f561`.

## DEF-129 — Reenviar el lote no corrige los ajustes ya cargados con el número de período equivocado

- **Requisito afectado:** ninguno funcional; importación idempotente (ADR-0015).
- **Origen:** ensayo general del ciclo C1; sale de corregir DEF-125 sobre los contratos que ya estaban cargados.
- **Caso que lo detecta:** CP-1254; regresión CP-1254 y CP-1256.
- **Severidad:** media. Con el período derivado de la fecha, reenviar el lote habría creado un ajuste nuevo por cada fecha y dejado los viejos, con el cronograma de la carga anterior.
- **Pasos para reproducir:** contrato importado antes con números de período que no corresponden a las fechas de sus ajustes; reenviar el lote.
- **Resultado esperado:** los ajustes importados pasan al período de su fecha sin duplicarse y el cronograma queda como el calendario indica.
- **Resultado obtenido:** los ajustes viejos se conservaban en el período equivocado.
- **Causa raíz:** los ajustes se emparejaban por número de período.
- **Corrección:** `misplacedImportedAdjustments` detecta los ajustes importados (nota `Imported`, no provisorios) cuya fecha figura en el historial con otro período; se quitan y se vuelven a crear en el período que corresponde.
- **Prueba de regresión:** CP-1254 en `import-batches-cronograma.e2e-spec.ts`; CP-1256 en `contract-import-rules.spec.ts`.
- **Evidencia rojo/verde:** regresión `6bb3b19` en rojo (CP-1254 falla); corrección en `aa6f561`.

## DEF-130 — La liquidación generada antes del día del ajuste sale con el alquiler anterior

- **Requisito afectado:** RF-12 (ajuste del alquiler) y la generación de liquidaciones (ADR-0010, ADR-0011).
- **Origen:** ensayo general del primer ciclo en sombra (liquidación de diciembre) sobre una copia local de la base de la inmobiliaria piloto; la regresión usa un contrato sintético (IPC trimestral desde el 1/9/2026, $100.000, rezago 2).
- **Caso que lo detecta:** CP-1260 y CP-1261.
- **Severidad:** alta. La inmobiliaria liquida alrededor del 20 del mes anterior con el ajuste que rige desde el 1; el sistema generaba ese mes con el alquiler anterior y aplicaba el ajuste recién el día 1, así que el mes del ajuste no se cobraba nunca.
- **Pasos para reproducir:** cargar el IPC de septiembre y octubre; generar diciembre (`POST /liquidaciones/generate` o el proceso diario del 21/11).
- **Resultado esperado:** diciembre con el alquiler ajustado (105.060) y el cronograma del 1/12 aplicado.
- **Resultado obtenido:** diciembre con 100.000 y el ajuste pendiente.
- **Causa raíz:** el alquiler del período sale de los ajustes ya aplicados y nadie aplicaba antes los que vencen dentro del mes que se liquida.
- **Corrección:** la generación aplica primero, cada uno en su transacción, los ajustes pendientes con fecha hasta el fin del mes (`applyDueAdjustments` con origen `generation`) y los informa en `adjustments`.
- **Prueba de regresión:** CP-1260 y CP-1261 en `apps/api/test/e2e/ajuste-del-mes-en-la-liquidacion.e2e-spec.ts`; CP-1260 en `liquidaciones-generacion.spec.ts`.
- **Evidencia rojo/verde:** regresión `af6442c` en rojo (2 pruebas fallan: diciembre sale con 100.000); corrección en `e6e4187`.

## DEF-131 — El proceso diario genera las liquidaciones antes de leer los índices y de aplicar los ajustes del día

- **Requisito afectado:** RF-12; procesos diarios.
- **Origen:** el mismo ensayo, al revisar la hora de los procesos.
- **Caso que lo detecta:** CP-1262.
- **Severidad:** media. El día en que se publica el índice la generación (06:00) corría a la par de la lectura de índices (06:00) y antes de los ajustes (07:00).
- **Pasos para reproducir:** leer la expresión `@Cron` de los tres procesos.
- **Resultado esperado:** la generación corre después de la lectura de índices y de los ajustes del día.
- **Resultado obtenido:** 06:00, la misma hora que la lectura de índices.
- **Causa raíz:** la hora se fijó sin mirar la dependencia.
- **Corrección:** la generación pasa a las 07:30 de Buenos Aires.
- **Prueba de regresión:** CP-1262 en `apps/api/src/modules/liquidaciones/liquidaciones.scheduler.spec.ts`.
- **Evidencia rojo/verde:** regresión `9e5e7ec` en rojo (1 prueba falla: 360 no es mayor que 420); corrección en `bfa318f`.

## DEF-132 — Sin el índice del ajuste, la liquidación sale con el alquiler anterior sin aviso y se puede aprobar

- **Requisito afectado:** RF-12; ADR-0011 (un dato faltante es un error visible).
- **Origen:** ensayo general del primer ciclo en sombra (liquidación de diciembre) sobre una copia local de la base de la inmobiliaria piloto; la regresión usa un contrato sintético (IPC trimestral desde el 1/9/2026, $100.000, rezago 2).
- **Caso que lo detecta:** CP-1263 a CP-1265.
- **Severidad:** alta. Con el índice todavía sin publicar el mes salía con el alquiler anterior, sin ninguna advertencia, y se podía aprobar y enviar.
- **Pasos para reproducir:** cargar solo el IPC de septiembre; generar diciembre; pasar a revisión y aprobar.
- **Resultado esperado:** la generación informa el ajuste pendiente; la liquidación lleva la advertencia bloqueante `ADJUSTMENT_PENDING` y aprobarla responde 409. Con estimado y pago a cuenta activo rige ADR-0011 (provisorio). Un ajuste a mitad de mes con `DesdePeriodoSiguiente` bloquea el mes siguiente.
- **Resultado obtenido:** sin advertencia; se aprueba.
- **Causa raíz:** ADR-0011 no definía qué hace la liquidación con un ajuste pendiente y la generación no lo miraba.
- **Corrección:** `warnings` calculadas al leer (detalle, listado y resultado de la generación, con `adjustmentPending`) por los ajustes sin aplicar que empiezan a regir en el período, y la aprobación (también en lote) bloqueada con 409 `ADJUSTMENT_PENDING`; un ajuste atrasado de meses anteriores no bloquea (`2044134`).
- **Prueba de regresión:** CP-1263 a CP-1265 en `ajuste-del-mes-en-la-liquidacion.e2e-spec.ts`; `adjustment-pending.spec.ts`; `liquidacion-detail.screen.test.tsx` y `liquidacion-list.screen.test.tsx` en la web.
- **Evidencia rojo/verde:** regresión `0f19ba5` en rojo (3 pruebas fallan: sin `warnings` ni `adjustmentPending`); corrección en `a4900de`.

## DEF-133 — Un ajuste aplicado después de generar el borrador no cambia el borrador

- **Requisito afectado:** RF-12.
- **Origen:** ensayo general del primer ciclo en sombra (liquidación de diciembre) sobre una copia local de la base de la inmobiliaria piloto; la regresión usa un contrato sintético (IPC trimestral desde el 1/9/2026, $100.000, rezago 2).
- **Caso que lo detecta:** CP-1266 a CP-1268.
- **Severidad:** alta. Después de aplicar el ajuste había que borrar y regenerar a mano cada borrador (el procedimiento del ensayo lo pedía antes del cron del 21/11).
- **Pasos para reproducir:** generar diciembre sin el IPC de octubre; cargar un cargo a mano; cargar octubre y aplicar el ajuste (Ajustes del mes, la corrida del día siguiente o calcular y aplicar desde el contrato).
- **Resultado esperado:** el borrador pasa a 105.060 de alquiler, conserva el cargo y no lleva cobro retroactivo.
- **Resultado obtenido:** sigue con 100.000.
- **Causa raíz:** aplicar un ajuste no avisaba a las liquidaciones.
- **Corrección:** `ContractAdjustmentService.onApplied`/`notifyApplied` después de confirmar el ajuste; las liquidaciones en Borrador o En Revisión desde el mes del ajuste rehacen sus renglones de alquiler, primer mes diferido y bonificación con el mismo armado de la generación y conservan los demás.
- **Prueba de regresión:** CP-1266 a CP-1268 en `ajuste-del-mes-en-la-liquidacion.e2e-spec.ts`; `liquidaciones-recalculo.spec.ts`, `contract-adjustment.service.spec.ts` y `contract-adjustment-paths.spec.ts`.
- **Evidencia rojo/verde:** regresión `34dc6f5` en rojo (3 pruebas fallan: el borrador queda en 105.000 de total); corrección en `f1c2dd6`.

## DEF-134 — Un ajuste aplicado después de emitir la liquidación del mes se pierde

- **Requisito afectado:** RF-12; ADR-0010 (convenciones pactables) y ADR-0011.
- **Origen:** ensayo general del primer ciclo en sombra (liquidación de diciembre) sobre una copia local de la base de la inmobiliaria piloto; la regresión usa un contrato sintético (IPC trimestral desde el 1/9/2026, $100.000, rezago 2). En el ensayo, tres contratos quedaban con diciembre sin ajuste y enero ajustado.
- **Caso que lo detecta:** CP-1269 a CP-1272.
- **Severidad:** alta. El mes emitido con el alquiler anterior no se recuperaba nunca.
- **Pasos para reproducir:** diciembre emitido a 100.000; aplicar el ajuste del 1/12; generar enero.
- **Resultado esperado:** con la convención `Retroactivo` (de fábrica) la diferencia de diciembre queda como cargo `AjusteRetroactivo` y entra en enero (110.120 = 105.060 + 5.060), comisionable y a favor del locador; con `SinRetroactivo` enero sale ajustado sin cargo.
- **Resultado obtenido:** ningún cargo; enero sale ajustado sin la diferencia.
- **Causa raíz:** la corrección retroactiva de ADR-0011 cubre solo provisorio contra oficial; no había regla para un ajuste aplicado tarde.
- **Corrección:** convención `lateAdjustmentBilling` (valor por defecto de la inmobiliaria, columna en la versión de reglas, migraciones `20261103193255_enums_ajuste_tardio` y `20261103193256_ajuste_tardio`); al aplicarse el ajuste, la diferencia por mes emitido (alquiler neto de bonificaciones con el ajuste menos sin él) va al centro de carga, una vez por ajuste y mes.
- **Prueba de regresión:** CP-1269 a CP-1271 en `ajuste-del-mes-en-la-liquidacion.e2e-spec.ts`; `liquidaciones-recalculo.spec.ts`, `charges.service.spec.ts`; CP-1272 en `packages/shared/src/schemas/contract-rules.schema.spec.ts`; verificación de ensayo `checks/26_ajuste_tardio.sql`.
- **Evidencia rojo/verde:** regresión `dfa7fb6` en rojo (3 pruebas fallan: no hay cargo y la convención no existe); corrección en `57a9bf2`.

## DEF-135 — La prórroga de palabra de un contrato importado crea pendientes ya cubiertos por el historial de ajustes

- **Requisito afectado:** RF-12, ajuste periódico del alquiler; prórroga de palabra (ítem 40).
- **Origen:** ensayo general del ciclo de diciembre sobre la copia de la inmobiliaria piloto.
- **Caso que lo detecta:** CP-1280.
- **Severidad:** alta. Registrar la prórroga de un contrato importado cuyo historial siguió después del fin pactado dejaba el contrato sin poder ajustarse: el lote del mes respondía 409.
- **Pasos para reproducir:** contrato activo importado con fin pactado vencido y ajustes históricos hasta después de ese fin; `POST /contracts/:id/oral-extension`; `POST /adjustments/apply-batch` del mes.
- **Resultado esperado:** los ajustes pendientes arrancan después del último ajuste efectivamente aplicado, historial incluido.
- **Resultado obtenido:** pendientes con períodos y fechas ya registrados en el historial; al aplicar, el índice único `(contractId, periodNumber, isProvisional)` rechazaba el ajuste.
- **Causa raíz:** `rebuildPendingSchedule` tomaba como ancla el último período no pendiente del cronograma y no miraba `contract_adjustments`, que en un contrato importado puede ir más allá del cronograma.
- **Corrección:** el ancla es el período más reciente entre el cronograma resuelto y el historial de ajustes.
- **Prueba de regresión:** CP-1280 (`prorroga-y-lote.e2e-spec.ts`) y CP-1286 (`contract-rules-lifecycle.spec.ts`).
- **Evidencia rojo/verde:** regresión `926b33c` en rojo (las pruebas unitarias y CP-1280 fallan: los pendientes repiten los períodos 4 a 6); corrección en `edf8482`.

## DEF-136 — `apply-batch` no aísla los errores no HTTP y un contrato corta el lote con 409 sin informe por contrato

- **Requisito afectado:** RF-12 y FB-23, aplicación masiva de los ajustes del mes.
- **Origen:** ensayo general del ciclo de diciembre sobre la copia de la inmobiliaria piloto.
- **Caso que lo detecta:** CP-1281.
- **Severidad:** media. Quien aplicaba el lote veía un error global aunque los contratos anteriores ya estuvieran aplicados (cada uno en su transacción): el resultado no decía qué se había hecho.
- **Pasos para reproducir:** `POST /adjustments/apply-batch` con varios contratos, uno de los cuales viola un índice único al aplicarse.
- **Resultado esperado:** cada contrato informa su resultado; el lote nunca oculta lo ya aplicado.
- **Resultado obtenido:** 409 `CONFLICT` para todo el lote, sin informe por contrato.
- **Causa raíz:** `AdjustmentBatchService.apply` relanzaba cualquier error que no fuera una `HttpException`.
- **Corrección:** el contrato que falla se informa con `result: error` y su código (`CONFLICT` para el índice único, `ADJUSTMENT_FAILED` para el resto) y el lote sigue con los demás; el error se registra en el log.
- **Prueba de regresión:** CP-1281 (`prorroga-y-lote.e2e-spec.ts`) y CP-1286 (`adjustment-batch.service.spec.ts`).
- **Evidencia rojo/verde:** regresión `926b33c` en rojo (el lote responde 409 y la prueba unitaria recibe el error); corrección en `42d0e6a`.

## DEF-137 — Sin cronograma aplicado, el primer ajuste acumula la inflación desde el inicio del contrato aunque el alquiler importado ya esté actualizado

- **Requisito afectado:** RF-12, ajuste periódico del alquiler; ADR-0010 y ADR-0011.
- **Origen:** ensayo general del ciclo de diciembre sobre la copia de la inmobiliaria piloto.
- **Caso que lo detecta:** CP-1282.
- **Severidad:** alta. Un contrato importado sin historial, con los períodos vencidos salteados, calculaba su primer ajuste con la inflación de dos años (más de 70 %) sobre un alquiler que la inmobiliaria ya había actualizado.
- **Pasos para reproducir:** contrato importado sin historial, todos los períodos vencidos en `Skipped`; prórroga de palabra; `POST /adjustments/preview-batch` del mes del primer pendiente.
- **Resultado esperado:** la ventana arranca en la fecha desde la que rige el alquiler vigente.
- **Resultado obtenido:** la ventana arrancaba en el inicio del contrato (veintitrés meses de índice en la prueba).
- **Causa raíz:** `resolveAdjustmentWindow` solo miraba el último cronograma `Applied`; sin él, caía al inicio del contrato, y tampoco miraba el historial de ajustes.
- **Corrección:** la ventana arranca en el último ajuste aplicado (cronograma o historial) o, sin ninguno, en el último período salteado fuera de los meses fijos iniciales. Recuperar la inflación salteada no estaba definido: se agregó la convención `skippedAdjustmentsMode` (`NoRecuperar` de fábrica, `Recuperar`), pactable por contrato y con valor por defecto de la inmobiliaria (ADR-0010).
- **Prueba de regresión:** CP-1282 a CP-1285 (`prorroga-y-lote.e2e-spec.ts`, `adjustment-window.spec.ts`).
- **Evidencia rojo/verde:** regresión `926b33c` en rojo (la prueba unitaria de la ventana y CP-1282 fallan); corrección en `f0ab144`.
## DEF-120 — Los ajustes ICL y UVA se calculan con la serie incompleta, sin aviso

- **Requisito afectado:** RF-12 y RF-13 (cálculo y aplicación de ajustes), ADR-0011.
- **Origen:** ensayo general del primer ciclo del piloto sobre una copia de los datos de la inmobiliaria piloto.
- **Caso que lo detecta:** CP-1220 y CP-1227.
- **Severidad:** alta. El alquiler se ajusta con un porcentaje sin relación con el período, y la previsualización lo muestra como «listo».
- **Pasos para reproducir:** cargar el ICL de sistema solo desde una fecha posterior al inicio de la ventana de un ajuste trimestral y previsualizar o aplicar el ajuste del mes.
- **Resultado esperado:** 400 `MISSING_INDEX_DATA` con la fecha de la ventana que no tiene valor; el cronograma sigue pendiente y el alquiler no cambia.
- **Resultado obtenido:** «listo» con un porcentaje absurdo (por ejemplo, un trimestre que ajusta una fracción de punto porcentual; una UVA con base Original que baja el alquiler más de la mitad), y la aplicación lo escribe.
- **Causa raíz:** para el ICL y la UVA el cálculo tomaba el primer y el último valor existentes dentro de la ventana, aunque no estuvieran en sus extremos (inicio y fin de la ventana). Las series mensuales ya exigían cada mes (DEF-27); las diarias solo exigían dos valores.
- **Corrección:** el valor de una fecha en las series diarias (el BCRA las publica todos los días corridos, feriados incluidos) es el de esa fecha: si falta el de la fecha de inicio o el de la fecha de fin de la ventana, el ajuste responde `MISSING_INDEX_DATA` con esas fechas, en el cálculo manual, la previsualización y la aplicación. El IPC no tenía el problema.
- **Prueba de regresión:** CP-1220 a CP-1226 en `apps/api/src/modules/index-data/contract-adjustment-rules.spec.ts`; CP-1227 y CP-1228 en `apps/api/test/e2e/ajuste-masivo.e2e-spec.ts`.
- **Evidencia rojo/verde:** pendiente de completar con las confirmaciones.

## DEF-121 — No hay carga del histórico de ICL y UVA de la serie de sistema

- **Requisito afectado:** RF-14 (índices de sistema).
- **Origen:** ensayo general del primer ciclo del piloto; la serie de sistema solo tenía los últimos días y varios contratos necesitan el histórico.
- **Caso que lo detecta:** CP-1230.
- **Severidad:** alta. Sin el histórico, los ajustes ICL y UVA de esos contratos quedan en `MISSING_INDEX_DATA` (DEF-120) y la carga manual por inmobiliaria taparía los valores futuros de la serie de sistema.
- **Pasos para reproducir:** buscar una operación que cargue el ICL o la UVA de sistema para un rango de fechas pasado: el lector diario pide siempre los últimos 60 días.
- **Resultado esperado:** una operación de administración, idempotente por (tipo, fecha), que cargue la serie de sistema para un rango y avise de los días sin dato.
- **Resultado obtenido:** no existe.
- **Corrección:** `POST /api/index-data/backfill` (solo Admin) con `indexType`, `from` y `to`: pide el rango al BCRA por tramos, inserta solo los días que faltan en la serie de sistema y devuelve cuántos insertó, cuántos ya estaban, cuántos difieren y los días que el BCRA no devolvió.
- **Prueba de regresión:** CP-1230 a CP-1236 en `index-scraper.service.spec.ts`, `index-data.controller.spec.ts` y `apps/api/test/e2e/index-data-backfill.e2e-spec.ts`.
- **Evidencia rojo/verde:** pendiente de completar con las confirmaciones.
