# Plan de pruebas de aceptación en campo y reconciliación del piloto

| Campo | Valor |
|---|---|
| Versión | 1.1 |
| Fecha | 3 de noviembre de 2026 |
| Alcance | El ciclo mensual de alquileres de la inmobiliaria piloto reproducido en el ambiente `piloto`: ajustes, boletas, cargos, punitorios, liquidaciones, cobros y estados de cuenta |
| Requisitos cubiertos | Objetivos específicos del piloto (`../tesis/30-piloto.md`); ítem 45 del cronograma (#103) |
| Casos de uso | CU-08, CU-09, CU-10, CU-11, CU-13, CU-30, CU-31, CU-33 y el que agregue el ítem 37 |
| Ambiente | `piloto`, con datos reales; la evidencia vive fuera del repositorio |
| Historial | 1.0: versión inicial, antes de la línea base y del primer ciclo. 1.1: suite de reconciliación sintética (sección 9) y procedimiento del C1 con la versión privada |

## 1. Qué se prueba y qué no

**Dentro del alcance.** Que Realfy produzca, para el mes que se liquida, los mismos importes que la inmobiliaria obtiene con su sistema actual, contrato por contrato y locador por locador, y que lo haga con las reglas pactadas en cada contrato. La prueba no es sobre una función aislada sino sobre el ciclo completo con una cartera real: si un recibo difiere, la causa puede estar en el ajuste, en el reparto de una boleta, en un cargo, en el punitorio, en la comisión o en los datos importados, y el procedimiento tiene que poder decir cuál.

**Fuera del alcance.** Lo que ya prueban los otros niveles: los motores de cálculo con valores conocidos, los endpoints con permisos y aislamiento, las migraciones sobre una base con datos sintéticos, la integración con las fuentes de índices y el rendimiento (`02-plan-de-pruebas.md`). Este plan no repite esas pruebas; las da por condición de entrada. Tampoco cubre la facturación electrónica por cuenta del locador, la mensajería ni las ventas, que entran al piloto en ciclos posteriores y se agregarán en una versión siguiente.

## 2. Niveles

La aceptación en campo tiene dos mitades, porque los datos reales no pueden estar en el repositorio y la prueba tiene que poder repetirse sin ellos.

| Nivel | Qué verifica | Datos | Dónde vive | Estado |
|---|---|---|---|---|
| Reconciliación sintética | Que el recibo, la comisión y el neto de cada contrato, y el total de cada estado de cuenta, coinciden con los valores esperados calculados a mano para casos construidos con la forma de los reales (varios locadores, boletas repartidas, cargos, punitorios, prorrateo, ajuste provisorio) | Sintéticos | Suite de la integración continua: `packages/shared/src/reconciliation` y `apps/api/test/e2e/reconciliacion.e2e-spec.ts` (CP-660 a CP-668, sección 9) | En la integración continua desde el 3 de noviembre |
| Reconciliación en campo | Que los mismos totales coinciden con los del sistema actual de la inmobiliaria para el mes real | Reales | Fuera del repositorio, con acceso restringido al equipo | Desde el C1 |
| Aceptación de uso | Que las personas de la inmobiliaria pueden hacer cada paso del ciclo y cómo lo valoran | Reales | Registro de feedback y métricas del piloto | Desde el C2 |

La reconciliación sintética es la que cualquiera puede volver a correr; la de campo es la evidencia de que el sistema sirve con datos reales. Cada diferencia que la de campo encuentre y que venga de una regla general se convierte, además, en un caso sintético nuevo, para que la integración continua la vigile desde entonces.

## 3. Ciclos

| Ciclo | Fecha de liquidación | Qué se reconcilia | Quién opera Realfy |
|---|---|---|---|
| Línea base | ≈ 20/11/2026 | Nada: se mide el ciclo actual de la inmobiliaria, por tarea | Nadie |
| C1, en sombra | ≈ 20/11/2026 | Recibos por contrato del mes de diciembre | El equipo |
| C2, en paralelo | ≈ 20/12/2026 | Recibos por contrato y estados de cuenta por locador | El equipo, con la inmobiliaria comparando |
| C3 | ≈ 20/01/2027 | Recibos, estados de cuenta y cobros del mes | La inmobiliaria, con su sistema actual de respaldo |
| C4 | ≈ 20/02/2027 | Lo mismo que C3, con Realfy como sistema principal | La inmobiliaria |

### Criterios de entrada de cada ciclo

- Lo que el ciclo necesita está integrado en `main` con la integración continua en verde y desplegado en `piloto` siguiendo `../operacion-piloto.md`, con la copia previa tomada.
- La cartera cargada está al día: las correcciones de la revisión con la inmobiliaria se reenviaron como lote y el panel de calidad de datos no tiene hallazgos de severidad error sin decisión en los contratos del ciclo.
- Los índices del mes de ajuste están cargados o, si el INDEC no publicó, los ajustes afectados están identificados como provisorios.
- El resultado esperado del ciclo —los totales del sistema actual— está guardado antes de generar nada en Realfy, para que la comparación no se acomode al resultado.

### Criterios de salida de cada ciclo

- Cada contrato liquidado en el mes tiene su comparación hecha, sin excepciones.
- Cada diferencia distinta de cero tiene su causa y su registro (sección 5).
- Las diferencias atribuidas a Realfy tienen su defecto abierto; si impiden emitir un recibo correcto, el defecto lo dice en su severidad («bloquea el cierre del mes») y se corrige antes del ciclo siguiente.
- La evidencia del ciclo está guardada (sección 6) y la copia de la base posterior al ciclo está verificada.

Un ciclo que no cumple la salida no se repite: se informa como está, con sus diferencias abiertas, y el ciclo siguiente arranca con esas diferencias como entrada.

## 4. Reconciliación por ciclo

### Unidad de comparación

**Por contrato, desde el C1.** Para cada contrato liquidado en el mes se comparan, renglón por renglón y en total, los conceptos del recibo:

| Concepto | Qué se compara |
|---|---|
| Alquiler | Alquiler del mes con el último ajuste aplicado, prorrateado si corresponde |
| Ajuste | Que el ajuste del mes exista o no, su porcentaje y el alquiler resultante; si es provisorio, el índice estimado usado |
| Impuestos y servicios | La parte del inquilino de cada boleta, con su regla de traslado |
| Cargos | Reparaciones, expensas extraordinarias, devoluciones y demás cargos imputados al inquilino |
| Punitorios | El punitorio del período anterior que entra en el recibo, y lo condonado |
| Total del recibo | La suma de lo anterior |
| Comisión | La comisión de la inmobiliaria sobre lo comisionable |
| Neto al locador | Lo que corresponde a los locadores, y su reparto entre ellos cuando hay más de uno |

**Por locador, desde el C2.** Para cada locador se compara el total del estado de cuenta del mes —ingresos por unidad, gastos, honorarios, transferencias, compensaciones y saldo arrastrado— con el que arma la inmobiliaria. Requiere la cuenta corriente del locador (ítem 37).

### Tolerancia

**Cero.** La comparación es al centavo, en la moneda del contrato. No hay una tolerancia por redondeo: los motores redondean al centavo con una regla explícita y reparten los residuos por el método del mayor resto, y el sistema actual también produce un importe exacto. Una diferencia de un centavo es una diferencia, se investiga y se registra como cualquier otra; si resulta de una regla de redondeo distinta, la regla se documenta como hallazgo y se decide cuál aplicar.

### Procedimiento

1. Antes de generar nada, se guardan los totales del sistema actual para el mes: por contrato, los conceptos de la tabla anterior; por locador, el total del estado de cuenta.
2. Se ejecuta el ciclo en Realfy en el orden de `../operacion-piloto.md`, «Cierre de mes».
3. Se exportan los totales de Realfy con la misma forma.
4. Se comparan con un script fuera del repositorio, que produce un informe de diferencias por contrato y por concepto (sección 9, «Versión con datos reales»).
5. Cada diferencia se analiza hasta encontrar su causa y se registra (sección 5).
6. Se resume el ciclo con cifras agregadas (sección 6).

## 5. De la diferencia al registro

Toda diferencia distinta de cero termina en una de estas categorías, con su registro dentro de las 24 horas de detectada:

| Causa | Registro | Qué se hace |
|---|---|---|
| Error de Realfy: un cálculo, un reparto o una regla mal implementada | Defecto `DEF-nn` en `06-registro-de-defectos.md`, con issue `defecto` y origen piloto | Prueba de regresión en rojo antes de la corrección, con datos sintéticos que reproducen el caso; corrección por PR; nuevo despliegue siguiendo el procedimiento controlado |
| Regla que el sistema actual aplica de forma implícita y Realfy no conoce | Hallazgo `FB-nn` en `../tesis/31-registro-de-feedback.md`, con origen relevamiento o uso real según quién lo detectó | Decisión documentada: se agrega como regla configurable, se resuelve con un acuerdo del contrato o se decide no replicarla, con el motivo |
| Dato importado incorrecto o incompleto | Hallazgo `FB-nn` si revela un patrón; si es un caso puntual, solo la corrección | Corrección en el origen de la migración y reenvío del lote, que por ser idempotente toca solo lo que cambió |
| Error del sistema actual | Hallazgo `FB-nn` con la decisión «Realfy es correcto» | Se informa a la inmobiliaria con el detalle del cálculo; no se cambia Realfy |

Una diferencia no queda «explicada» por tener una hipótesis: queda explicada cuando la causa se reprodujo, en Realfy o en el sistema actual. Hasta entonces figura como abierta en el resumen del ciclo.

## 6. Evidencia

- **Fuera del repositorio.** Los totales del sistema actual, las exportaciones de Realfy, el informe de diferencias y las notas de análisis de cada ciclo se guardan en el almacenamiento privado del equipo, con acceso restringido, junto con el resto de los datos del piloto. Nunca se suben al repositorio, ni siquiera parcialmente o anonimizados a mano.
- **En el repositorio.** Solo los registros que el procedimiento genera —defectos y hallazgos, redactados como reglas generales sin nombres ni importes— y, por ciclo, un resumen agregado: cantidad de contratos comparados, cantidad de diferencias por categoría de la sección 5 y cuántas quedaron abiertas.
- **Consentimiento.** La publicación de esos resúmenes agregados en el repositorio y en la tesis requiere el consentimiento de la inmobiliaria, que está pendiente (`../privacidad-datos.md`, «Anonimización para la tesis»). Hasta tenerlo, el repositorio registra solo que el ciclo se hizo, su fecha y los FB y DEF que generó; los agregados se guardan con el resto de la evidencia y se publican si el consentimiento llega.

## 7. Métricas por ciclo

Las metas son las de `../tesis/30-piloto.md` y se fijaron antes de medir. Este plan solo dice de dónde sale cada una.

| Métrica | Fuente | Desde |
|---|---|---|
| Diferencias sin explicar | Resumen del ciclo (sección 4) | C1 |
| Tiempo del ciclo mensual | Registro por tarea de la línea base y de cada ciclo operado por la inmobiliaria | Línea base y C3 |
| Atraso del estado de cuenta | Fecha de cierre del mes y fecha de entrega al locador | Línea base y C2 |
| Errores de carga | Correcciones de datos posteriores a la emisión del recibo | C1 |
| Valoración de uso | Puntaje en la sesión quincenal con cada usuario | C2 |
| Tiempo de detección a corrección | Fechas de registro y de verificación de cada FB y DEF del ciclo | C1 |

## 8. Riesgos del plan

| Riesgo | Mitigación |
|---|---|
| Los totales del sistema actual no se pueden obtener con la misma forma que los de Realfy | Se acuerda con la inmobiliaria qué planilla es la fuente de cada concepto antes de la línea base |
| La comparación se acomoda al resultado | El esperado se guarda antes de generar en Realfy (criterio de entrada) |
| Un defecto bloquea el cierre del mes en Realfy | En sombra y en paralelo el sistema oficial sigue siendo el de la inmobiliaria; el ciclo se informa con el defecto abierto |
| Un despliegue de corrección en medio del ciclo cambia resultados ya comparados | La corrección se despliega con copia previa y se vuelve a comparar todo el ciclo, no solo el contrato afectado |
| Exponer datos reales al documentar | Solo agregados, y solo con consentimiento (sección 6) |

La relación con el resto del proceso de calidad está en `02-plan-de-pruebas.md`, y los riesgos del proyecto, en `04-riesgos.md`.

## 9. Suite de reconciliación

### Formato y comparador

El resultado de un ciclo se expresa en un formato plano (`ReconciliationResult`, en `packages/shared/src/reconciliation/format.ts`) que pueden escribir por igual un caso esperado hecho a mano, los motores, la lectura de la API o un script que lea la planilla de la inmobiliaria:

- **Por contrato**, los conceptos de la sección 4: alquiler mensual vigente y porcentaje del ajuste del mes, renglones agrupados por concepto y destino (alquiler, ajuste retroactivo, descuentos, impuestos y servicios al ente o al locador, cargos al locador o a la inmobiliaria, punitorios), total del recibo, comisión, neto de los locadores, lo cobrado en el mes y la parte de cada locador.
- **Por locador y moneda**, los totales del estado de cuenta: apertura, créditos, débitos, pagos y cierre.

El comparador (`compareReconciliation`) usa tolerancia cero: un importe distinto en un centavo, o que falta de un lado, es una diferencia; el mismo importe escrito distinto no lo es. Devuelve una lista ordenada de diferencias (contrato o locador, concepto, esperado y obtenido).

### Caso de caracterización

El caso (`characterization.fixture.ts`) es un julio de 2026 sintético con once contratos y nueve locadores, con la forma de la cartera real y sin ningún dato de ella: IPC trimestral con rezago, ICL anual, porcentaje fijo, escalonado y un alquiler en dólares; dos locadores con porcentajes de cobro distintos de su titularidad; un locador con tres unidades (estado consolidado) y saldo inicial; boletas de los tres pagadores, un impuesto anual en cuotas y un servicio de edificio repartido por consumo; cargos al inquilino y al locador, uno que pide anticipo; bonificación, devolución y prorrateo; un punitorio con el máximo entre la tasa del Banco Nación y un piso diario; un cobro parcial, un inquilino que le paga directo al locador, efectivo en custodia, una compensación y pagos a locadores. Los esperados se calcularon a mano, con aritmética decimal exacta, y su derivación está en el encabezado del caso.

Corre en dos niveles, los dos en la integración continua:

| Prueba | Qué recorre | Casos |
|---|---|---|
| `reconciliation.characterization.spec.ts` (Jest del paquete compartido) | `runCycle`: los motores encadenados como la API (ajustes, boletas, cargos, punitorios, liquidación, reparto de cada cobro, cuenta corriente y estado) | CP-663 a CP-665 |
| `reconciliacion.e2e-spec.ts` (e2e de la API) | El mismo ciclo cargado por la API, de los índices a los estados de cuenta, comparado con el mismo esperado | CP-666 y CP-667 |

La suite encontró cuatro defectos, todos con su regresión en rojo y su corrección (`06-registro-de-defectos.md`): el descuento sumaba en el reparto del cobro (DEF-70), la compensación sin importe dejaba corto al locador compensado (DEF-71), la compensación se asentaba el día de la carga (DEF-72) y el cobro del primer mes de un contrato que empieza a mitad de mes no se repartía (DEF-73).

### Reglas a confirmar en el C1

La suite reproduce las reglas tal como están decididas. Tres de ellas pueden diferir de lo que hace la inmobiliaria y se verifican en la primera reconciliación con datos reales; si difieren, cada una se registra como hallazgo (sección 5), no como defecto:

- **Primer ajuste con rezago.** La ventana del primer ajuste empieza en el inicio del contrato (ADR-0011): con rezago 2, el primer ajuste trimestral usa dos meses de índice. La planilla aplica a todos los contratos que ajustan en el mes el mismo porcentaje trimestral (tres meses).
- **Rezago del ICL.** El rezago de la inmobiliaria (`ipcLagMonths`) se copia a los contratos de todas las modalidades, incluidos los de ICL, cuyo valor se toma habitualmente a la fecha del ajuste. El caso sintético pacta rezago 0 para su contrato de ICL.
- **Boleta del locador pagada por la inmobiliaria con traslado parcial.** Si la inmobiliaria paga una boleta con traslado «Propietario» de la que el inquilino paga solo una parte, el estado del locador descuenta esa parte (ADR-0009) y no la boleta entera; en la planilla, el impuesto pagado por la inmobiliaria va entero a los gastos del dueño. El caso sintético usa un traslado del 100 %, donde las dos reglas coinciden.

### Versión con datos reales

La versión con datos reales vive fuera del repositorio, en el almacenamiento privado del equipo, y no se sube nunca. Lee la planilla de recibos del mes de la inmobiliaria y una copia restaurada de la base de `piloto` (nunca el ambiente en sí), compara por contrato con la misma regla de tolerancia cero y escribe un informe privado con cada diferencia y su categoría (dato faltante, regla distinta, error del sistema, error de la planilla) y un resumen solo con cantidades y porcentajes, apto para la tesis si llega el consentimiento (sección 6).

Procedimiento del C1 (liquidación de diciembre, ≈ 20 de noviembre de 2026):

1. Antes de generar nada, se guarda la planilla del mes con su huella (criterio de entrada).
2. El coordinador genera las liquidaciones de diciembre en `piloto`, en borrador.
3. Se toma la copia de la base siguiendo `../operacion-piloto.md` y se restaura en una base local de solo lectura.
4. Se corre el script de reconciliación del período sobre la planilla y la copia restaurada.
5. Se revisa cada diferencia con la dirección de la inmobiliaria y se le asigna su causa.
6. Cada diferencia distinta de cero queda registrada como FB o DEF (sección 5); una que revele una regla general suma además un contrato al caso sintético.

