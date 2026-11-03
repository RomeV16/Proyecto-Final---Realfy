# ADR-0013: Mensajería saliente con outbox y cobranza escalonada

## Estado

Aceptado para la mensajería saliente (PR 5.1 y 5.2 del ítem 43). La sección de
cobranza escalonada queda planificada para el PR 5.4.

## Fecha

2026-11-03.

## Contexto

Hasta ahora cada módulo que necesitaba avisar algo mandaba el mail en el
momento, llamando al transporte de correo (`CommonEmailService`, sobre Resend):
la liquidación al inquilino al pasar a Enviada, los avisos al personal de los
procesos diarios y la invitación de un usuario nuevo. Ese esquema tiene cuatro
problemas:

- **El envío forma parte de la operación.** Si Resend tarda o falla, la
  transición espera o registra un error; si la operación se revierte después
  de mandar, el mail ya salió. No hay reintentos ni registro de qué salió.
- **No hay forma de impedir que salga.** En el ambiente piloto viven datos
  reales (ADR-0014): con solo cargar `RESEND_API_KEY` para las invitaciones,
  las liquidaciones empezarían a llegarles a inquilinos reales sin que el
  dueño de la inmobiliaria lo haya aprobado.
- **No hay consentimiento.** La Ley 25.326 pide que la persona pueda pedir la
  baja y que esa baja se respete; WhatsApp, además, exige el alta explícita
  para recibir mensajes de una empresa.
- **WhatsApp no existía.** El plan (FB-10, FB-18, FB-21) necesita mandar
  recibos y estados de cuenta por WhatsApp, y después la cobranza escalonada
  y la bandeja de consultas.

El principio 4 del plan maestro fija la respuesta: «WhatsApp y mail se encolan
con clave de idempotencia; un envío fallido no rompe la operación de negocio».

## Decisión

### Bandeja de salida (outbox transaccional)

Todo mensaje a una persona se guarda en `message_outbox` **dentro de la
transacción del negocio** (`OutboxService.enqueue(tx, …)`), con el canal, la
plantilla, las variables ya formateadas, el documento relacionado
(`relatedType`/`relatedId`) y una **clave de idempotencia única**. El mensaje
no se manda al encolar: si la operación se revierte, el mensaje no existe; si
se confirma, el despacho lo manda después. El alta usa `INSERT … ON CONFLICT DO
NOTHING` (`createMany` con `skipDuplicates`), así una clave repetida devuelve el
mensaje ya encolado sin abortar la transacción de quien llama.

Las claves dicen qué operación representan: `Receipt:<id>:<canal>`,
`OwnerStatement:<id>:<canal>`, `Liquidacion:<id>:Email`,
`UserInvitation:<id>:<hash del enlace>`, `Notification:<id>:Email`,
`TicketComment:<id>`. Un doble clic o un reintento del proceso no duplica el
mensaje.

Las variables se formatean al encolar (montos, períodos) para que el mensaje
diga lo mismo aunque salga horas después. Los PDF (recibo, estado de cuenta,
liquidación) **no se guardan**: se generan al despachar desde el documento,
que ya no cambia (un recibo emitido, un estado emitido). Las variables con
secretos (el enlace de un solo uso de una invitación) no se muestran en la
API y se borran cuando el mensaje termina.

### Despacho

Un proceso programado cada minuto (`TenantCron`, `runGuarded`, falla cerrado)
recorre las inmobiliarias activas y toma hasta 50 mensajes pendientes vencidos.
Para cada uno aplica, en orden:

1. **Modo del ambiente** (`MESSAGING_MODE`).
2. **Proveedor configurado** para el canal: sin credenciales queda `Pending`
   con el motivo `PROVIDER_NOT_CONFIGURED` y se avisa una vez por día a
   Admin y Gerente (`SystemAlert`).
3. **Lista permitida** en modo `allowlist`: fuera de la lista queda `Blocked`
   (`NOT_IN_ALLOWLIST`).
4. **Consentimiento**: `Blocked` con `OPTED_OUT` o `NO_OPT_IN`.
5. **Horario permitido** para los mensajes a la cartera: de 9 a 20 h de Buenos
   Aires por defecto (`Tenant.operationalDefaults.messaging`); fuera de
   horario queda `Pending` con `QUIET_HOURS` hasta que abra.

Recién entonces lo **toma** (`updateMany` de `Pending` a `Sending`, para que
otra instancia no lo mande dos veces), genera el PDF y llama al proveedor. Un
error transitorio (red, 5xx, límite de envío) se reintenta con espera de 1, 5,
30 y 120 minutos, hasta 5 intentos; un rechazo del proveedor (dirección
inválida, plantilla inexistente) o el último intento lo dejan `Failed` y avisan
a la gerencia (`MessageFailed`). Un mensaje que quedó en `Sending` más de 15
minutos (un reinicio en medio del envío) pasa a `Failed` y se reintenta a
mano: WhatsApp no deduplica, así que reintentarlo solo podría duplicarlo.

Estados: `Pending`, `Sending`, `Sent` (el proveedor lo aceptó), `Delivered`
y `Read` (por webhook), `Failed`, `Blocked` y `Cancelled`. Desde la bandeja se
reintenta un `Failed`, `Blocked` o `Cancelled` y se cancela un `Pending` o
`Blocked`. Un estado de cuenta pasa a `Enviado` recién cuando su mensaje sale
(la lección de DEF-24).

### Modos de envío por ambiente

`MESSAGING_MODE` es una variable de cada ambiente, no una opción de pantalla:

- `off` (**por defecto** y para cualquier valor desconocido): los mensajes se
  encolan y se ven en la bandeja con el motivo `MESSAGING_OFF`, pero nunca
  salen.
- `allowlist`: solo salen a las direcciones de `MESSAGING_ALLOWLIST` (mails y
  teléfonos, normalizados); el resto queda bloqueado. Es el modo para probar
  en `piloto` con direcciones del equipo.
- `live`: salen a quien corresponda, siempre respetando el consentimiento.

**`piloto` queda en `off` o `allowlist` hasta que el dueño de la inmobiliaria
apruebe explícitamente el envío a su cartera.** El cambio a `live` es una
decisión registrada, no una configuración más.

El mismo modo se aplica a los mails que todavía salen directo por
`CommonEmailService` (los informes programados): con `off` no salen y con
`allowlist` solo a la lista. La única excepción es el recupero de contraseña,
que pide la misma persona que lo recibe (`purpose: 'transactional'`).

### Consentimiento (Ley 25.326)

`contact_consents` es un **historial**: cada alta o baja agrega un registro con
la persona, el canal, la dirección a la que aplica, el origen (`Manual` cargado
por el personal, `Inbound` cuando la persona respondió BAJA o STOP,
`Complaint` cuando marcó un mail como spam) y quién lo cargó. Vale el último
registro entre los de la persona y los de la dirección, de modo que una baja
por WhatsApp de un número que no es de ninguna persona también se respeta.

- Una **baja se respeta siempre**, en cualquier canal.
- **WhatsApp** a la cartera necesita un **alta explícita** registrada.
- El **mail** a la cartera sale mientras no haya baja: va a la dirección que la
  persona dio para su contrato y lleva documentos de esa relación (recibos,
  estados de cuenta, liquidaciones).
- Los mensajes al personal (avisos, invitaciones) no dependen del
  consentimiento.

### Proveedores

Detrás de una interfaz (`MessageProvider`: `isConfigured()` y `send()`, que no
lanza y dice si el error es reintentable), uno por canal:

- **Resend** (`ResendEmailProvider`), sobre el único transporte de mail de la
  API. Manda la clave de idempotencia como `Idempotency-Key` (un reintento
  después de un corte no duplica el mail) y el PDF como adjunto. Requiere el
  dominio verificado con SPF y DKIM.
- **WhatsApp Business Cloud API** (`WhatsAppCloudProvider`, Graph API de Meta)
  con un **número nuevo**, exclusivo de la API. Fuera de la ventana de 24 h de
  una conversación solo admite plantillas aprobadas: cada mensaje es una
  plantilla de **utilidad** por nombre e idioma (`es_AR`), con los parámetros en
  orden; el PDF se sube a `/media` y viaja como documento del encabezado.
- **De prueba** (`FakeProvider`), el que usa la API con `NODE_ENV=test`: las
  pruebas unitarias y e2e nunca llaman a Resend ni a Meta.

### Webhooks

`POST /webhooks/whatsapp` (con `GET` para la verificación de la suscripción) y
`POST /webhooks/resend` son rutas públicas, pero cada pedido se verifica con la
firma sobre el **cuerpo crudo** (`rawBody`): `X-Hub-Signature-256` (HMAC-SHA256
con el secreto de la app de Meta) y la firma de svix de Resend (con tolerancia
de 5 minutos contra reenvíos). La comparación es en tiempo constante. Sin el
secreto configurado se rechaza todo.

No hay fuga entre inmobiliarias: un estado de entrega se ubica por el id del
proveedor (único); un mensaje entrante, por el último mensaje que se le mandó a
ese número (un número que nunca recibió nada se descarta). La respuesta es
siempre `{ received: true }`. Los mensajes entrantes se guardan mínimos
(`inbound_messages`) para la bandeja de consultas del PR 5.3; BAJA o STOP
registran la baja y avisan a la gerencia.

### Notificaciones (L11)

Los tipos de notificación sin emisor pasan a la bandeja de salida: el aviso al
inquilino de un cambio de estado o un comentario de su ticket sale como
mensaje (`ticket_status`, `ticket_comment`), por WhatsApp si dio el alta o por
mail; `TicketNotificationService` deja de ser un registro en el log y avisa al
personal en la bandeja de notificaciones (`TicketCreated`,
`TicketCommentAdded`). `PaymentReceived` y `TicketStatusChanged` quedan sin
emisor y marcados como obsoletos (el aviso al cliente es el mensaje). Se suman
`MessageFailed`, `ContactOptedOut` e `InboundMessageReceived`; `SystemAlert`
avisa de un proveedor sin configurar.

### Cobranza escalonada (planificada, PR 5.4)

`CollectionCase` (contrato, etapa Recordatorio/Prejudicial/Abogado/Judicial/
Cerrado, próxima acción) y `CollectionAction`, con el escalamiento de FB-21
(recordatorio a los 5 días del vencimiento, cada 5 días más firme, prejudicial
con carta documento al vencer el siguiente, derivación a abogado), se
decidirán en el PR 5.4 sobre esta bandeja de salida. No forman parte de este
cambio.

## Plantillas de WhatsApp propuestas (categoría utilidad, `es_AR`)

Se dan de alta en el administrador de WhatsApp de Meta con estos nombres. Las
que llevan PDF tienen un encabezado de tipo **documento**. El cierre «Respondé
BAJA para no recibir más mensajes» es texto fijo del pie.

| Nombre | Encabezado | Cuerpo |
|---|---|---|
| `recibo_de_cobro` | Documento | Hola {{1}}, te enviamos el recibo de cobro Nº {{2}} por {{3}} en concepto de {{4}}. Lo adjuntamos en PDF. {{5}} |
| `estado_de_cuenta` | Documento | Hola {{1}}, te enviamos tu estado de cuenta de {{2}}. Saldo al cierre: {{3}}. El detalle va en el PDF adjunto. {{4}} |
| `incidencia_estado` | — | Hola {{1}}, tu reclamo "{{2}}" cambió de estado: {{3}}. {{4}} |
| `incidencia_respuesta` | — | Hola {{1}}, hay una respuesta en tu reclamo "{{2}}": {{3}}. {{4}} |

El último parámetro es el nombre de la inmobiliaria. La liquidación, la
invitación y los avisos al personal van solo por mail.

## Consecuencias

- Ninguna operación de negocio espera a un proveedor ni falla por él; lo que se
  mandó, cuándo y con qué resultado queda en la bandeja de salida.
- Mientras el modo esté en `off`, nada sale: es seguro desplegar en `piloto`
  con `RESEND_API_KEY` cargada para probar con `allowlist`.
- Un mensaje puede salir hasta un minuto después de encolado, y fuera del
  horario permitido a la mañana siguiente.
- Los PDF se regeneran al despachar: si un documento se anula antes de que el
  mensaje salga, el mensaje falla con `ATTACHMENT_UNAVAILABLE` en lugar de
  mandar algo que ya no vale.
- Dar de alta el número de WhatsApp, verificar la empresa en Meta, aprobar las
  plantillas y verificar el dominio de mail en Resend son acciones externas,
  pendientes (ver `../despliegue.md`).
- La bandeja de consultas (5.3) y la cobranza escalonada (5.4) se construyen
  sobre `inbound_messages` y esta bandeja de salida.
