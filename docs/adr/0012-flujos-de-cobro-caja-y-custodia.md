# ADR-0012: Flujos de cobro, caja y custodia

## Estado

Aceptado.

## Fecha

2026-11-02.

## Contexto

Hasta ahora un cobro era una fila de `payments` con importe, medio y fecha. No
decía quién recibió el dinero ni dónde quedó, y el reparto entre la inmobiliaria y
los locadores se calculaba recién en la rendición mensual por contrato
(`rendicion-engine`), sobre lo cobrado en el mes.

El relevamiento de la inmobiliaria piloto (FB-06 y FB-28) muestra que el dinero se
mueve de varias formas que ese modelo no distingue:

- **Repartido** (la mayoría): el inquilino paga la comisión a la inmobiliaria y el
  resto al locador.
- **Todo a la inmobiliaria**: la inmobiliaria cobra todo y le paga al locador.
- **Todo al locador**: el locador cobra todo y le paga la comisión a la
  inmobiliaria.
- **Efectivo en la oficina**, con recibo, que se guarda hasta que el locador lo
  busca o se deposita. Algunos locadores guardan así moneda extranjera.
- **Compensaciones** (unas quince por mes): el inquilino le transfiere a otro
  locador de la inmobiliaria para no mover efectivo, y los saldos se cruzan.

Cada movimiento de dinero tiene que dejar asiento (principio 2 del plan): la caja
de la inmobiliaria y, más adelante, la cuenta corriente de cada locador (ítem 37,
ADR-0009). Este ADR fija la primera parte: la caja y el reparto de cada cobro.

## Decisión

### Quién recibió cada cobro

`Payment.receivedBy` es `Inmobiliaria` o `Locador`. Si el pedido no lo indica, se
toma del flujo de pago del contrato (`paymentFlow` de la versión de reglas vigente
en el período, ADR-0010): `TodoLocador` → `Locador`; `Partido` y
`TodoInmobiliaria` → `Inmobiliaria`. Indicar una cuenta o la custodia implica que
cobró la inmobiliaria. En el flujo `Partido` el inquilino paga dos veces (comisión
a la inmobiliaria, resto al locador) y se registran dos cobros, uno por cada
receptor; sus saldos se compensan entre sí.

### Reparto: `settlement-engine`

`settlePayment` (en `packages/shared`, puro, con pruebas golden) reparte un cobro
aplicado a una liquidación:

- **Destinos de la liquidación**: la comisión (pactada en el contrato o, sin ella,
  el porcentaje de la inmobiliaria) se calcula sobre los renglones comisionables y,
  junto con los gastos administrativos y los renglones con destino `Inmobiliaria`,
  es la parte de la inmobiliaria; los renglones `Ente` son de los entes; los
  renglones `Locador` menos comisión y gastos son de los locadores.
- **Cada locador** recibe su parte según `payoutPct` (ADR-0007) por mayor resto: la
  suma de las partes es exactamente el total y, a igual resto, el centavo va al
  primero.
- **Pagos parciales**: se reparte lo acumulado (lo cobrado hasta este pago menos lo
  cobrado antes), así que los cobros que saldan una liquidación suman exactamente
  la liquidación.
- **Tres flujos**: (a) cobra la inmobiliaria: guarda la parte de cada locador hasta
  pagarla (saldo positivo a favor del locador); (b) cobra el locador: le debe a la
  inmobiliaria lo ajeno (saldo negativo); si cobró otro locador, ese locador le
  debe a cada locador del contrato su parte (compensación); (c) cobra la
  inmobiliaria y guarda la parte de los locadores en custodia.
- **Monedas**: todo se reparte en la moneda de la liquidación; un renglón en otra
  moneda es un error (`SETTLEMENT_CURRENCY_MISMATCH`). No hay conversión implícita:
  convertir es un movimiento explícito con tipo de cambio (`convertAmount`).

El resultado se guarda en `Payment.settlement` al registrar el cobro, para que el
recibo y la cuenta corriente del locador lean lo que se decidió en ese momento.
`rendicion-engine` queda solo para la rendición histórica (`OwnerRendicion`), que
la cuenta corriente reemplaza.

### Caja de la inmobiliaria

- `FinancialAccount`: `Caja`, `Banco` o `Custodia` (de un locador, con
  `ownerPersonId`), siempre en una sola moneda (ARS, USD o EUR). La caja y el banco
  de una moneda se crean la primera vez que se usan (efectivo → caja, otros
  medios → banco), con un bloqueo consultivo para no crear dos.
- `CashMovement` es el libro: cuenta, fecha, sentido (`In`/`Out`), importe
  positivo, moneda, categoría, contraparte, contrato, tipo de cambio y origen
  (`sourceType`/`sourceId`). El saldo de una cuenta es entradas menos salidas.
- Lo escriben: el registro de un cobro (`AlquilerCobrado` en la caja o el banco;
  `Custodia` en la custodia de cada locador), la entrega de custodia, las
  compensaciones con custodia, las conversiones y los movimientos manuales (pagos a
  locadores, entes y proveedores, honorarios, gastos, comisiones del personal y
  señas). Las categorías del sistema no se cargan a mano, y una cuenta de custodia
  solo se mueve por cobros, entregas y compensaciones.
- Todo en una transacción con su fila de auditoría.

### Custodia

En el flujo (c) la parte de cada locador entra en su cuenta de custodia y la caja
recibe solo lo de la inmobiliaria y los entes. `POST /custody/:accountId/deliver`
entrega todo el saldo o una parte, bloqueando la fila de la cuenta para que dos
entregas no saquen más de lo que hay. Por defecto la custodia no suma en el total
de la inmobiliaria: es dinero de terceros.

### Compensaciones

`Compensation(paymentId, fromLessorId, toLessorId, amount)` registra que un
locador (`from`) recibió un cobro que le correspondía, en todo o en parte, a otro
locador del contrato (`to`). Solo se compensa un cobro que recibió un locador, la
suma no supera el cobro y, sin importe, se toma la parte de `to` según el reparto
guardado. Si `from` tiene efectivo en custodia, la compensación puede pagarse con
él: sale de su custodia y entra en la caja, donde queda para `to` como cualquier
cobro. Sin custodia, la compensación queda registrada para la cuenta corriente
(ítem 37).

### Recibos

Cada cobro que recibe la inmobiliaria emite un `Receipt` con número de
`DocumentSequence`, dentro de la misma transacción que crea el cobro: un rollback
no gasta número y un cobro tiene a lo sumo un recibo. La serie de cobros
(`RECIBO_COBRO`) es distinta de la de liquidaciones (`RECIBO_LIQUIDACION`, ADR-0010),
que no cambia: los números ya emitidos siguen siendo los mismos y ambas usan la
misma función `nextDocumentNumber`. El PDF del recibo imprime ese número, el monto
en letras y "por cuenta y orden" de los locadores.

### Cargos a la inmobiliaria

Un cargo del centro de carga con `chargedTo = Inmobiliaria` se cierra con una
acción explícita, `POST /charges/:id/agency-expense`, que escribe un `Gasto` en la
cuenta elegida y deja el cargo `Imputado`, en una transacción. Es explícita porque
al cargar el gasto no se sabe de qué cuenta sale el dinero ni cuándo se paga. Un
cargo cerrado así no se puede liberar.

### Convenciones configurables

Lo que la inmobiliaria no definió queda en `Tenant.operationalDefaults.cash`, con un
valor de fábrica:

| Opción | Valores (el primero es el de fábrica) |
|---|---|
| `lessorDirectOwes` | `TodoLoAjeno` (comisión, renglones de la inmobiliaria y de entes), `SoloInmobiliaria` (el locador paga los entes) |
| `partialAllocation` | `Proporcional`, `InmobiliariaPrimero` |
| `custodyInAgencyBalance` | `false`, `true` |
| `receiptSeries` | `Unica`, `PorMoneda`, `PorCuenta` |
| `receiptWhenLessorReceives` | `false`, `true` |
| `compensationScope` | `CualquierLocador`, `MismoContrato` |

## Consecuencias

- El cobro dice quién lo recibió, dónde está y cuánto le toca a cada uno, en el
  momento en que se registra; la cuenta corriente del locador (ítem 37) puede
  armarse leyendo `Payment.settlement`, las compensaciones y los movimientos de
  custodia, sin recalcular.
- Si el reparto no se puede hacer (por ejemplo, un contrato sin locadores que sumen
  100), un cobro que entra a la caja se registra igual y guarda el error en
  `settlement`; uno que recibió el locador o que va a custodia se rechaza, porque
  sin reparto no se sabe cuánto se debe ni a quién.
- Los cobros anteriores a esta versión quedan recibidos por la inmobiliaria, sin
  cuenta ni recibo: no se inventa dónde entraron.
- No hay reversión de cobros ni pagos a locadores automáticos todavía; un pago a un
  locador es un movimiento manual (`PagoLocador`) hasta que exista la cuenta
  corriente.
- Las opciones de la tabla son preguntas abiertas a la inmobiliaria; el valor de
  fábrica reproduce lo que hacía el sistema (una sola serie, la custodia fuera del
  total, reparto proporcional).
