# Plan de pruebas de aceptación en campo y reconciliación del piloto

| Campo | Valor |
|---|---|
| Versión | 1.0 |
| Fecha | 2 de noviembre de 2026 |
| Alcance | El ciclo mensual de alquileres de la inmobiliaria piloto reproducido en el ambiente `piloto`: ajustes, boletas, cargos, punitorios, liquidaciones, cobros y estados de cuenta |
| Requisitos cubiertos | Objetivos específicos del piloto (`../tesis/30-piloto.md`); ítem 45 del cronograma (#103) |
| Casos de uso | CU-08, CU-09, CU-10, CU-11, CU-13, CU-30, CU-31, CU-33 y el que agregue el ítem 37 |
| Ambiente | `piloto`, con datos reales; la evidencia vive fuera del repositorio |
| Historial | 1.0: versión inicial, antes de la línea base y del primer ciclo |

## 1. Qué se prueba y qué no

**Dentro del alcance.** Que Realfy produzca, para el mes que se liquida, los mismos importes que la inmobiliaria obtiene con su sistema actual, contrato por contrato y locador por locador, y que lo haga con las reglas pactadas en cada contrato. La prueba no es sobre una función aislada sino sobre el ciclo completo con una cartera real: si un recibo difiere, la causa puede estar en el ajuste, en el reparto de una boleta, en un cargo, en el punitorio, en la comisión o en los datos importados, y el procedimiento tiene que poder decir cuál.

**Fuera del alcance.** Lo que ya prueban los otros niveles: los motores de cálculo con valores conocidos, los endpoints con permisos y aislamiento, las migraciones sobre una base con datos sintéticos, la integración con las fuentes de índices y el rendimiento (`02-plan-de-pruebas.md`). Este plan no repite esas pruebas; las da por condición de entrada. Tampoco cubre la facturación electrónica por cuenta del locador, la mensajería ni las ventas, que entran al piloto en ciclos posteriores y se agregarán en una versión siguiente.

## 2. Niveles

La aceptación en campo tiene dos mitades, porque los datos reales no pueden estar en el repositorio y la prueba tiene que poder repetirse sin ellos.

| Nivel | Qué verifica | Datos | Dónde vive | Estado |
|---|---|---|---|---|
| Reconciliación sintética | Que el recibo, la comisión y el neto de cada contrato, y el total de cada estado de cuenta, coinciden con los valores esperados calculados a mano para casos construidos con la forma de los reales (varios locadores, boletas repartidas, cargos, punitorios, prorrateo, ajuste provisorio) | Sintéticos | Suite de la integración continua (PR 3.5 del ítem 45); sus casos se numeran en `05-casos-de-prueba.md` en ese PR | Planificado para S15 |
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
4. Se comparan con un script fuera del repositorio, que produce un informe de diferencias por contrato y por concepto.
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
