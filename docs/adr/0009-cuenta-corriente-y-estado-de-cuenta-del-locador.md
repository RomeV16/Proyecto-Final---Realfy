# ADR-0009: Cuenta corriente y estado de cuenta del locador

## Estado

Aceptado. Reemplaza a la rendición por contrato (`OwnerRendicion`), que queda como
histórico de solo lectura.

## Fecha

2026-11-02.

## Contexto

Hasta ahora lo que se le pagaba a un locador salía de la **rendición por contrato**:
una por contrato, mes y locador, armada a partir de lo cobrado en el mes, menos la
comisión y los conceptos que se agregaban a mano, hasta llegar a un «depósito neto».

El relevamiento de la inmobiliaria piloto muestra otra forma de trabajar (FB-10):

- Cada locador tiene un **acumulador**: un estado de cuenta único por persona, que
  junta todas sus unidades, con los ingresos de cada una, los gastos (impuestos,
  reparaciones, honorarios), las transferencias, las entregas de efectivo y las
  compensaciones, y un **saldo que se arrastra** de un mes al siguiente.
- Ese estado se arma a mano en planillas, con atraso (mediana de 22 días para los
  locadores con varias unidades) y errores de copiado.
- Los saldos iniciales se cargan a mano y tienen que poder corregirse.
- El estado se imprime y, a algunos locadores, se les manda por WhatsApp o por mail;
  no hay formatos personalizados por locador.
- El dinero no siempre pasa por la inmobiliaria: a veces cobra el locador
  directamente y le debe la comisión; a veces la inmobiliaria guarda efectivo en
  custodia; a veces un inquilino le paga a otro locador (compensación). La caja de
  la inmobiliaria y el reparto de cada cobro ya resuelven esa parte (ADR-0012).

Una rendición por contrato no puede expresar un saldo que se arrastra ni un estado
con varias unidades, y recalculaba el reparto a fin de mes sobre lo cobrado.

## Decisión

### Cuenta corriente: un asiento por cada movimiento de dinero del locador

`OwnerLedgerEntry` es el libro de cada locador. Cada asiento tiene persona,
contrato y unidad (opcionales), fecha, mes del estado al que va (`period`), concepto,
**importe con signo**, moneda, descripción y **origen** (`sourceType`/`sourceId`).

- **Signo**: positivo, la inmobiliaria le debe al locador; negativo, se le descuenta
  o ya recibió el dinero. El saldo es la suma de los asientos.
- **Una sola vez**: el par (origen, persona, concepto) es único
  (`@@unique([tenantId, sourceType, sourceId, personId, type])`); volver a asentar el
  mismo origen no duplica.
- **En la misma transacción** que la operación que lo origina: si el cobro, la
  compensación o el pago no se guardan, el asiento tampoco.

| Operación | Asientos | Origen |
|---|---|---|
| Cobro que recibe la inmobiliaria (flujo a) | Por locador, su parte bruta de cada concepto a su favor: `Alquiler` (alquiler, ajustes, descuentos), `Punitorio` (multa), `ReintegroImpuesto` (impuestos y servicios que pasan al locador), `Ajuste` (otros); y en negativo `Comision` y `Honorario` (gastos administrativos). Suman exactamente su parte del cobro. | `Payment` |
| Cobro con custodia (flujo c) | Los mismos que en el flujo a: la custodia es dinero del locador que guarda la inmobiliaria y forma parte de su saldo. | `Payment` |
| Cobro que recibe el locador (flujo b) | Los mismos conceptos brutos y además `CobroDirecto` (negativo): lo que ya tiene en mano, menos lo que retiene para pagar entes. | `Payment` |
| Compensación | `Compensacion` negativa para quien cobró y positiva para el locador al que le correspondía. Pagada con la custodia de quien cobró, no agrega otro asiento: su custodia ya era parte de su saldo. | `Compensation` |
| Entrega de efectivo en custodia | `EntregaEfectivo` negativa. | `CashMovement` |
| Pago al locador desde una cuenta | `Transferencia` o `EntregaEfectivo` negativa, junto con el egreso `PagoLocador` de la cuenta. | `CashMovement` |
| Boleta con traslado «Propietario» pagada por la inmobiliaria | `PagoEnte` negativa por la parte asignada al contrato, repartida entre sus locadores según su porcentaje. Si la boleta deja de figurar pagada por la inmobiliaria, se borra. | `ServiceBill` |
| Cargo al locador del centro de carga | `Cargo` (negativo si es un gasto, positivo si es un crédito) entre quienes lo soportan; si es una reparación y el contrato pacta un porcentaje de honorario por gestión (`ContractCommission.repairMgmtFeePct`), también `Honorario`. | `PendingCharge` |
| Saldo inicial | `SaldoInicial`, uno por locador y moneda, editable con motivo y auditado. | `OpeningBalance` (id: la moneda) |

Un cobro cuyo reparto no se pudo hacer (por ejemplo, locadores que no suman 100) no
deja asientos: queda en el panel para revisar. `Custodia` existe como concepto, pero
ninguna operación lo usa todavía.

**Quién soporta un cargo al locador**: el locador indicado en el cargo; si no, los
locadores del contrato vigentes a la fecha del cargo, según su porcentaje; si el
cargo es de una unidad sin contrato, los del último contrato de la unidad y, si no
hay, sus titulares a la fecha. Si nadie lo soporta, queda pendiente.

**Redondeo**: cada concepto se calcula al centavo en la proporción de la parte del
locador en el cobro; el centavo de diferencia va al primer crédito (normalmente el
alquiler), así que los asientos de cada locador suman exactamente su parte.

### Cómo se lee el saldo en cada flujo

Liquidación de 100000 de alquiler, comisión del 7 % y dos locadores al 50 %:

- **(a) Cobra la inmobiliaria**: `Alquiler` +50000, `Comision` −3500 → saldo
  **+46500**: la inmobiliaria se los debe.
- **(c) Custodia**: los mismos asientos y el mismo saldo; el estado indica cuánto de
  ese saldo está en efectivo en la oficina. Entregarlo es un pago.
- **(b) Cobra el locador** (lo ajeno es comisión, renglones de la inmobiliaria y de
  entes): `Alquiler` +50000, `Comision` −3500, `CobroDirecto` −50000 → saldo
  **−3500**: el locador le debe la comisión a la inmobiliaria. Si el contrato o la
  inmobiliaria fijan que el locador paga los entes él mismo, lo que retiene para
  ellos no cuenta como cobrado: queda descontado del `CobroDirecto` y el saldo sigue
  siendo solo lo que le debe a la inmobiliaria.
- **Compensación**: si el inquilino le pagó a otro locador X la parte de A, X queda
  con −46500 (tiene en mano dinero de A) y A con +46500 (la inmobiliaria se lo
  debe); entre ambos suman cero.

### Estado de cuenta mensual consolidado

`OwnerStatement` es el estado de un locador en un mes y una moneda
(`@@unique([tenantId, personId, period, currency])`), con **todas sus unidades**:

- **Apertura** = cierre del último estado emitido de ese locador y moneda, más los
  saldos iniciales del período. **Créditos**, **débitos** (comisión, honorarios,
  cargos, pagos a entes), **pagos** (transferencias, entregas de efectivo y cobros
  directos) y **cierre** = apertura + créditos − débitos − pagos.
- Los movimientos se agrupan por unidad para el PDF; lo que no es de una unidad
  (pagos, saldo inicial) va al final.
- El motor es puro y está en `packages/shared` (`computeStatement`,
  `statementsByCurrency`), con pruebas golden. Nunca suma monedas distintas.

Estados: `Borrador`, `Emitido`, `Enviado`, `Anulado`.

- **Generar** el mes arma un borrador para cada locador con asientos sin emitir hasta
  ese mes o con saldo arrastrado; uno ya generado se recalcula.
- **Emitir** recalcula y bloquea esos asientos (`statementId`): un asiento bloqueado no
  se toca (un saldo inicial o una boleta en un estado emitido no se corrigen hasta
  anularlo). No se emite un mes anterior o igual al último emitido.
- **Anular** (gerencia, con motivo) libera los asientos, que vuelven a entrar en el
  próximo estado. Solo el último emitido de cada locador y moneda, para no romper el
  arrastre.
- **PDF** para imprimir o compartir por WhatsApp o mail, con cómo se lee el saldo. El
  envío (y el estado `Enviado`) llega con la mensajería saliente (ítem 43).

### Cargos al locador y estado

Por defecto, al **generar** el estado se asientan los cargos al locador pendientes
hasta ese mes y pasan a `Imputado` con `imputedStatementId` = el estado de quien más
los soporta (es lo que fijó el modelo de datos del centro de carga). Si la
inmobiliaria elige descontarlos **al emitir**, el borrador los muestra como
«previstos» y se asientan al emitir. Anular un estado no los devuelve a pendiente:
quedan en la cuenta corriente y entran en el estado siguiente.

### Convenciones configurables

Lo que la inmobiliaria no definió queda en `Tenant.operationalDefaults`, con un valor
de fábrica igual al comportamiento descripto:

| Opción | Valores (el primero es el de fábrica) |
|---|---|
| `ownerAccounts.statementCloseDay` | `null` (fin de mes) o un día de 1 a 28: lo posterior a ese día va al estado del mes siguiente |
| `ownerAccounts.lessorChargeTiming` | `AlGenerarEstado`, `AlEmitirEstado` |
| `cash.lessorDirectOwes` (ADR-0012) | `TodoLoAjeno`, `SoloInmobiliaria`; ahora también **por contrato** en su versión de reglas (`ContractTermsVersion.lessorDirectOwes`, `null` = el de la inmobiliaria), pactable al crear el contrato o por convenio (`termsPatch`) |

El honorario por gestión de reparaciones es por contrato (`ContractCommission.repairMgmtFeePct`,
`null` = sin honorario).

### Preguntas abiertas a la inmobiliaria

1. ¿El estado cierra a fin de mes o un día fijo (por ejemplo, el 10)?
2. ¿Los cargos al locador se descuentan al generar el estado o recién al emitirlo?
3. Un cargo al locador con beneficiario «locador» se descuenta igual que uno con
   beneficiario «inmobiliaria»: ¿es correcto?
4. Un cargo de una unidad sin contrato lo soportan los locadores del último contrato
   y, si no hay, los titulares: ¿es correcto?
5. La custodia cuenta dentro del saldo del locador (y su entrega es un pago): ¿se lee
   así en los acumuladores?
6. De una boleta «Propietario» pagada por la inmobiliaria se descuenta solo la parte
   asignada a cada contrato; una unidad vacía va como cargo manual: ¿alcanza?
7. Anular un estado no devuelve los cargos a pendiente: ¿es correcto?
8. Los cobros registrados entre la puesta en marcha de la caja y la de la cuenta
   corriente no se asientan solos: ¿se cargan en el saldo inicial?
9. El centavo de redondeo va al primer crédito (el alquiler): ¿alguna preferencia?
10. El honorario por gestión se calcula solo sobre reparaciones a cargo del locador
    (no sobre créditos ni otros gastos): ¿es correcto?

## Alternativas consideradas

- **Extender la rendición por contrato** (`OwnerRendicion`, única por contrato, mes y
  locador). No expresa el saldo arrastrado ni junta las unidades de un locador, y
  recalculaba el reparto a fin de mes en lugar de leer lo que se decidió al cobrar.
- **Armar el estado recalculando desde los cobros, sin asientos.** Ahorra una tabla,
  pero cada estado dependería de reglas que cambian con el tiempo (comisión,
  convenios) y no habría dónde poner pagos, compensaciones, cargos ni el saldo
  inicial; tampoco habría qué bloquear al emitir.
- **Un estado por unidad.** Es lo que hacía la rendición; los acumuladores son por
  persona y el locador lee un solo saldo.
- **Un solo estado en pesos con tipo de cambio.** Mezclaría monedas con un tipo de
  cambio implícito; la caja ya descartó la conversión implícita (ADR-0012). Hay un
  estado por moneda.

## Consecuencias

- `OwnerRendicion` queda como **histórico de solo lectura**: se consulta y se imprime
  (`GET /renditions`, `/:id`, `/:id/pdf`), pero ya no se genera, no cambia de estado,
  no se edita ni se envía; esas rutas se retiraron. Las pruebas de esas funciones
  (CP-245, CP-266, CP-267) se retiraron con el código.
- Los reportes que leían rendiciones (estado de cuenta del propietario, flujo de caja,
  resumen de comisiones, métricas de cierre de contrato) y el flujo de caja del
  tablero leen la cuenta corriente; las rendiciones históricas siguen sumando,
  marcadas como tales.
- El pago a un locador deja de ser un movimiento manual de la caja: se registra desde
  su cuenta corriente, que escribe el egreso y el asiento juntos.
- Sin backfill: las tablas nacen vacías y cada locador arranca con su saldo inicial
  (lo carga la gerencia o la importación, M10).
- La unión de personas pasa los asientos y los estados a la persona que se conserva;
  si las dos tienen un asiento del mismo origen y concepto (por ejemplo, el saldo
  inicial de la misma moneda) o un estado del mismo mes y moneda, se rechaza y se
  corrige antes.
- La facturación por cuenta del locador (ítem 38) y el envío por WhatsApp y mail
  (ítem 43) parten de este estado.
