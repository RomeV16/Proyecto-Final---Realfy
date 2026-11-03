# ADR-0013: Mensajería saliente con outbox y cobranza escalonada

## Estado

Aceptado para la mensajería saliente (PR 5.1 y 5.2 del ítem 43) y para la
cobranza escalonada (PR 5.4), con sus decisiones legales pendientes de revisión
por el abogado de la inmobiliaria.

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

### Bandeja de consultas (inbound, PR 5.3)

Los mensajes entrantes terminan en una bandeja unificada (`conversations` y
`conversation_messages`). Una consulta es un hilo de **una inmobiliaria, un canal
(WhatsApp, Email, Web, Telefono) y una dirección normalizada**; cada mensaje
entrante de WhatsApp o mail apunta a su fila de `inbound_messages` (única) y cada
saliente a su fila de `message_outbox`, de donde sale el estado de entrega. Un
mensaje nuevo se une a la consulta abierta del mismo canal y dirección cuyo último
mensaje esté dentro de la ventana (`inbox.threadWindowHours`, 72 por defecto) o
abre una; una consulta resuelta que recibe un mensaje se reabre con plazo nuevo.

**Ingreso por canal**

- *WhatsApp:* el mismo webhook de arriba. Un número que ya recibió mensajes se
  ubica por el último mensaje que se le mandó; una consulta **nueva** de un número
  desconocido va a la inmobiliaria dueña del número del ambiente
  (`WHATSAPP_TENANT_SLUG`) o, sin esa variable, a la única inmobiliaria activa; con
  varias y sin variable se descarta. El guardado es idempotente: Meta reintenta el
  aviso y, si el mensaje quedó guardado pero no llegó a la consulta, el reintento lo
  completa.
- *Mail:* Resend recibe mails entrantes (evento `email.received`), pero el aviso no
  trae el cuerpo y hay que pedirlo por API; en lugar de atarnos a ese formato, la
  API expone `POST /inbox/email-ingest`, firmado como el webhook de Meta
  (`X-Realfy-Signature: sha256=<hex>`, HMAC-SHA256 del cuerpo crudo con
  `INBOX_EMAIL_INGEST_SECRET`; sin secreto se rechaza todo). Un servicio de
  recepción (el reenvío de la casilla de consultas) manda el mail ya normalizado
  (`tenantSlug`, `messageId`, `from`, `subject`, `text`, `automatic`). El
  `Message-ID` identifica el mensaje (único por inmobiliaria); los automáticos
  (`automatic`, `no-reply`, `mailer-daemon`) no abren consultas. Armar ese reenvío
  queda como configuración pendiente (ver despliegue).
- *Micrositio:* la consulta pública crea el interesado y, a continuación, una consulta
  de canal Web con la propiedad (`relatedType: Property`) y el responsable del
  interesado. Si la bandeja falla, el formulario igual responde.
- *Teléfono:* *Registrar llamada* (`POST /conversations/calls`): una llamada atendida
  nace en curso con primera respuesta y sin plazo; una para devolver nace asignada a
  quien la anota con el plazo corriendo.

**Plazo y autorrespuesta.** El plazo de primera respuesta es la configuración
`operationalDefaults.inbox` (`slaMinutes` 15, `businessHours` de lunes a viernes de 9
a 18 en hora de Buenos Aires, activable). Un proceso programado (`inbox-sla`, cada
minuto, `TenantCron`) marca una sola vez cada consulta vencida (`slaBreachedAt`, con
una actualización condicional) y avisa al responsable y a Admin y Gerente
(`InboxSlaBreached`). La **autorrespuesta** se encola en la misma transacción que
abre la consulta con la clave `inbox-autoreply:<consulta>` (una por consulta) y la
plantilla `inbox_message`, de destinatario `reply`: respeta la baja y el modo del
ambiente como cualquier mensaje, **no** pide el alta de WhatsApp (la persona escribió
primero) y no tiene horario permitido (justamente sirve fuera de horario). No detiene
el plazo: ese es el de una persona.

**Ventana de WhatsApp.** La plantilla `inbox_message` es de *texto libre*
(`freeForm`): por WhatsApp sale como mensaje `text`, sin plantilla aprobada, algo que
Meta solo admite dentro de las 24 horas del último mensaje de la persona (ventana de
atención al cliente). Antes de encolar se verifica que haya un mensaje entrante de ese
número en las últimas 24 horas; fuera de la ventana se usa el mail de la persona y, si
no hay, se responde 409 `WHATSAPP_WINDOW_CLOSED`. Fuera de ventana, Meta rechaza el
texto (131047) y el mensaje queda fallido sin reintentos.

**Respuesta.** `POST /conversations/:id/reply` elige la ruta (el canal de la consulta
y, si no se puede, el mail; una baja se respeta en todos los canales), encola el
mensaje y registra la respuesta en el hilo en una transacción. La clave de idempotencia
sale del texto y del último mensaje: un doble clic encola una sola vez. La consulta pasa
a *esperando al cliente*, toma la primera respuesta y, si no tenía responsable, se
asigna a quien contestó.

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

### Cobranza escalonada (PR 5.4)

Un **caso de cobranza** (`collection_cases`) agrupa la mora de un contrato: uno
abierto por contrato, aunque tenga varias liquidaciones vencidas. Su línea de
tiempo es `collection_actions` (avisos mandados, carta documento, acuerdos,
pagos y notas). Una mora nueva después de cerrar un caso abre otro.

**Etapas** (`CollectionStage`), con su máquina de estados
(`collectionCaseMachine`, validada con `assertTransition`):

```
Recordatorio → Prejudicial | Abogado | Cerrado
Prejudicial  → Abogado | Cerrado
Abogado      → Judicial | Cerrado
Judicial     → Cerrado
```

Solo el paso de Recordatorio a Prejudicial lo hace el proceso diario (al preparar
la carta documento). Derivar a un abogado, pasar a la vía judicial y cerrar a
mano son decisiones de una persona.

**Política** (`planCollection`, pura y con casos de oro): dado el caso y el día
devuelve qué toca y cuándo. Con los valores de fábrica, con el vencimiento el
día D:

| Día | Qué toca |
|---|---|
| D+5 | Recordatorio amable (nivel 1) |
| D+10 | Recordatorio más firme (nivel 2) |
| D+15 | Recordatorio firme (nivel 3) |
| D+20, D+25, … | El nivel 3 se repite cada 5 días hasta que la cobranza pasa a prejudicial |
| D'+1 | D' es el vencimiento del alquiler siguiente, impago: **prejudicial**, se prepara la carta documento |
| E+10 | E es el envío confirmado de la carta: vence el plazo de 10 días corridos y se **sugiere** derivar a un abogado |

Se configura en `Tenant.operationalDefaults`: el ritmo (`collectionCadence`,
primer recordatorio a los 5 días y luego cada 5) y `collections`
(`enabled`, `maxLevel` de 1 a 3, `letterTermDays`, 10, y `repeatLastLevel`, activo de fábrica). **La cobranza viene
apagada** (`enabled: false`): hasta que la inmobiliaria la prende, el proceso
diario no abre casos ni manda nada; desplegar la migración no cambia nada.

Reglas de la política:

- Un **pago total** cierra el caso (motivo `Pagado`); un **pago parcial** lo
  deja abierto con el mismo ritmo y queda anotado en la línea de tiempo.
- Un **acuerdo de pago** (con la fecha prometida) pausa los avisos hasta esa
  fecha; si llega y sigue la deuda, retoma al día siguiente.
- Los recordatorios no salen más seguido que el ritmo configurado ni se juntan
  al retomar o si el proceso se atrasó. Agotados los niveles, el último
  (nivel 3) se repite cada 5 días hasta que vence el alquiler siguiente y se
  prepara la carta (`collections.repeatLastLevel`, activo de fábrica, según
  el relevamiento: «reenvío cada 5 días más duro; al vencer el siguiente
  alquiler, prejudicial»). Apagado, después del último nivel no se manda más
  hasta la carta.
- Una mora vieja (por ejemplo cargada desde el sistema anterior) cuyo alquiler
  siguiente ya venció pasa directo a la carta, sin un recordatorio amable de por
  medio.
- Si se paga el alquiler más viejo y queda otro, el ritmo vuelve a empezar desde
  el vencimiento que queda.

**Proceso diario** (`TenantCron`, `runGuarded`, 10:00 de Buenos Aires, después
de los punitorios de las 02:15). Por inmobiliaria con la cobranza prendida:
abre un caso por contrato con alquileres vencidos con saldo (`Enviada` o
`Vencida` con saldo, el mismo criterio que la morosidad) y recorre los abiertos,
cada uno en su propia transacción con la fila bloqueada (`SELECT … FOR UPDATE`)
para no pisarse con una acción manual. Un caso que falla se registra y no corta
a los demás. Es idempotente: correrlo dos veces el mismo día no repite nada
(clave de la acción por caso, tipo, nivel, día y persona; y clave de la bandeja
de salida `CollectionReminder:<caso>:<nivel>:<día>:<persona>:<canal>`).

**Recordatorios.** Encolan en la bandeja de salida la plantilla del nivel
(`payment_reminder_1`, `_2` y `_3`) para cada inquilino del contrato, por
WhatsApp si dio el alta o por mail si no pidió la baja, con **el importe exacto
a pagar ese día**: el saldo vencido más los punitorios devengados (el mismo
cálculo de `GET /liquidaciones/:id/payoff`), y los períodos adeudados. Todo lo
demás lo decide la bandeja de salida: el modo del ambiente
(`MESSAGING_MODE`), el consentimiento y el horario. Si nadie tiene un canal
disponible, queda registrado en la línea de tiempo (el ritmo avanza para no
reintentar todos los días) y se avisa a la gerencia.

**Carta documento: nada legal sale solo.** Al vencer el alquiler siguiente
impago el proceso **prepara un borrador**: la acción queda `Preparada` con campos
editables (destinatario, domicilio, inmueble, períodos, importe al día, plazo y
un texto libre). El PDF (`GET …/letter.pdf`, de `common/pdf`) se genera de esos
campos, lleva la marca de agua de borrador y la advertencia de que debe revisarlo
un profesional. La oficina lo revisa, lo manda en papel por correo certificado y
recién entonces una persona **confirma el envío con su fecha**: la acción pasa a
`Realizada`, esa fecha fija el plazo de 10 días corridos y el caso pasa a
esperar. El sistema no manda ninguna carta, ni por mail ni por WhatsApp.

**Derivación a un abogado: solo manual.** Vencido el plazo, el sistema avisa a
la gerencia el día del vencimiento y el caso muestra «Derivación a un abogado»
como lo que toca, pero no deriva. Derivar y pasar a la vía judicial
(`POST …/derive`, `POST …/judicial`) son de Admin y Gerente; el resto de las
acciones (nota, acuerdo, editar y confirmar la carta, asignar, cerrar) son de
Admin, Gerente y Liquidaciones. Cada acción manual se audita.

**Textos propuestos.** Tres niveles, del amable al firme. Son respetuosos y
legalmente seguros: no amenazan, no mencionan juicios, abogados ni la carta
documento y no citan plazos legales; el importe es el exacto de hoy y siempre
ofrecen una salida (responder, acordar una forma de pago). Un caso en una
etapa posterior no recibe más recordatorios.

| Plantilla | Nivel | Cuerpo (`{{1}}` nombre, `{{2}}` importe de hoy, `{{3}}` períodos, `{{4}}` inmobiliaria) |
|---|---|---|
| `recordatorio_de_pago_n1` | 1, amable (D+5) | Hola {{1}}, te escribimos para recordarte que figura pendiente el pago del alquiler de {{3}}. El importe al día de hoy es {{2}}. Si ya lo abonaste, ignorá este mensaje; si tenés alguna dificultad, respondé y lo vemos juntos. {{4}} |
| `recordatorio_de_pago_n2` | 2, más firme (D+10) | Hola {{1}}, volvemos a comunicarnos: el alquiler de {{3}} sigue sin acreditarse. El importe actualizado al día de hoy es {{2}}. Te pedimos regularizarlo a la brevedad o comunicarte con nosotros para acordar una forma de pago. {{4}} |
| `recordatorio_de_pago_n3` | 3, firme (D+15) | Hola {{1}}, este es un nuevo aviso: el alquiler de {{3}} continúa pendiente por {{2}} al día de hoy. Necesitamos que lo regularices o te comuniques con nosotros esta semana para acordar el pago. Si no recibimos novedades, seguiremos con las gestiones de cobranza que prevé el contrato. {{4}} |

El mismo texto sale por mail con el asunto «Recordatorio de pago», «Pago
pendiente de tu alquiler» y «Necesitamos comunicarnos por tu alquiler», cada uno
con el nombre de la inmobiliaria. Una prueba verifica que ninguna plantilla
contenga las palabras carta documento, abogado, juicio, desalojo, demanda,
embargo, denuncia ni policía.

**Pendientes de revisión legal.** Las decisiones legales quedaron en su opción
más conservadora (borradores, envío manual, nada automático) y se listan como
preguntas para el abogado de la inmobiliaria en el informe del PR 5.4: contenido
mínimo de la carta documento y quién la firma, desde cuándo corren los 10 días
(hoy, desde la fecha de envío confirmada), si el tercer recordatorio puede
mencionar «las gestiones de cobranza que prevé el contrato», si se informan los
punitorios en el importe y si el prejudicial arranca el día siguiente al
vencimiento del alquiler siguiente.

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
invitación y los avisos al personal van solo por mail. Las tres plantillas de
la cobranza (`recordatorio_de_pago_n1`, `_n2` y `_n3`) están en la sección de
cobranza escalonada.

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
- La bandeja de consultas (5.3) se construye sobre `inbound_messages` y esta
  bandeja de salida.
- La cobranza escalonada nace **apagada** en cada inmobiliaria y manda
  recordatorios solo por la bandeja de salida: con `MESSAGING_MODE=off` los
  avisos quedan encolados con su motivo y no sale nada. La carta documento solo
  existe como borrador hasta que una persona confirma el envío en papel.
- Hay que dar de alta y aprobar en Meta las tres plantillas de utilidad de la
  cobranza antes de prender los recordatorios por WhatsApp; sin ellas, el
  proveedor rechaza el mensaje y queda `Failed`.
- Un recordatorio puede salir hasta un día después de lo que dice la política
  (el proceso corre una vez al día) y el importe que informa es el de ese día.
- La política cierra un caso sin deuda vencida en la pasada siguiente al pago,
  no en el momento: durante ese lapso el caso sigue abierto con saldo cero.
