# ADR-0018: Obtención automática de boletas de servicios e impuestos

## Estado

Aceptado para el circuito común, los canales `archivo`, `mail` y `consulta` (la
interfaz del conector y el proceso diario, sin conectores) y los lectores de la
Municipalidad de Córdoba, Rentas de Córdoba y Aguas Cordobesas. Los lectores de EPEC y
Ecogas están a ajustar con la primera boleta real. El canal `portal` es solo una
dirección futura.

## Fecha

2026-11-03.

## Contexto

Cada mes alguien de la inmobiliaria entra a los sitios de la Municipalidad, de Rentas,
de Aguas Cordobesas, de EPEC y de Ecogas, baja la boleta de cada propiedad y la carga a
mano en la planilla de boletas (ADR-0008). Es el trabajo repetitivo que más aparece en
el uso real del piloto (`docs/tesis/31-registro-de-feedback.md`). La boleta ya tiene su
lugar en el sistema (`ServiceBill`) y de ahí sale el reparto al inquilino
(`ServiceBillAllocation`); lo que falta es la entrada.

No hay una vía única para obtenerlas. La investigación previa encontró:

- **Ningún proveedor ofrece una API pública** de consulta de boletas por cliente. El
  Portal Tributario de la Municipalidad de Córdoba (`tributariomuni.cordoba.gob.ar`)
  permite consultar un inmueble y bajar el cedulón sin iniciar sesión, pero por una API
  interna sin documentar y con un captcha del que no está claro el alcance.
- Los sitios de Aguas Cordobesas, Ecogas y EPEC no se pudieron inspeccionar desde
  fuera de la Argentina (filtro por país o por WAF): un conector que corra en un
  proveedor de nube en el extranjero puede quedar bloqueado aunque el sitio funcione
  desde Córdoba.
- El `robots.txt` de Rentas de Córdoba excluye expresamente «Mi Rentas» y los
  servicios de consulta: automatizarlos no es una opción sin un acuerdo con Rentas.
- Los proveedores de servicios ofrecen **factura digital por mail** con el PDF, y toda
  boleta puede llegar además como PDF subido a mano. Esas dos vías no dependen de
  ningún sitio ni de ninguna credencial.

Un diseño que apuesta a un solo canal se rompe con el primer cambio de un portal. Hace
falta una entrada que no dependa del canal.

## Decisión

**Toda boleta, venga de donde venga, pasa por el mismo circuito y termina en
`ServiceBill`. Los canales y los proveedores son piezas intercambiables.**

### Catálogo de proveedores en código

`apps/api/src/modules/bills-intake/providers/` es un registro de
`BillProviderDefinition`. Cada proveedor es un archivo con su nombre, los tipos de
servicio que cubre, el esquema del identificador de cuenta (con su normalización), los
canales por los que entrega boletas, las **firmas** que reconocen un documento suyo por
el texto y su función `parse(texto)`. Sumar un proveedor es agregar su archivo, su
entrada en el registro y su prueba.

| Clave | Proveedor | Servicio | Identificador de cuenta (normalizado) |
|---|---|---|---|
| `aguas-cordobesas` | Aguas Cordobesas | Agua | Unidad de Facturación: 6 dígitos (se completan ceros a la izquierda) |
| `muni-cordoba` | Municipalidad de Córdoba | Municipal | Objeto del portal (`I` y dígitos) o identificación tributaria de 15 dígitos (nomenclatura de 10 más unidad funcional de 5; el dígito verificador pegado se descarta) |
| `rentas-cordoba` | Rentas de Córdoba | Impuesto inmobiliario | Cuenta de 12 dígitos (se aceptan con guion) |
| `epec` | EPEC | Electricidad | Suministro o contrato: de 4 a 14 dígitos (sin formato verificado) |
| `ecogas` | Ecogas | Gas | Cuenta o cliente: de 4 a 14 dígitos (sin formato verificado) |
| `generico` | Otro proveedor | cualquiera | Letras y dígitos, de 3 a 30 |

Un documento se reconoce por el proveedor que más firmas coincide; un empate o ninguna
firma lo deja sin reconocer y lo lee el **lector genérico** (total a pagar,
vencimiento y período por sus etiquetas habituales), cuya confianza está topada en 0,5.
Las firmas de la Municipalidad piden el título «Contribución sobre los Inmuebles»: una
página de datos, un informe de deuda o un plano de la Municipalidad no son una boleta.

Cada lector devuelve una `FetchedBillData`: los identificadores de cuenta leídos
(puede haber más de uno por documento, el circuito prueba con todos), la fecha de
emisión y una o más **boletas** (período, cuota, importe, vencimiento 1.º y 2.º con su
importe, código de pago, consumo), con una **confianza** de 0 a 1 y los avisos de la
lectura. La confianza suma cuenta (0,25), importe (0,30), vencimiento (0,25) y período
(0,20), y descuenta 0,1 por aviso. Un cedulón con varias cuotas (una liquidación de
deuda) no es una boleta: queda con confianza topada en 0,5. No se guardan nombres ni
domicilios del titular, solo lo que alimenta la boleta.

**Lectura de lo que se imprime.** El texto sale de los PDF con `unpdf` (PDF.js sin
binarios nativos, versión fija 1.8.1). No hay OCR: un PDF escaneado da texto vacío y
va a revisión. Los lectores no se apoyan en el orden de las líneas, que cambia según
cómo arma el PDF cada proveedor, sino en etiquetas y en ventanas de texto a su
alrededor. Se validaron con muestras reales de los tres proveedores (una por una, solo
en la máquina del desarrollo, sin copiarlas al repositorio); las pruebas usan PDF
sintéticos con la misma estructura y datos inventados. Dos supuestos quedan anotados:
la cuota de la Municipalidad y de Rentas se toma como el mes del período (cuota 5 es
mayo) y el período de la factura de agua es el «período comercial». La validación del
vencimiento contra el período y de este contra la fecha de hoy atrapa un supuesto que
no se cumpla.

**EPEC y Ecogas están a ajustar con la primera boleta real.** No hay una boleta de
esos proveedores a la vista: su lectura se apoya en las etiquetas del formato público
(«Contrato», «N.° de cuenta», «Total a pagar», «Vencimiento», «Período») y su
confianza está topada en 0,6. Mientras no se ajusten, **nunca dan de alta solos**: sus
documentos reconocidos quedan en revisión con el motivo `LOW_CONFIDENCE` y el servicio
sugerido. Cuando llegue la primera boleta real se ajusta el lector, se sube el tope y
se agrega el caso a la prueba.

### Modelo

Una migración nueva (`20261103180412_boletas_automaticas`), sin backfill:

- `Service.providerKey` (clave del catálogo). El `accountNumber` existente es el
  identificador de cuenta y, con proveedor, se guarda **normalizado**; no se agregó un
  campo de datos adicionales porque ningún proveedor necesita otro identificador (el
  circuito prueba con todos los que lea el documento). Dar de alta un servicio con
  proveedor valida la cuenta con el formato del proveedor (`INVALID_PROVIDER_ACCOUNT`) y
  que el tipo de servicio sea uno de los que emite (`PROVIDER_SERVICE_TYPE_MISMATCH`).
- `BillDocument`: el documento entrante (canal, origen, clave del PDF en el
  almacenamiento de objetos, tamaño, `sha256`, proveedor reconocido, cuenta leída, lo
  leído en `data`, confianza, estado, motivo, servicio, quién lo revisó y cuándo). Único
  por `[tenantId, sha256]`. El estado es `Recibida`, `Procesada`, `RequiereRevision`,
  `Rechazada` o `Duplicada`. El vínculo con la boleta es la columna `ServiceBill.documentId`
  (un documento puede dar de alta varias boletas, como un resumen de cuenta), así que no
  hay un `billId` en el documento.
- `BillFetchRun`: un intento de consulta a un proveedor para un servicio (inicio, fin,
  resultado `Ok`, `SinNovedad`, `Error` o `Bloqueado`, código de error y cuántos
  documentos nuevos dejó).
- `ServiceBill.source` (`Manual` o `Automatica`) y `ServiceBill.documentId`. No existía
  nada equivalente: `receiptUrl` es el comprobante de pago, no el origen de la boleta.

`BillDocument` y `BillFetchRun` están en `TENANT_SCOPED_MODELS` y en la limpieza de las
pruebas e2e (ADR-0006). El PDF se guarda en el mismo almacenamiento de objetos que usan
los adjuntos de personas, con una clave determinista por inmobiliaria y contenido
(`bill-documents/<tenantId>/<sha256>.pdf`).

### Circuito único (`BillIntakeService`)

1. **Idempotencia.** Se calcula el `sha256` del contenido. Si la inmobiliaria ya lo
   tiene, se devuelve el documento existente sin guardar ni procesar nada (`duplicate:
   true`); dos pedidos a la vez con el mismo PDF resuelven la carrera con la restricción
   única.
2. Se sube el PDF, se crea el documento y se extrae el texto. Un PDF ilegible o sin
   texto queda en revisión (`UNREADABLE`).
3. Se detecta el proveedor por las firmas y se lee con su `parse`. Un documento que
   ningún proveedor reconoce nunca se da de alta solo (`UNKNOWN_PROVIDER`); si su cuenta
   coincide con la de un servicio, se le sugiere a quien revisa.
4. Se busca el `Service` activo de la inmobiliaria por `(providerKey, cuenta
   normalizada)`. Ninguno es `NO_MATCHING_SERVICE`; dos con la misma cuenta, `AMBIGUOUS_SERVICE`.
5. **Validaciones.** Confianza al menos 0,8 (`LOW_CONFIDENCE`); importe mayor que cero
   (`INVALID_AMOUNT`); período a no más de 3 meses de hoy (`PERIOD_OUT_OF_RANGE`);
   vencimiento no anterior al mes del período ni a más de 6 meses de él, y el segundo
   no antes que el primero (`DUE_DATE_INCONSISTENT`).
6. **Boleta existente.** Para cada boleta leída se busca `[servicio, período, cuota]`.
   Con el mismo importe no se hace nada (si todas estaban, el documento queda
   `Duplicada`). Con otro importe, **nunca se pisa**: el documento queda en
   `BILL_EXISTS_DIFFERENT_AMOUNT` para que una persona decida.
7. **Alta.** Si todo cierra, se da de alta cada boleta nueva con
   `ServiceBillsService.createAutomatic`, que comparte el alta con la carga manual (la
   misma creación y `materialize`), de modo que el reparto al inquilino sale igual. La
   boleta queda `Pendiente`, `Automatica` y ligada al documento. Las altas y el estado
   del documento van en **una transacción**: o quedan las boletas con su documento
   `Procesada`, o ninguna. Un fallo inesperado deja el documento en revisión en lugar de
   perderlo.

Un resumen de cuenta con varias boletas es todo o nada: si una sola queda fuera de la
ventana de fechas, el documento entero va a revisión.

### Cuenta normalizada y proveedor del servicio

El circuito asocia la boleta a un `Service` por `providerKey` y `accountNumber`. Para que
esa comparación no dependa de cómo se escribió la cuenta, hay una sola normalización,
la del esquema de cuenta de cada proveedor del catálogo (`accountSchema`), y se aplica
en las dos puntas: al **guardar** (alta y edición manual, y lote de importación, con la
misma función `resolveProviderFields`) y al **buscar** (`matchService` normaliza las
cuentas del documento con el proveedor reconocido). Sin proveedor la cuenta se guarda
tal cual: no hay formato que aplicar. Para sugerir el servicio de un documento sin
proveedor reconocido se prueba la cuenta tal cual y la del lector genérico.

No se agregó ninguna columna ni migración de datos. `providerKey` nació con este ADR, de
modo que ningún servicio anterior lo tenía, y los que lo tienen desde el alta o la
edición manual ya se guardaron normalizados; un servicio sin proveedor no entra al
circuito hasta que se le asigna uno, y esa asignación normaliza la cuenta (o falla con
`INVALID_PROVIDER_ACCOUNT` y se corrige a mano). Una migración que reescribiera cuentas
habría tenido que replicar en SQL los normalizadores de cada proveedor, con riesgo sobre
datos reales y sin beneficio.

### Canales

- **`archivo`**: `POST /bills-intake/documents` (multipart, hasta 10 PDF de 10 MB). Cola
  de revisión: `GET /bills-intake/documents?status=&channel=&providerKey=` paginado,
  `GET /:id`, `GET /:id/file` (enlace temporal al PDF), `POST /:id/accept` (con
  correcciones opcionales de servicio, período, cuota, importe y vencimiento) y
  `POST /:id/reject` (con motivo). Suben, aceptan y rechazan Admin, Gerente y
  Liquidaciones, como la carga de boletas; leen además Lectura. Aceptar no valida
  plausibilidad (decide una persona) pero tampoco pisa una boleta existente con otro
  importe (409 `BILL_ALREADY_EXISTS`).
- **`mail`**: `POST /bills-intake/email-ingest`. Reutiliza la firma del ingreso de mails
  de la bandeja de consultas (`X-Realfy-Signature`, HMAC-SHA256 del cuerpo crudo con
  `INBOX_EMAIL_INGEST_SECRET`; la verificación es la misma función, sin copiarla). El
  servicio de recepción reenvía el mail con los adjuntos en base64. La inmobiliaria
  sale de `tenantSlug`, como en la bandeja, o de la dirección de destino
  `boletas+<slug>@...`. Cada PDF adjunto entra al circuito con canal `Mail`. Un mail sin
  PDF queda en revisión como `NO_ATTACHMENT`, una sola vez por mensaje; **los mails con
  un enlace en lugar de un adjunto se tratan en un pedido posterior**. A diferencia de la
  bandeja de consultas, **los remitentes automáticos (`no-reply`, marca `automatic`) se
  aceptan**: los proveedores mandan la factura digital desde ellos. La protección es que
  solo se procesan PDF y que la boleta se da de alta sola únicamente si el lector
  reconoce proveedor y cuenta.
- **`consulta`**: en esta base solo existe la interfaz `BillFetcher` (`providerKey`,
  `fetch(servicio, contexto)` que devuelve PDF), el registro de conectores y el proceso
  diario, sin ningún conector. El proceso (6:00 de Buenos Aires, dentro del contexto de
  cada inmobiliaria con `TenantCron`) solo corre si la inmobiliaria lo habilitó:
  `operationalDefaults.billFetching = { enabled: false, providers: [] }` de fábrica.
  Habilitado, recorre los servicios activos con cuenta de los proveedores elegidos que
  tengan conector, entrega lo que traen al circuito común y deja un `BillFetchRun` por
  intento. Un conector que el proveedor bloquea (captcha, filtro por país, límite de
  uso) lanza `BillFetchBlockedError` y el intento queda `Bloqueado`; cualquier otro
  error, `Error`. El formulario de valores por defecto no manda este bloque, y su
  guardado lo conserva. Eludir un captcha no es una opción: si un proveedor lo exige,
  la vía se descarta o se pide un convenio.
- **`portal`**: queda solo como dirección futura. Entrar con las credenciales de la
  inmobiliaria a un portal de cliente (Espacio Clientes, oficina virtual de EPEC o de
  Ecogas) exigiría guardarlas cifradas (`common/crypto`), correr desde una salida con
  IP argentina y que los términos del proveedor lo permitan, con el visto bueno legal.
  No hay código para este canal.

### Datos personales

Las boletas llevan nombre, domicilio y consumos del titular. Se guardan con el acceso
de las boletas (Admin, Gerente, Liquidaciones y Lectura), solo para la relación de
administración, y lo que se extrae a `data` no incluye nombres ni domicilios. Las
liquidaciones de expensas de consorcio, que traen datos de otros consorcistas, no
entran en esta base: llegan como cualquier PDF y, al no tener lector, quedan para
revisión.

## Consecuencias

- La carga manual de boletas y la automática comparten el alta; un cambio en el
  reparto vale para las dos. La planilla del mes sigue siendo el lugar para corregir
  una boleta; los documentos que esperan revisión se resuelven en la pantalla
  «Boletas recibidas» (subida, lista con filtros, PDF junto a lo leído, aceptar con
  correcciones o rechazar con motivo).
- Todo lo dudoso queda en una cola con el motivo, el servicio sugerido y el PDF, en
  lugar de cargarse mal en silencio. Mientras EPEC y Ecogas no se ajusten, **todas**
  sus boletas pasan por revisión.
- La seguridad del ingreso por mail es la de la bandeja: quien tenga el secreto puede
  cargar documentos a cualquier inmobiliaria por su `slug`. Ese secreto es de la
  infraestructura de recepción, no de las personas; rotarlo cambia los dos ingresos a la
  vez.
- Una boleta de la Municipalidad de un año viejo no se carga sola: la ventana de ±3
  meses la manda a revisión. Es intencional (un cedulón de deuda atrasada no es la
  boleta del mes).
- Se agrega una dependencia, `unpdf` 1.8.1 (la más reciente que anda en Node 20 y
  en Node 22; las posteriores requieren Node 22). Carga PDF.js con un `import()` dinámico que Jest no admite sin banderas
  especiales: las pruebas leen los PDF con la misma librería en un proceso de Node
  aparte (`NodePdfTextService`), y la API en producción la usa en proceso.
- Se agregan dos tablas y columnas sin backfill; la reversa está anotada en la
  migración.
- Queda para los pedidos siguientes: el conector de consulta
  de la Municipalidad (el único con consulta pública sin sesión, a tasa baja y
  desactivable, idealmente con un convenio), los mails con enlace, el ajuste de EPEC y
  Ecogas con boletas reales, el OCR de escaneos y el canal de portal.
- El "servicio de recepción" del canal `mail` es un Cloudflare Email Worker (`infra/email-worker`): `boletas@` y `boletas+<slug>@` llegan a él por Email Routing, y manda los PDF en base64 a `POST /bills-intake/email-ingest` firmados con `INBOX_EMAIL_INGEST_SECRET`.
