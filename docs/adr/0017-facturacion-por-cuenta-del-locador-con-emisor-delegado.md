# ADR-0017: Facturación por cuenta del locador con emisor delegado

## Estado

Aceptado.

## Fecha

2026-11-02.

## Contexto

La inmobiliaria cobra el alquiler y lo reparte, pero el alquiler es del locador: la
factura del alquiler la tiene que emitir el locador, no la inmobiliaria. La
inmobiliaria la emite por él con la **delegación** del servicio de facturación
electrónica que el locador le da en ARCA (el locador designa a la inmobiliaria como
representante del servicio; la inmobiliaria se autentica con su propio certificado y
factura con el CUIT del locador). El relevamiento lo fijó así: «por cuenta del
locador, nunca a nombre de la inmobiliaria; la inmobiliaria factura lo que decida»
(FB-11).

El modelo ya permitía varios emisores por inmobiliaria (informe final, «Multi-emisor
en facturación electrónica»): el emisor `ArcaIssuer` tiene su CUIT, sus puntos de
venta y su numeración independiente, y el certificado cifrado pertenece a la
inmobiliaria. Faltaba saber a **qué persona** corresponde un emisor delegado, qué se
factura de cada cobro, cuándo, y cómo se evita que un fallo de ARCA rompa el cobro o
que se facture dos veces lo mismo.

## Decisión

**El emisor delegado es un `ArcaIssuer` con `personId`.** Un locador tiene a lo sumo
un emisor delegado por inmobiliaria (único por inmobiliaria y persona). El CUIT, la
razón social y la condición frente al IVA salen de la persona; un emisor sin persona
sigue siendo el de la propia inmobiliaria y se usa para sus honorarios y comisiones,
nunca para el alquiler. No se guarda ninguna clave por locador: la delegación se
verifica en ARCA (`verify-delegation`) y se factura con el certificado de la
inmobiliaria.

**Qué y cuándo se factura es configuración, con valores conservadores.** Los valores
de la inmobiliaria están en `operationalDefaults.invoicing` y cada locador puede
pisarlos campo por campo (`ArcaIssuer.invoicingSettings`):

- `scope`: solo el alquiler (de fábrica), alquiler y punitorios, o todo lo que es del
  locador (alquiler, punitorios, reintegros y otros conceptos).
- `when`: a pedido (de fábrica), al registrar cada cobro, o al emitir el estado de
  cuenta del locador.
- `vatPct`: IVA incluido en el importe (0 de fábrica: sin IVA discriminado; en una
  factura C nunca se discrimina).

El tipo de comprobante (A, B o C) se resuelve con la lógica que ya existía
(`resolveComprobanteType`), a partir de la condición del locador y la del inquilino.
Ninguna regla fiscal queda fijada en el código como confirmada: las preguntas
abiertas están más abajo.

**El importe es exactamente la parte del locador.** Se suma, de la cuenta corriente
del locador (ADR-0009), lo que cae en el alcance: los asientos del cobro (cobro) o
los asientos del estado emitido (estado de cuenta). Las comisiones, los honorarios y
los gastos no se facturan. Se emite una factura por contrato, al inquilino del
contrato; la comisión de la inmobiliaria sigue su propio camino con el emisor propio.

**Una cola por origen, locador y tipo (`LessorInvoiceJob`).** La facturación no se
hace dentro del cobro ni del estado: un cobro o un estado no pueden fallar porque
ARCA no responde. El trabajo (`Pendiente`, `Emitido`, `Fallido` u `Omitido` si no
había nada para facturar) es único por origen, locador y tipo, y se emite con una
clave de idempotencia derivada del origen, el locador y el contrato (también es el
`clientRequestId` del comprobante), de modo que repetir una emisión, ya sea a mano o
por el proceso, no factura dos veces. Un trabajo fallido guarda el motivo y se
reintenta (cada 30 minutos, hasta 5 intentos; «Emitir pendientes» reintenta todos).

**La emisión es manual o automática, siempre por la misma cola.**

- Manual: `POST /payments/:id/invoices` y `POST /owner-statements/:id/invoices`.
- Automática: cada 30 minutos y con `POST /invoices/pending/run`, el sistema pone en
  cola los cobros nuevos (o los estados emitidos) de los locadores cuyo `when` es
  automático y cuya delegación está activa, y emite lo pendiente. Solo mira hacia
  adelante: no factura nada anterior al momento en que se activó (`autoSince`) ni
  anterior a 60 días. Con una de las dos vías automáticas, la otra no factura a mano
  (409 `INVOICING_TRIGGER_MISMATCH`), para no facturar el mismo alquiler por el cobro
  y por el estado.

**La anulación genera la nota de crédito.** Al anular un estado de cuenta, las
facturas emitidas por ese estado quedan en cola para su nota de crédito, que se emite
por el camino existente (`voidComprobante`) y asocia el comprobante original. Anular
no depende de ARCA. Un cobro no se anula en el sistema; para corregir una factura de
un cobro se usa la anulación de comprobantes (`POST /invoices/:id/void`).

## Consecuencias

- Cada comprobante por cuenta del locador lleva el emisor del locador
  (`issuer.personId`), el cobro (`paymentId`) o el estado (`ownerStatementId`); el
  listado de comprobantes filtra por locador y por origen.
- Se agregan tres columnas y una tabla (`arca_issuers.personId` e
  `invoicingSettings`, `comprobantes.ownerStatementId`, `lessor_invoice_jobs`), sin
  backfill. La unión de personas rechaza dos emisores delegados o dos trabajos del
  mismo origen.
- La facturación automática depende de que alguien haya activado la delegación en
  ARCA y verificado el emisor y sus puntos de venta; sin eso el trabajo falla con el
  motivo y queda a la vista en la cola.
- Los importes en dólares no se facturan todavía (requieren cotización): el trabajo
  falla con `CURRENCY_NOT_SUPPORTED`.
- La clave de idempotencia protege contra repetir un pedido, pero si ARCA autoriza un
  comprobante y la base no lo guarda, el comprobante se recupera del registro de
  llamadas (comportamiento existente de `persistAuthorized`).

## Preguntas abiertas para el contador

Ninguna de estas reglas está confirmada; el sistema las deja configurables o las
resuelve con la regla general hasta que se confirmen.

1. ¿Qué comprobante emite el locador por el alquiler según su condición y la del
   inquilino? Hoy se usa la matriz general (RI→RI factura A, RI→otros B,
   monotributista y exento factura C).
2. ¿Los punitorios (intereses por mora) se facturan, y con qué tratamiento de IVA?
   Hoy solo se factura el alquiler; incluir punitorios es una opción por locador.
3. ¿El alquiler de vivienda lleva IVA cuando el locador es responsable inscripto?
   Hoy `vatPct` es 0 (sin IVA discriminado) hasta que se confirme.
4. ¿Se factura por cobro o por estado de cuenta? Cambia el momento del hecho
   imponible y la fecha del comprobante.
5. ¿La delegación de la inmobiliaria alcanza para facturar o cada locador necesita su
   propio certificado y clave fiscal? El modelo asume la delegación del servicio.
6. ¿Cómo se factura un alquiler en dólares (cotización y fecha)? Hoy no se factura.
7. ¿Un cobro parcial genera factura por lo cobrado o por el total? Hoy se factura lo
   cobrado en ese cobro.
8. ¿Cuándo corresponde la nota de crédito y por qué importe cuando el estado se anula
   después de un ajuste? Hoy es por el total de la factura.
