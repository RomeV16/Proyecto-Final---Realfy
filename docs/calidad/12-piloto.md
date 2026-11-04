# Plan de pruebas de aceptación en campo y reconciliación del piloto

| Campo | Valor |
|---|---|
| Versión | 1.2 |
| Fecha | 4 de noviembre de 2026 |
| Alcance | El ciclo mensual de alquileres de la inmobiliaria piloto reproducido en el ambiente `piloto`: ajustes, boletas, cargos, punitorios, liquidaciones, cobros y estados de cuenta |
| Requisitos cubiertos | Objetivos específicos del piloto (`../tesis/30-piloto.md`); ítem 45 del cronograma (#103) |
| Casos de uso | CU-08, CU-09, CU-10, CU-11, CU-13, CU-30, CU-31, CU-33 y el que agregue el ítem 37 |
| Ambiente | `piloto`, con datos reales; la evidencia vive fuera del repositorio |
| Historial | 1.0: versión inicial, antes de la línea base y del primer ciclo. 1.1: suite de reconciliación sintética (sección 9) y procedimiento del C1 con la versión privada. 1.2: dos ensayos generales del C1 sobre una copia de `piloto` y procedimiento del C1 ajustado con lo que mostraron (sección 10) |

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
- **Consentimiento.** La publicación de esos resúmenes agregados en el repositorio y en la tesis requiere el consentimiento de la inmobiliaria, que está pendiente (`../privacidad-datos.md`, «Anonimización para la tesis»). Hasta tenerlo, el repositorio registra solo que el ciclo se hizo, su fecha y los FB y DEF que generó; los agregados se guardan con el resto de la evidencia y se publican si el consentimiento llega. Los dos ensayos generales previos al C1 (sección 10) no son un ciclo: se corrieron sobre una copia, sin que nadie de la inmobiliaria operara el sistema, y se informan con cantidades y porcentajes agregados, sin nombres, importes ni identificadores de contratos. Su publicación sigue sujeta al mismo consentimiento: si la inmobiliaria no lo da, se retiran de este documento y del informe final.

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

## 10. Ensayos generales previos al C1

El C1 es la primera reconciliación con datos reales y no admite repetirse (un ciclo que no cumple la salida se informa como está, sección 3). Por eso, antes de generar nada en `piloto`, se ensayó dos veces, el 3 y el 4 de noviembre, lo que el sistema haría el día del C1. Los ensayos no reemplazan al C1: dicen qué diferencias tendría si se corriera hoy y permitieron corregir antes lo que era un defecto de Realfy. Todos los resultados son cantidades y porcentajes; la evidencia detallada (planilla, reportes por contrato, respuestas de la API) vive fuera del repositorio.

### Método

1. **Copia restaurada.** Se restauró en una base local la copia lógica más reciente de `piloto`, con su suma de verificación (la del 3/11 para el primer ensayo, con el código desplegado entonces; la posterior al despliegue de las correcciones, para el segundo). Nunca se llamó a la API ni a la base del ambiente.
2. **API local en modo prueba.** El código de `main` corrió con los procesos programados apagados y la mensajería apagada, con un administrador local que se borró con la base.
3. **Resultado esperado guardado antes.** Se usó como referencia la planilla de liquidación de octubre, la más reciente con la liquidación hecha, con su huella. No existe todavía el libro de noviembre ni el de diciembre.
4. **Mismo comparador del C1.** La herramienta de reconciliación del C1 (sección 9, «Versión con datos reales») sin cambios, con tolerancia cero.
5. **Dos períodos.** Octubre se genera como borrador y se compara con la planilla. Diciembre, que es el período del C1, no tiene planilla: se simula lo que harían los procesos diarios (índices, ajustes y generación) y se contrasta, contrato por contrato, con lo que la práctica de la inmobiliaria hace en noviembre y diciembre según su base.
6. **Supuestos declarados.** El IPC de octubre se supuso igual al de septiembre, porque el INDEC lo publica alrededor del 12/11; las boletas de diciembre se supusieron con el importe de la ficha de cada servicio; y las prórrogas de palabra del segundo ensayo usaron una fecha inventada. Los importes de ajuste de diciembre son por eso ficticios; los meses y la mecánica no.

### Primer ensayo (C0, 3 de noviembre)

Octubre se generó como borrador para todos los contratos que liquidan ese mes y se comparó con la planilla. Resultados cuantitativos (contratos comparados, coincidencias al centavo y sin contar impuestos, contratos con diferencia): **a completar tras el consentimiento de la inmobiliaria**. Lo que sí se puede decir en general, porque describe el método y el tipo de diferencia y no la cartera:

| Tipo de diferencia | Resultado |
|---|---|
| Alquiler, comisión, cargos y punitorios | Reproducen la planilla al centavo en todos los contratos comparados |
| Impuestos y servicios | Casi toda la diferencia: las boletas todavía no estaban cargadas (paso M9 de la migración), y las reglas de traslado de M8 rigen desde el 1/11 |
| Datos | Dos contratos fuera de la comparación por datos: un canon pactado en UVA cargado en cero y un contrato que empieza después de octubre |
| Regla distinta o error del sistema | Ninguno en octubre |

Diciembre, si no se hacía nada hasta el proceso diario del 21/11: ningún contrato ajusta, porque ningún ajuste podía aplicarse (D1). La coincidencia al centavo proyectada era muy baja; con una coordinación manual simulada, con rodeos para sortear los defectos, mejoraba pero seguía sin reproducir una parte importante de los ajustes de la práctica (cifras: a completar tras el consentimiento de la inmobiliaria).

| Defecto | Gravedad | Descripción técnica | DEF |
|---|---|---|---|
| D1 | Bloqueante | Aplicar un ajuste no ve los índices de sistema: la extensión de aislamiento pisa el filtro de la inmobiliaria y del sistema dentro de una transacción; la previsualización lo da por listo y la aplicación lo saltea. En `piloto`, donde todos los índices son de sistema, ningún ajuste se podía aplicar | DEF-115 |
| D2 | Alta | Las series de nivel (ICL y UVA) se calculan con la serie incompleta, sin aviso; la serie de sistema solo tenía los últimos dos meses y faltaba cargar el histórico | DEF-120, DEF-121 |
| D3, D4, D9 | Alta | El importador empareja historial y cronograma por número de período sin mirar la fecha, deja salteados los períodos vencidos que no se pueden aplicar nunca, y al reenviar el lote no reconstruye el cronograma | DEF-125 a DEF-129 |
| D5 | Alta | La generación anticipada del mes no incluye el ajuste que rige desde el día 1: el mes se perdía y el siguiente salía ajustado | DEF-130 a DEF-134 |
| D6, D7, D8 | Alta | La prórroga de palabra de un contrato importado crea períodos ya cubiertos por el historial, un error en un contrato corta el lote entero, y sin cronograma aplicado el primer ajuste acumula la inflación desde el inicio del contrato | DEF-135 a DEF-137 |
| D10, D11 | Media y baja | Silencios: una boleta en otra moneda que el contrato nunca se factura, la liquidación con alquiler cero, el consumo faltante en un edificio con reparto por consumo, y un ajuste personalizado sin porcentaje | DEF-140 a DEF-143 |

Los once problemas, registrados como veinte defectos, se corrigieron en seis pedidos paralelos, cada uno con su regresión en rojo, y se integraron el 3/11 (`../calidad/06-registro-de-defectos.md`).

### Segundo ensayo (C0b, 3 y 4 de noviembre)

Se repitió con la copia posterior al despliegue de los arreglos de ajustes y de la carga del histórico de ICL y UVA, que incluye el reenvío del lote de contratos con sus correcciones. Octubre dio lo mismo que en el primer ensayo: ninguna regresión, y una diferencia nueva que es dato y no código, porque la generación ahora aplica los ajustes pendientes del mes y el importador ya no deja salteados los períodos posteriores al último ajuste del historial (DEF-126, DEF-130).

| Tema | Primer ensayo | Segundo ensayo |
|---|---|---|
| Ajustes sin hacer nada | Ninguno se aplica (D1) | Se aplican solos por los procesos diarios; el proceso programado reproduce el lote por API |
| Mes de ajuste de la práctica reproducido | Ninguno sin hacer nada; una parte con todos los rodeos manuales | Una parte sin hacer nada y la gran mayoría con la prórroga de palabra registrada por API, sin rodeos (cifras: a completar tras el consentimiento de la inmobiliaria) |
| Ajustes salteados al importar que la práctica sí aplica | Varios | Ninguno fuera de los contratos con historial inválido |
| ICL y UVA | Porcentajes falsos con la serie de dos meses | Histórico completo y porcentajes coherentes |
| Prórroga de palabra | 409, períodos duplicados, ajuste que acumulaba la inflación desde el inicio | Sin errores, con un defecto nuevo (E1) |
| Generación del mes | Sin el ajuste y sin aviso | Aplica antes de liquidar; avisa en los que no puede (`ADJUSTMENT_PENDING`) |
| Impuestos | Sin boletas: difieren los contratos con impuestos | Igual: M9 todavía no está cargado |

**Coincidencia estimada del C1 por escenario.** Se estimó para cuatro escenarios: A (sin hacer nada) y B (con las prórrogas registradas), cada uno sin boletas y con las boletas de diciembre cargadas. Un contrato cuenta como *igual* si ningún lado ajusta en noviembre o diciembre y Realfy repite el alquiler de la planilla; como *a validar* si el mes de ajuste coincide con la práctica (el monto depende del redondeo y del IPC real, que entra igual en los dos lados), y como *distinto* si la práctica ajusta y Realfy no, o al revés. Para dar un número puntual se aplica la tasa de coincidencia al centavo de los ajustes de IPC históricos con la fórmula de Realfy, medida en el primer ensayo. Los porcentajes y rangos por escenario son **a completar tras el consentimiento de la inmobiliaria**.

La conclusión cualitativa es publicable: la estimación sube mucho al cargar las boletas, y lo que más la mueve ya no es Realfy sino tres datos: **las boletas** (M9), **las prórrogas** de los contratos con fin pactado vencido y **la regla de redondeo** del alquiler ajustado, de la que depende la mayoría de los contratos «a validar». Es una estimación sobre supuestos, no el resultado del C1.

Defectos nuevos del segundo ensayo, en el pedido #242 (abierto al 4/11):

| Defecto | Gravedad | Descripción técnica | DEF |
|---|---|---|---|
| E1 | Media | La prórroga de palabra de un contrato importado sin historial deja pendiente un período anterior a la importación, y el proceso diario lo aplica además del siguiente: doble ajuste | DEF-173 |
| E2 | Baja | Con base de ajuste original el ajuste puede bajar el alquiler sin aviso, y el porcentaje informado es el del índice y no el del alquiler | DEF-174 a DEF-176 |

El segundo ensayo se corrió sin las correcciones de D10 y D11, que se integraron después (#222): con ellas, los veinte defectos del primer ensayo están corregidos en `main` al 4/11. Los dos nuevos se registran en `06-registro-de-defectos.md` con su pedido. Queda anotado, para corregirlo en la herramienta antes del C1, que la herramienta de reconciliación toma como vacante una fila sin alquiler aunque cobre impuestos y suma dólares y pesos en el total de la planilla.

### Qué se hizo antes del 4/11

- **Despliegue conjunto.** Las correcciones de índices, cronograma, prórroga y ventana se integraron y desplegaron juntas el 3/11, con copia previa y ensayo de las migraciones sobre una copia restaurada, y no por separado: con solo la corrección de D1 el proceso diario habría empezado a aplicar ajustes sobre cronogramas que todavía estaban mal.
- **Datos.** Se cargó el histórico de ICL y UVA y se reenvió el lote de contratos con las correcciones de los documentos (`../tesis/32-migracion.md`).
- **Ajustes retenidos.** Antes del proceso de ajustes del 4/11 a las 07:00, el segundo ensayo mostró que se aplicarían ajustes que la práctica no hizo: unos de un contrato cuyo historial no coincide con su tipo de índice, y otros de un contrato cuyo documento y cuyo lote difieren en la periodicidad. Se marcaron como salteados en `piloto`, dentro de una transacción verificada, y quedan así hasta confirmar con la inmobiliaria qué ajuste corresponde; el lote no se reenvía sobre ellos mientras tanto. Los otros ajustes de noviembre coinciden en el mes con la práctica.

### Reglas de dinero que los ensayos dejaron abiertas

Todas están configuradas con un valor por defecto, no bloquean el desarrollo y se deciden con la inmobiliaria y el equipo antes de aprobar diciembre:

- **Redondeo del alquiler ajustado.** La práctica mezcla centavo, peso y porcentaje a dos decimales; Realfy redondea al centavo un porcentaje de cuatro decimales. Es la regla con más efecto en el porcentaje al centavo. El ensayo propone, si la regla no se decide antes, informar el C1 con la tolerancia cero de la sección 4 y además con una tolerancia declarada de ±1 peso en el alquiler ajustado y de centavos en las cuentas compartidas; lo decide el equipo con la inmobiliaria.
- **Los ajustes salteados y el ajuste del mes cuando la liquidación ya se generó**: si se cobran de forma retroactiva o rigen desde el mes siguiente sin recuperar lo salteado, y si el siguiente ajuste recupera la inflación que quedó sin aplicar.
- **Primer ajuste con rezago de dos meses** (dos o tres meses de índice) y **ICL y UVA con o sin rezago**; ya figuraban entre las reglas a confirmar en el C1 (sección 9).
- **Impuestos en pesos en contratos en dólares**: moneda del renglón, tipo de cambio o recibo aparte.
- **Un ajuste que baja el alquiler** (base original con índice que no subió lo suficiente): hoy se salta con el motivo `RENT_DECREASE_REQUIRES_REVIEW` y queda pendiente de revisión.
- **Ajustes vencidos al importar que la práctica no aplicó**: hoy el proceso diario los aplica solos al día siguiente del despliegue, sin revisión; falta decidir si exigen una confirmación la primera vez.

Además hay preguntas abiertas a la inmobiliaria sobre contratos concretos (prórrogas de los contratos con fin vencido, calendario de ajuste de algunos, ajustes personalizados sin porcentaje), que se registran como hallazgos cuando se contestan.

### Procedimiento del C1 ajustado

Del primer ensayo salieron cambios al procedimiento de la sección 9, que los reemplazan:

1. **Orden de los procesos diarios.** Lectura de índices a las 06:00, ajustes a las 07:00 y generación de las liquidaciones a las 07:30, hora de Buenos Aires (DEF-131). El proceso de generación del período corre el 21/11, diez días antes del mes.
2. **Antes de ese proceso**: confirmar que el IPC de octubre está en la serie (el INDEC lo publica alrededor del 12/11), correr la previsualización de Ajustes del mes de diciembre y revisarla, y cargar las boletas de diciembre por el circuito automático (M9). Si falta el índice, los ajustes de IPC quedan pendientes, las liquidaciones salen con la advertencia `ADJUSTMENT_PENDING` y no se pueden aprobar hasta que el índice llegue.
3. **Si el proceso de generación corrió antes de tener las boletas**, se borran los borradores y se regeneran.
4. **Antes de aprobar diciembre**, revisar los contratos con la advertencia de ajuste pendiente, los de alquiler cero y los que tienen una boleta en otra moneda sin trasladar (`GET /service-bills/unbilled`).
