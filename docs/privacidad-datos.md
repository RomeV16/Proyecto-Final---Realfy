# Privacidad y protección de datos personales

Este documento describe cómo trata Realfy los datos personales de las personas que figuran en el sistema, a la luz de la Ley 25.326 de Protección de Datos Personales de la República Argentina y su decreto reglamentario 1558/2001. Está escrito para el piloto con una inmobiliaria real (ver `tesis/30-piloto.md`), donde por primera vez el sistema guarda datos de personas que existen.

Distingue dos cosas que no deben confundirse: lo que el sistema **hace hoy**, verificado contra el código, y lo que está **previsto** para el piloto y todavía no está construido. Cada sección marca cuál es cuál. Los puntos legales marcados como pendientes de validación se confirman con un abogado antes de operar con datos reales; este documento no es un dictamen jurídico.

## Roles frente a la ley

- **Titulares de los datos:** inquilinos, locadores, garantes, apoderados, proveedores, interesados que consultan y los usuarios internos de la inmobiliaria.
- **Responsable de la base:** la inmobiliaria. Es quien decide para qué se usan los datos de su cartera.
- **Encargado del tratamiento:** el equipo de Realfy, que aloja y opera el sistema por cuenta de la inmobiliaria. El equipo trata los datos solo para prestar el servicio y para corregirlo.
- **Autoridad de aplicación:** la Agencia de Acceso a la Información Pública. La inscripción de la base y su forma se confirman con el abogado (pendiente).

## Datos personales que guarda el sistema

### Hoy

| Entidad | Datos | Fuente en el esquema |
|---|---|---|
| Persona (inquilino, locador, garante, proveedor, interesado) | Nombre y apellido, correo, dos teléfonos, CUIT o CUIL, condición fiscal, tipo de persona, documento, domicilio, estado civil, nacionalidad, forma de cobro, cuentas bancarias (banco, CBU, alias y titular), referencia del sistema anterior, notas, roles asignados y archivos adjuntos (por ejemplo documentación de una persona) | Modelo `Person`, `PersonBankAccount`, `PersonRoleAssignment`, `PersonDocument` |
| Usuario interno | Correo, nombre y apellido, rol, fecha del último ingreso y contraseña, que se guarda solo como valor derivado (hash) | Modelo `User` |
| Credencial del portal del inquilino | Contraseña como hash, sesiones y tokens de renovación | `InquilinoCredential`, `PortalRefreshToken` |
| Interesado (lead) | La persona asociada, la propiedad de interés, presupuesto, origen, notas e interacciones. Una consulta enviada desde el portal público de la inmobiliaria crea el interesado sin intervención | `Lead`, `LeadInteraction`, `LeadVisit` |
| Contrato y garantía | Partes del contrato, montos, fechas y la garantía (tipo, emisor, número de póliza, monto) | `Contract`, `ContractPerson`, `ContractGuarantee` |
| Cobros | Liquidaciones, pagos y comprobantes fiscales, con el documento fiscal del receptor | `Liquidacion`, `Payment`, `Comprobante` |
| Auditoría | Usuario, acción, entidad, cambios, dirección de red y agente de navegador de cada operación sensible | `AuditLog` |

### Previsto para el piloto

El ítem 33 del cronograma amplía la ficha de persona con tipo (física o jurídica), documento de identidad, domicilio, estado civil, nacionalidad, forma de cobro y varias cuentas bancarias con moneda, y agrega apoderados y locadores por contrato. Para los garantes se prevé registrar empleador e ingresos como parte de la evaluación de la garantía; hasta entonces esa información solo puede estar en los archivos adjuntos. Cada ampliación actualiza `tesis/03-modelo-datos.md` y este documento en el mismo PR.

El sistema no guarda datos sensibles en el sentido del artículo 2 de la ley (origen racial, opiniones políticas, salud, vida sexual, entre otros) y no tiene campos para ellos. Las notas son texto libre: la regla de uso es no cargar allí datos de ese tipo.

## Base legal y finalidad

La finalidad es administrar contratos de locación por cuenta de los locadores: calcular y cobrar alquileres, rendir a cada locador, emitir los comprobantes que correspondan, atender reclamos y mantener el historial de cada contrato.

La base legal es doble, según el dato:

- **Ejecución de la relación contractual.** Los datos de las partes de un contrato de locación y de su garantía son necesarios para ejecutarlo, y la ley exceptúa el consentimiento cuando los datos surgen de una relación contractual o se necesitan para cumplirla (artículo 5, inciso 2). Es la base de la mayor parte de la cartera.
- **Consentimiento informado.** Para lo que excede el contrato, como las comunicaciones comerciales, el uso de datos de interesados que consultaron por una propiedad y la futura mensajería instantánea, se pide consentimiento expreso y se registra la baja (artículo 5, incisos 1 y 3, y artículo 6). Antes de enviar mensajes por WhatsApp el sistema debe registrar el consentimiento y permitir darse de baja; está previsto en el ítem 43 y hoy no existe.

El texto de información al titular y el mecanismo de consentimiento se deciden con el abogado y con la inmobiliaria (pendiente). La decisión de usar cifras agregadas del piloto en la tesis es independiente y también está pendiente (ver «Anonimización para la tesis»).

## Acceso por rol

Hoy el control de acceso se aplica sobre las operaciones que modifican datos; la mayoría de las lecturas está disponible para cualquier usuario autenticado de la inmobiliaria (ver `tesis/02-roles-y-casos-uso.md`). En el piloto las tres personas de la inmobiliaria ven todo el contenido, por decisión de la dirección.

Esto es un límite que el piloto declara y reduce: la política de lectura por rol vuelve la restricción de datos sensibles una configuración y no un desarrollo. Cada inmobiliaria puede elegir qué roles leen cada recurso sensible; sin configurar rige el valor por defecto (todos leen todo).

### Datos sensibles y cómo restringirlos

| Recurso | Datos | Efecto de restringirlo a un rol |
|---|---|---|
| `persons.bankAccounts` | CBU, alias y banco de personas y propietarios | El rol recibe 403 `READ_FORBIDDEN` al pedir las cuentas y ve `null` en fichas y contratos |
| `persons.document` | DNI y CUIT de las personas | El rol ve la persona con esos campos ocultos (`null`); no se rechaza la lectura |
| `contracts.commission` | Comisión de la inmobiliaria en cada contrato | 403 al pedirla; `null` dentro del contrato |
| `renditions` | Lo que se paga a cada propietario | 403 `READ_FORBIDDEN` |
| `reports.financial` | Estados de cuenta, flujo de caja, rentabilidad | 403 `READ_FORBIDDEN` |
| `invoices` | Comprobantes emitidos | 403 `READ_FORBIDDEN` |
| `audit` | Registro de quién cambió qué | 403 `READ_FORBIDDEN` |

Para restringirlos, el Admin entra a Configuración → Permisos, destilda los roles que no deben leer el recurso y guarda; el cambio rige desde el siguiente pedido de cada usuario. Los datos ocultos se enmascaran en la respuesta de la API: no se modifican en la base. El Admin siempre conserva la lectura. Ver `tesis/02-roles-y-casos-uso.md` para la matriz completa.

| Quién | Qué ve |
|---|---|
| Usuarios internos | Los datos de su inmobiliaria, según su rol |
| Inquilino en el portal | Solo lo que pertenece a la persona dueña de su sesión: su contrato, sus liquidaciones y sus reclamos |
| Equipo de desarrollo | Acceso al ambiente `piloto` limitado a quienes operan el servicio; no hay acceso a datos reales desde el ambiente de demostración ni desde el repositorio |
| Otras inmobiliarias | Nada: el aislamiento entre inmobiliarias es una garantía del sistema (ver abajo) |

## Retención

- **Hoy:** el sistema no borra datos de forma automática. Las personas se dan de baja de forma lógica (quedan inactivas y se conservan sus contratos y comprobantes), porque borrarlas rompería el historial contable y fiscal de los contratos que las referencian. Los registros de auditoría se conservan.
- **Criterio:** los datos de un contrato se conservan mientras dure y por el plazo en que la inmobiliaria debe poder acreditar lo cobrado y rendido, incluidos los plazos fiscales y de prescripción. El plazo exacto lo confirma el contador y el abogado (pendiente).
- **Interesados:** los datos de interesados que no llegaron a ser parte de un contrato se pueden depurar a un plazo definido por la inmobiliaria. No hay depuración automática; se hace a pedido.
- **Fin del piloto:** si la inmobiliaria no continúa con el sistema, se le entrega una exportación de sus datos y se eliminan la base y el almacenamiento del ambiente `piloto`, incluidas las copias de respaldo.

## Derechos de los titulares

| Derecho | Qué significa | Cómo se ejerce en el sistema |
|---|---|---|
| Acceso (artículo 14) | Saber qué datos hay sobre uno | La inmobiliaria consulta la ficha de la persona, sus contratos y el historial, y entrega la información; el plazo legal es de diez días corridos |
| Rectificación (artículo 16) | Corregir datos inexactos | La inmobiliaria edita la ficha; el cambio queda en el registro de auditoría; el plazo legal es de cinco días hábiles |
| Supresión (artículo 16) | Eliminar datos que no corresponde conservar | Baja lógica de la persona; la supresión física procede cuando no hay contratos ni comprobantes que la referencien o cuando la ley deja de exigir su conservación |
| Oposición y baja de comunicaciones | No recibir mensajes comerciales | Baja de los envíos; para mensajería instantánea, previsto en el ítem 43 |

Los pedidos llegan a la inmobiliaria, que es la responsable de la base, y el equipo la asiste técnicamente. Los plazos y la forma de atenderlos se confirman con el abogado (pendiente).

## Medidas de seguridad

- **Aislamiento entre inmobiliarias.** Cada registro lleva el identificador de su inmobiliaria y toda consulta se filtra por él; ante la duda, el acceso falla cerrado (ADR-0003 y ADR-0006). Una prueba compara la lista de modelos filtrados contra el esquema, de modo que un modelo nuevo sin filtro rompe las pruebas.
- **Ambiente separado para el piloto.** Datos reales solo en el ambiente `piloto`, con base y almacenamiento propios; nunca en demostración ni en el repositorio (ADR-0014, planificada).
- **Autenticación.** Contraseñas guardadas con hash, sesiones con token de acceso de vida corta y renovación con rotación, y límite de intentos en el ingreso de usuarios y del portal del inquilino.
- **Enlaces de un solo uso.** Las invitaciones de usuarios y los enlaces de recupero de contraseña llevan un token de 256 bits aleatorios. En la base solo se guarda su hash SHA-256 (`UserInvitation.token`, `PasswordResetToken.tokenHash`): el valor en claro existe una vez, en la respuesta al Admin o en el correo, y no se escribe en registros ni en la bitácora. Se consumen al usarse; la invitación vence a los 7 días y el enlace de recupero a la hora. Cambiar o recuperar la contraseña cierra las sesiones afectadas, y dar de baja a un usuario las corta de inmediato. El pedido de recupero por correo responde igual exista o no la cuenta, para no revelar quién tiene acceso. Mientras no haya correo configurado, el Admin comparte el enlace a mano: es una credencial temporal y debe enviarse solo a su destinatario.
- **Permisos por rol** sobre las operaciones de escritura y, en el piloto, sobre la lectura (ítem 32).
- **Auditoría.** Las operaciones sensibles dejan registro con usuario, acción y cambios.
- **Errores sin filtración.** Las respuestas de error tienen forma uniforme y no exponen detalles internos (ADR-0005).
- **Copias de respaldo.** Copia mensual de la base fuera del proveedor de alojamiento y prueba de restauración (previsto en el PR de infraestructura del piloto; hoy la base depende de las copias del proveedor).
- **Transporte.** El ambiente de alojamiento publica la aplicación y la API por HTTPS; el piloto no se habilita sin certificado válido.
- **Secretos.** Credenciales y claves de servicios externos se configuran por variables de entorno del ambiente, no se guardan en el repositorio.

## Anonimización para la tesis

La tesis y este repositorio son públicos. Reglas:

1. **Nada real en el repositorio ni en la tesis:** ni nombres de personas, ni documentos, ni domicilios, ni teléfonos ni correos, ni cuentas bancarias, ni montos de contratos reales. Tampoco se nombra a la inmobiliaria ni su ciudad; se la llama «la inmobiliaria piloto».
2. **Datos sintéticos.** Los ejemplos, los casos de prueba, las capturas y la demostración usan datos inventados con la misma forma que los reales.
3. **Cifras agregadas del piloto** (por ejemplo, la reducción del tiempo del ciclo) solo se publican con el consentimiento de la inmobiliaria, que sigue pendiente, y sin permitir identificar a una persona ni a un contrato.
4. **Los hallazgos** del registro de feedback (`tesis/31-registro-de-feedback.md`) se redactan como reglas de negocio generales, sin nombres ni cifras de la cartera.
5. **Las fuentes del relevamiento y los datos reales** se guardan fuera del repositorio, con acceso restringido al equipo.

## Datos que salen a servicios externos

| Servicio | Qué se envía | Estado |
|---|---|---|
| Modelo de lenguaje (módulo `ai`) | Para el panel de prioridades: un identificador opaco por ítem (`C1`, `R2`…), el tipo de ítem, su estado, importes y moneda, días de atraso o para vencer y horas fuera de plazo, si tiene responsable y la prioridad declarada. Para el resumen de cierre de contrato: métricas agregadas del contrato (tipo, fechas, cantidades de liquidaciones y pagos, puntualidad, montos y punitorios). No se envían nombres, documentos, correos, teléfonos, domicilios, identificadores internos ni títulos de propiedades: los tipos de datos del contexto que se arma para el modelo no tienen campos para ellos, y la identificación real no sale del servidor | Funciona hoy. El proveedor y el modelo se configuran por variable de entorno; con la credencial vacía el cliente queda deshabilitado y las funciones resuelven por reglas y plantillas. En el ambiente `piloto` se decide con la inmobiliaria si se habilita |
| ARCA | Para emitir un comprobante: datos del emisor, tipo de comprobante, importes y el documento fiscal del receptor (CUIT, o cero para consumidor final), con el certificado del emisor | Funciona hoy en homologación. La emisión real, por cuenta del locador, es el ítem 38 y requiere validación del contador |
| Resend (correo) | Dirección del destinatario y el contenido del mensaje con sus adjuntos (liquidaciones, rendiciones, notificaciones). Sin credencial no se envía ningún correo | Funciona hoy. Obligatorio en el ambiente `piloto` para invitaciones y estados de cuenta (ítem 43) |
| WhatsApp (API oficial de la plataforma de mensajería) | Número de teléfono y texto de plantillas de utilidad, con consentimiento y baja | Previsto en el ítem 43; no existe hoy. Requiere consentimiento (ver «Base legal y finalidad») |
| BCRA e INDEC | Solo se descargan series públicas de índices; no se envía ningún dato personal | Funciona hoy |
| Almacenamiento de objetos (compatible con S3) | Fotos de propiedades y adjuntos de personas y contratos | Funciona hoy, con el ambiente de almacenamiento propio de cada ambiente |

La ley restringe la transferencia de datos personales a países sin un nivel de protección adecuado (artículo 12). Varios de estos proveedores procesan los datos fuera del país; el abogado confirma con qué cláusulas contractuales o excepciones se cubre esa transferencia antes de operar con datos reales (pendiente).
