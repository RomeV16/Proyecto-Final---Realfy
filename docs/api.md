# Referencia de API

Catálogo de los endpoints REST que expone `apps/api`, agrupados por módulo. Para
cada uno se indica el método, la ruta, para qué sirve y qué roles lo pueden usar.
El detalle campo por campo de cada cuerpo vive en los DTO del módulo
correspondiente y en `apps/api/prisma/schema.prisma`; acá el objetivo es que la
lista de rutas y la de roles sean exactas.

## Convenciones generales

Todas las rutas cuelgan del prefijo global `/api`. Las tablas de este documento
lo omiten por brevedad: donde dice `GET /properties`, la ruta real es
`GET /api/properties`.

La autenticación es por JWT, que viaja en `Authorization: Bearer <token>` o en
la cookie de sesión. El guard de autenticación es global: toda ruta lo exige
salvo las marcadas como públicas. El `tenantId` sale siempre del token, nunca del
cuerpo ni de la consulta, y se propaga por el contexto de la petición hasta la
capa de persistencia.

Sobre los roles hay dos reglas que hay que tener en cuenta al leer las tablas:

- Los siete roles son `Admin`, `Gerente`, `Ventas`, `Liquidaciones`,
  `Marketing`, `Soporte` y `Lectura`.
- Donde la tabla dice **autenticado**, el endpoint no declara roles y lo puede
  usar cualquier usuario con sesión válida. La restricción por rol es opcional y
  se aplica endpoint por endpoint; en la práctica la mayoría de las lecturas
  quedan abiertas a toda la inmobiliaria y las escrituras están restringidas.

La validación de entrada corre con lista blanca estricta: un campo que el DTO no
declara hace fallar la petición con 400 en lugar de ser ignorado.

El límite de peticiones general es de 600 por minuto por IP. Los endpoints que
reciben credenciales —el ingreso y el registro del personal, y el ingreso del
portal— tienen su propio límite de 5 por minuto, y el formulario de consulta del
micrositio público, de 10 por minuto.

## Forma de la respuesta de error

Todo error, sin importar de dónde venga, sale con la misma forma. La produce un
filtro global de excepciones (`apps/api/src/common/filters/all-exceptions.filter.ts`),
de modo que el cliente no tiene que distinguir entre un error de validación, uno
de dominio, uno de la base de datos y uno inesperado.

```json
{
  "statusCode": 404,
  "message": "Contract not found",
  "error": "NOT_FOUND",
  "errorCode": "NOT_FOUND",
  "correlationId": "…",
  "timestamp": "2026-08-18T00:12:34.567Z"
}
```

`statusCode` y `timestamp` están siempre. `message` es un texto o, cuando el
error viene de la validación de entrada, un arreglo de textos con un elemento por
campo rechazado. `correlationId` aparece cuando la petición trae o genera un
identificador de traza, y es el valor con el que se puede buscar la línea de
registro correspondiente en el servidor.

`error` y `errorCode` llevan el mismo valor: el primero es el nombre que ya
consumían los clientes, el segundo el de la forma documentada. Los códigos
genéricos son:

| Código | Estado | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 400 | El cuerpo o los parámetros no pasan la validación. |
| `UNAUTHORIZED` | 401 | Falta el token, está vencido o es del ámbito equivocado. |
| `FORBIDDEN` | 403 | El rol no alcanza para la operación. |
| `NOT_FOUND` | 404 | El recurso no existe, o no existe dentro de la inmobiliaria del token. |
| `CONFLICT` | 409 | Violación de unicidad en la base. |
| `INTERNAL_ERROR` | 500 | Cualquier error no previsto. |

Cuando un servicio lanza su propio código de dominio —`EMAIL_EXISTS`,
`INVITATION_EXPIRED`, `S3_UPLOAD_FAILED` y otros, siempre en mayúsculas con guión
bajo— el filtro lo respeta en lugar de reemplazarlo por el genérico del estado
HTTP, porque hay pantallas que ramifican sobre ese valor. El contexto extra que
el servicio haya adjuntado al error también se conserva: las máquinas de estado,
por ejemplo, devuelven `validTransitions` junto al mensaje, así el cliente puede
mostrar qué transiciones sí eran posibles.

Los errores inesperados son la excepción a esa regla: se responden siempre con el
mismo mensaje genérico y sin ningún detalle adicional. La traza completa queda en
el registro del servidor, junto con el método, la ruta, el estado, el
`correlationId`, la inmobiliaria y el usuario, pero nunca se envía al cliente.

## Salud

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/health` | Estado del servicio y de la conexión a la base. No se cae si la base no responde: devuelve `degraded`. | Público |

## Autenticación

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| POST | `/auth/register` | Da de alta una inmobiliaria y su primer usuario, con rol Admin. | Público, 5/min |
| POST | `/auth/login` | Inicia sesión y emite el par de tokens. | Público, 5/min |
| POST | `/auth/refresh` | Rota el token de refresco y emite uno nuevo de acceso. | Público |
| POST | `/auth/logout` | Invalida el token de refresco de la sesión. | Autenticado |
| POST | `/auth/change-password` | Cambia la contraseña propia. Pide `currentPassword` y `newPassword` (8 a 128 caracteres) y cierra las demás sesiones: la actual, identificada por su cookie de refresco, sigue abierta. Responde 204; con la actual equivocada, 400 `INVALID_CURRENT_PASSWORD`. | Autenticado, 5/min |
| POST | `/auth/password-reset/request` | Pide instrucciones por correo (`email`). Responde siempre 202 con el mismo cuerpo, exista o no la cuenta; si el servicio de correo no está configurado no envía nada. | Público, 5/min |
| POST | `/auth/password-reset/confirm` | Fija la contraseña nueva con el token del enlace (`token`, `newPassword`). Responde 204 y cierra todas las sesiones del usuario. Errores: 400 `PASSWORD_RESET_INVALID`, `PASSWORD_RESET_USED`, `PASSWORD_RESET_EXPIRED`. | Público, 5/min |

## Inmobiliaria y usuarios

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| POST | `/tenants` | Crea una inmobiliaria. | Público |
| GET | `/tenants/me` | Datos de la inmobiliaria de la sesión. | Autenticado |
| PATCH | `/tenants/:id` | Edita nombre, provincia, colores de marca y logo. | Admin, Gerente |
| GET | `/tenants/me/read-policy` | Política de lectura por rol: un objeto con un arreglo de roles por recurso (`persons.bankAccounts`, `persons.document`, `contracts.commission`, `renditions`, `reports.financial`, `invoices`, `audit`). Sin configurar devuelve la de por defecto: todos los roles leen todo. | Admin |
| PUT | `/tenants/me/read-policy` | Reemplaza la política completa. Debe traer los siete recursos, solo roles válidos y al Admin en cada uno; si no, 400 `VALIDATION_ERROR`. Rige desde el pedido siguiente. | Admin |
| GET | `/tenants/me/operational-defaults` | Valores por defecto de la operación: `dueDay`, `leadDays`, `ipcLagMonths`, `allowProvisional` (pago a cuenta con índice estimado, activo de fábrica), `commissionPct`, `fees` (`alta`, `renovacion`, `ventaConstruido`, `ventaLote`, y para los honorarios: `installments` 1, `adjustInstallments` activo, `payer` `Inquilino`/`Locador`/`Ambos`, `lessorSharePct` 50, `contractTotalMode` `ConAjustesConocidos`/`AlquilerInicial`, `vatMode` `NoAplica`, `vatPct` 21, `staffCommissionPct` 0 y `staffCommissionBase` `Neto`/`Bruto`), `valuationUsd`, `upfrontThresholdFees`, `collectionCadence` (`firstReminderDays`, `everyDays`), `expiryLight` (`redDays`, `yellowDays`) `upfrontBasis` (`ComisionPactada`, `PorcentajePorDefecto`: con qué comisión mensual se mide `upfrontThresholdFees`) y las cuatro convenciones de liquidación: `prorationMode` (`DiasReales`, `Mes30`, `SinProrrateo`), `midMonthAdjustmentMode` (`DesdePeriodoSiguiente`, `Prorrateado`, `DesdeEsePeriodo`), `firstDueMode` (`DiaDeInicio`, `VencimientoMesSiguiente`, `AlFirmar`) y `fixedDiscountProration` (`Proporcional`, `Completo`), y `cash` con las convenciones de caja y cobros (ADR-0012): `lessorDirectOwes` (`TodoLoAjeno`, `SoloInmobiliaria`), `partialAllocation` (`Proporcional`, `InmobiliariaPrimero`), `custodyInAgencyBalance` (`false`), `receiptSeries` (`Unica`, `PorMoneda`, `PorCuenta`), `receiptWhenLessorReceives` (`false`) y `compensationScope` (`CualquierLocador`, `MismoContrato`) (`lessorDirectOwes` se puede pactar por contrato), y `ownerAccounts` con las del estado de cuenta del locador (ADR-0009): `statementCloseDay` (`null` = fin de mes, o 1 a 28) y `lessorChargeTiming` (`AlGenerarEstado`, `AlEmitirEstado`). y `repairs` con `preauthLimit` (importe en pesos hasta el que la inmobiliaria actúa sin consultar al locador; de fábrica 0: siempre se consulta) y `managementFeePct` (porcentaje del honorario por gestión de una reparación que se propone al imputar; de fábrica 0). Sin configurar devuelve los del código (10, 10, 2, activo, 7, 5/5/3/5, 100, 2, 5/5, 30/60). | Autenticado |
| PUT | `/tenants/me/operational-defaults` | Reemplaza los valores; lo que falte toma el del código. 400 `VALIDATION_ERROR` ante un valor fuera de rango, un campo desconocido o `yellowDays` menor que `redDays`. Un contrato nuevo nace con `dueDay`, `ipcLagMonths` y las cuatro convenciones de liquidación de acá (una opción desconocida responde 400 `VALIDATION_ERROR`). | Admin, Gerente |
| GET | `/tenants/me/read-access` | Qué recursos puede leer el rol del usuario actual: `{ role, resources: { <recurso>: boolean } }`. Lo usa la web para ocultar secciones. | Autenticado |
| GET | `/users` | El equipo: usuarios más invitaciones pendientes, cada uno con `status` (`invited`, `active` o `inactive`). En una invitación, `id` es el de la invitación y vienen `invitationExpiresAt` e `invitationExpired`. | Admin, Gerente |
| POST | `/users/invite` | Invita a un usuario con un rol asignado (`email`, `role`). Responde 201 con el enlace de aceptación (ver abajo). Errores: 400 `USER_ALREADY_EXISTS`, 409 `INVITATION_ALREADY_PENDING`. | Admin |
| POST | `/users/accept-invitation` | Acepta la invitación (`token`, `password`, `firstName`, `lastName`) y crea el usuario con el rol de la invitación. Errores: 400 `INVITATION_NOT_FOUND`, `INVITATION_EXPIRED`, `INVITATION_ALREADY_ACCEPTED`. | Público, 5/min |
| PATCH | `/users/me` | Edita los datos propios. | Autenticado |
| PATCH | `/users/:id` | Cambia el rol de un usuario (`role`). 409 `LAST_ADMIN` si dejaría a la inmobiliaria sin un Admin activo. | Admin |
| POST | `/users/:id/deactivate` | Da de baja al usuario y cierra sus sesiones. 400 `CANNOT_DEACTIVATE_SELF`; 409 `LAST_ADMIN`. | Admin |
| POST | `/users/:id/reactivate` | Vuelve a habilitar al usuario. | Admin |
| POST | `/users/:id/invitation/resend` | Reenvía una invitación pendiente (`:id` es el de la invitación): rota el token, el anterior deja de servir y el plazo se renueva. | Admin |
| POST | `/users/:id/password-reset-link` | Genera un enlace de un solo uso para que ese usuario elija una contraseña nueva. 400 `USER_INACTIVE` si está dado de baja. | Admin |
| GET | `/audit-logs` | Traza de las operaciones sensibles, con filtros. | Admin, Gerente |

**Enlaces de invitación y de recupero.** `invite`, `invitation/resend` y `password-reset-link` devuelven `{ id, email, role?, expiresAt, token, link, emailQueued }`. El `token` tiene 256 bits aleatorios, en base de datos solo queda su hash SHA-256, y el valor en claro se ve una única vez, en esa respuesta. La invitación vence a los 7 días y el enlace de recupero a la hora; ambos se consumen al usarse. `link` apunta a `WEB_BASE_URL` (o, si falta, al primer origen de `CORS_ORIGINS`) y se comparte a mano. `emailQueued` es `true` si el servicio de correo está configurado y la invitación quedó en la bandeja de salida (plantilla `user_invitation`); sale según `MESSAGING_MODE` y su estado se ve en `GET /outbox?relatedType=UserInvitation`. Un reenvío cancela el mensaje anterior, que lleva un enlace que ya no sirve. Un problema de correo nunca corta la operación. Un token inexistente, ajeno o de otra inmobiliaria responde como inexistente. Una llamada sobre un usuario (o una invitación) de otra inmobiliaria responde 404 `USER_NOT_FOUND` (`INVITATION_NOT_FOUND`).

La baja y el cambio de rol rigen desde el pedido siguiente: el token de acceso se contrasta con el estado vigente del usuario. En la traza (`/audit-logs`), las operaciones de usuarios llevan `changes.operation` (`role-change`, `deactivate`, `reactivate`, `invitation-resend`, `password-reset-link`); contraseñas y tokens se registran como `[REDACTED]` o no se registran.

**Política de lectura.** Las rutas de lectura de recursos sensibles responden 403 `READ_FORBIDDEN` (con `resource` en el cuerpo) cuando la política de la inmobiliaria no deja leer al rol: cuentas bancarias de personas, rendiciones, reportes, facturas, comisión del contrato y auditoría. En personas y contratos, `dni`, `cuit`, `bankAccounts` y `commission` viajan en `null` para los roles sin acceso, sin rechazar la lectura. Si la política no se puede cargar, se deniega. Se suma a los roles de cada ruta.

## Propiedades

`POST` y `PATCH /properties` aceptan `cadastralId`, `parentPropertyId` (el edificio que contiene la unidad) y `externalRef`. El padre debe ser de la misma inmobiliaria (404 `PARENT_PROPERTY_NOT_FOUND`), no puede ser la propia propiedad (400 `PROPERTY_SELF_PARENT`) ni quedar dentro de una de sus unidades (400 `PROPERTY_PARENT_CYCLE`). Una `externalRef` ya usada en la inmobiliaria responde 409 `EXTERNAL_REF_TAKEN`.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/properties` | Listado paginado y filtrable (también por `externalRef` y `parentPropertyId`). | Autenticado |
| GET | `/properties/:id` | Detalle con operaciones, media y personas vinculadas. | Autenticado |
| POST | `/properties` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/properties/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/properties/:id` | Baja. Responde 409 `PROPERTY_HAS_ACTIVE_CONTRACTS` si tiene contratos activos. | Admin, Gerente |
| GET | `/properties/:id/ownerships` | Titulares de la propiedad. | Autenticado |
| POST | `/properties/:id/ownerships` | Registra un titular (`personId`; `sharePct`, `title`, `since`, `until` opcionales). No se exige que los porcentajes sumen 100. Le agrega a la persona el rol `Propietario`. | Admin, Gerente, Ventas |
| DELETE | `/properties/:id/ownerships/:ownershipId` | Quita un titular. 404 `OWNERSHIP_NOT_FOUND`. | Admin, Gerente, Ventas |
| POST | `/properties/:id/operations` | Agrega una operación de alquiler, alquiler temporario o venta. | Admin, Gerente, Ventas |
| PATCH | `/properties/:id/operations/:opId/state` | Transiciona el estado de la operación. | Admin, Gerente, Ventas |
| POST | `/properties/:id/media` | Sube una imagen. Multipart, campo `file`, hasta 10 MB, solo imágenes. | Admin, Gerente, Ventas |
| DELETE | `/properties/:id/media/:mediaId` | Borra una imagen. | Admin, Gerente, Ventas |
| PATCH | `/properties/:id/media/reorder` | Reordena la galería. | Admin, Gerente, Ventas |

### Tasaciones

Cuelgan de la propiedad.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/properties/:propertyId/valuations` | Historial de tasaciones. | Autenticado |
| GET | `/properties/:propertyId/valuations/comparables` | Comparables de la propia cartera por ciudad, tipo y ambientes. | Autenticado |
| GET | `/properties/:propertyId/valuations/:valuationId` | Detalle. | Autenticado |
| POST | `/properties/:propertyId/valuations` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/properties/:propertyId/valuations/:valuationId` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/properties/:propertyId/valuations/:valuationId` | Baja. | Admin, Gerente |

## Personas

`POST` y `PATCH /persons` aceptan además `personType` (`Fisica` o `Juridica`), `dni`, `address`, `maritalStatus`, `nationality`, `payoutMethod` (`Transferencia`, `Efectivo` o `Custodia`) y `externalRef`, todos opcionales. Los campos planos `bankName`, `cbu` y `bankAlias` siguen aceptándose como atajo y se guardan como la cuenta predeterminada en pesos; las respuestas ya no los devuelven, traen `bankAccounts`. `GET /persons` filtra por `externalRef` y `personType`.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/persons` | Listado paginado y filtrable. | Autenticado |
| GET | `/persons/:id` | Detalle con roles, documentos, cuentas bancarias e historial. | Autenticado |
| POST | `/persons` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/persons/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id` | Baja. | Admin, Gerente |
| POST | `/persons/:id/roles` | Asigna un rol (propietario, inquilino, garante, proveedor, comprador, apoderado). Con rol `Propietario` y `propertyId` crea la titularidad de esa propiedad; `propertyId` de la asignación ya no se guarda. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id/roles/:roleId` | Quita una asignación de rol. | Admin, Gerente, Ventas |
| POST | `/persons/:id/documents` | Sube un documento. Multipart, campo `file`. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id/documents/:docId` | Borra un documento. | Admin, Gerente, Ventas |
| GET | `/persons/:id/bank-accounts` | Cuentas bancarias de la persona, ordenadas por moneda y con la predeterminada primero. 404 `PERSON_NOT_FOUND` si la persona es de otra inmobiliaria. | Autenticado |
| POST | `/persons/:id/bank-accounts` | Alta de una cuenta (`currency` obligatoria; `bankName`, `cbu` de 22 dígitos, `alias`, `holder`, `isDefault`). La primera de cada moneda queda predeterminada; con `isDefault: true` reemplaza a la actual. | Admin, Gerente, Ventas |
| PATCH | `/persons/:id/bank-accounts/:accountId` | Edición (la moneda no cambia). `isDefault: true` intercambia la predeterminada; `isDefault: false` sobre la predeterminada responde 409 `BANK_ACCOUNT_DEFAULT_REQUIRED`. 404 `BANK_ACCOUNT_NOT_FOUND`. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id/bank-accounts/:accountId` | Baja. Responde 409 `BANK_ACCOUNT_DEFAULT_REQUIRED` si es la predeterminada y quedan otras de la misma moneda. | Admin, Gerente, Ventas |
| GET | `/persons/:id/powers` | Poderes que otorgó la persona; con `?as=agent`, los que ejerce como apoderada. `?activeOn=` limita a los vigentes ese día. | Autenticado |
| POST | `/persons/:id/powers` | La persona otorga un poder: `agentId`, `scopes` (`Cobrar`, `Firmar`, `Administrar`), `signatureMode` (`Indistinta` o `Conjunta`), `contractId` o `propertyId` (sin ninguno es general), `validFrom`, `validTo`, `documentUrl`. Con firma conjunta, los apoderados del mismo alcance comparten `groupKey`. 400 `POWER_SELF` si se da poder a sí misma. Le agrega al apoderado el rol `Apoderado`. | Admin, Gerente, Ventas |
| PATCH | `/persons/:id/powers/:powerId` | Cambia alcances, firma, vigencia o documento. 404 `POWER_NOT_FOUND`; 409 `POWER_IN_USE` si dejaría sin poder de cobro a un cobrador en uso. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id/powers/:powerId` | Revoca el poder (409 `POWER_IN_USE` si un locador lo usa para su cobrador). | Admin, Gerente, Ventas |
| POST | `/persons/:id/portal-invite` | Genera la invitación al portal del inquilino. | Admin, Gerente |
| GET | `/persons/:id/consents` | Consentimiento de mensajes por canal (`Email`, `WhatsApp`): el último registro (`status` `OptIn`/`OptOut` o `null`, `source` `Manual`/`Inbound`/`Complaint`, `at`, `note`), la dirección actual de la persona en ese canal y el historial. 404 `PERSON_NOT_FOUND`. | Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte |
| PUT | `/persons/:id/consents` | Registra un alta o una baja: `{ channel, status, note? }`. Agrega un registro al historial con quién lo cargó y la dirección actual; vale el último (ver «Mensajería»). | Admin, Gerente, Ventas, Liquidaciones |

## Proveedores

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/providers` | Listado. | Autenticado |
| GET | `/providers/:id` | Detalle. | Autenticado |
| GET | `/providers/for-ticket/:ticketId` | Proveedores habilitados para ese ticket, según rubro y zona. | Admin, Gerente, Soporte |
| POST | `/providers` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/providers/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/providers/:id` | Baja. | Admin, Gerente |

## Contratos

Tres controladores distintos aportan rutas bajo `/contracts`: el de contratos, el
de plantillas y el de comisiones.

`POST` y `PATCH /contracts` aceptan `externalRef` (único por inmobiliaria, 409 `EXTERNAL_REF_TAKEN`) y `GET /contracts` filtra por `externalRef`.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/contracts` | Listado filtrable. | Autenticado |
| GET | `/contracts/:id` | Detalle con partes (inquilino, garante), locadores, apoderados vigentes, garantías, ajustes y comisión. | Autenticado |
| POST | `/contracts` | Alta, en `Borrador` por defecto. Con `status: Activo` se crea ya activado y pasa por las mismas validaciones que `/activate`. Los locadores llegan en `lessors` (`personId`, `payoutPct`, `capacity`, `payeePersonId`, `bankAccountId`, `validFrom`, `validTo`); si se omiten, los `persons` con rol `Propietario` se reparten el 100 % en partes iguales. Un locador no necesita tener ya el rol de propietario: se le asigna. Inquilino y garante sí necesitan su rol (400 `INVALID_PERSON_ROLE`). `liquidationRules` (opcional: `prorationMode`, `midMonthAdjustmentMode`, `firstDueMode`, `fixedDiscountProration`, `upfrontBasis`, `upfrontThresholdFees`, entero de 0 a 24 o `null`, `repairPreauthLimitAmount` con `repairPreauthLimitCurrency` (el límite de reparaciones que la inmobiliaria resuelve sin consultar al locador, o `null`) y `lessorDirectOwes`, `TodoLoAjeno` o `SoloInmobiliaria` o `null`) pacta las convenciones de liquidación y el anticipo del contrato; lo omitido toma el valor por defecto de la inmobiliaria. | Admin, Gerente, Ventas |
| PATCH | `/contracts/:id` | Edición. Los cambios de estado respetan la máquina de estados del contrato; pasar a `Activo` se hace con `/activate` (`ACTIVATION_REQUIRED`). Acepta `actualEndDate` (fin real o prórroga de palabra, `null` la quita; no puede ser anterior al inicio, 400 `VALIDATION_ERROR`) y rehace el cronograma pendiente hasta el fin efectivo. Acepta `liquidationRules` para corregir las convenciones de liquidación en la versión inicial del contrato. Cambiar la modalidad de ajuste o las convenciones de un contrato con más de una versión de reglas se rechaza (409 `RULES_CHANGE_REQUIRES_AGREEMENT`): va por convenio. Un contrato pasado de su fin pactado sin `actualEndDate` sigue `Activo`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/activate` | `Borrador` → `Activo`. Valida propiedad, inquilino, fechas que los locadores vigentes sumen exactamente 100 % en cada fecha del contrato (`LESSOR_SHARES_INVALID`, con las fechas y sumas en `invalidDates`) y que no haya otro alquiler activo de la propiedad con fechas superpuestas; si falla responde `CONTRACT_NOT_ACTIVATABLE` con la lista `problems`. Deja la operación de alquiler de la propiedad en `Alquilado`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/oral-extension` | Prórroga de palabra (`{ until, note }`, `until` en `YYYY-MM-DD`): registra un convenio `Prorroga`, mueve `actualEndDate` (el fin real) a `until` sin tocar `endDate`, cierra los seguimientos abiertos como `Prorrogado`, rehace el cronograma de ajustes pendiente y audita (`oral-extension`). Devuelve `{ agreement, contract }`. Errores: 400 `VALIDATION_ERROR`, 400 `EXTENSION_NOT_AFTER_END` (no es posterior al fin efectivo), 404 `CONTRACT_NOT_FOUND`, 409 `CONTRACT_NOT_ACTIVE` (ni activo ni vencido). Un contrato `Vencido` vuelve a `Activo` (sin fecha de cierre, propiedad ocupada otra vez) si el nuevo fin no pisa a otro alquiler activo (400 `CONTRACT_NOT_ACTIVATABLE`); la auditoría lo registra (`reactivated`). | Admin, Gerente |
| POST | `/contracts/:id/renew` | Renovación como período del mismo contrato: `{ start, end, rent, adjustment?: { adjustmentType, adjustmentPeriod, customPct, customSteps }, guarantorPersonIds?, fee?: { amount, currency }, signedAt?, notes? }`. En una transacción crea el período `Renovacion` (alquiler inicial, honorarios y garantes) y, con `fee`, el honorario `Renovacion` del período (ver [Honorarios](#honorarios)), un convenio `Renovacion` con la versión de reglas nueva (`rentOverride` y la regla), pasa `endDate` al fin del período, deja `actualEndDate` en `null` y, si `start` ya llegó, `rentAmount` al alquiler nuevo; cierra los seguimientos abiertos como `Renovado`, rehace el cronograma y audita (`renewal`). Devuelve `{ period, contract }`. Errores: 400 `VALIDATION_ERROR`, 400 `RENEWAL_BEFORE_PERIOD_START`, 400 `GUARANTOR_NOT_IN_CONTRACT`, 404 `CONTRACT_NOT_FOUND`, 409 `CONTRACT_NOT_ACTIVE` (ni activo ni vencido; un vencido vuelve a `Activo` igual que con la prórroga), 409 `TERMS_VERSION_EXISTS` (hay reglas desde esa fecha o una posterior). Si `start` es posterior a hoy, `rentAmount` no cambia hasta que llegue (la liquidación toma el alquiler nuevo de la versión de reglas desde `start`). | Admin, Gerente |
| GET | `/contracts/:id/periods/:seq/addendum` | Adenda corta de renovación en PDF (modelo sintético: período, alquiler en números y letras, regla de ajuste, garantes, honorarios y firmas). 400 `PERIOD_NOT_A_RENEWAL`, 404 `PERIOD_NOT_FOUND`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/terminate` | Rescinde el contrato y produce el resumen de cierre. Si era el último alquiler activo, la operación de alquiler de la propiedad vuelve a `Disponible`. | Admin, Gerente |
| GET | `/contracts/:id/lessors` | Locadores del contrato con persona, cobrador y cuenta, de menor a mayor fecha de inicio. `?at=` devuelve solo los vigentes en esa fecha. | Autenticado |
| POST | `/contracts/:id/lessors` | Agrega un locador. En un contrato que ya salió de `Borrador`, el resultado tiene que sumar 100 % en cada fecha (400 `LESSOR_SHARES_INVALID`, con `details.invalidDates`). Valida la cuenta (400 `BANK_ACCOUNT_NOT_OF_LESSOR`) y el cobrador (400 `PAYEE_WITHOUT_POWER`). | Admin, Gerente, Ventas |
| PUT | `/contracts/:id/lessors` | Reemplaza todo el conjunto en una transacción (`{ lessors: [{ id?, ... }] }`): las filas con `id` se actualizan, las nuevas se crean y las que faltan se borran. Siempre exige que sumen 100 %. Sirve para cambiar el reparto o hacer una cesión de un contrato activo. | Admin, Gerente, Ventas |
| PATCH | `/contracts/:id/lessors/:lessorId` | Cambia capacidad, porcentaje, cuenta, cobrador o vigencia. Cambiar el porcentaje baja la marca `needsReview`. 404 `LESSOR_NOT_FOUND`. | Admin, Gerente, Ventas |
| DELETE | `/contracts/:id/lessors/:lessorId` | Quita un locador (mismas reglas de suma que el alta). | Admin, Gerente, Ventas |
| GET | `/contracts/:id/terms` | Versiones de reglas del contrato y la vigente a `?at=` (hoy si se omite): `{ at, current, versions }`; `current` es `null` si la fecha es anterior al inicio. 400 `VALIDATION_ERROR` con una fecha inválida. | Autenticado |
| GET | `/contracts/:id/periods` | Períodos del contrato (original, renovaciones, prórrogas). | Autenticado |
| GET | `/contracts/:id/agreements` | Convenios del contrato con la versión de reglas que crearon. | Autenticado |
| POST | `/contracts/:id/agreements` | Registra un convenio (`kind`, `effectiveFrom`, `effectiveTo`, `documentUrl`, `notes`, `termsPatch`). `CambioRegla`, `Renegociacion`, `Rebaja` y `Bonificacion` exigen `termsPatch` (cualquiera de modalidad, período, base, rezago, porcentaje, escalones, alquiler acordado, descuento, vencimiento, flujo de cobro, punitorios, las cuatro convenciones de liquidación, el anticipo y `lessorDirectOwes`, qué debe el locador que cobra directamente; `null` quita un valor y vuelve al de la inmobiliaria) y crean una versión nueva en la misma transacción; si rige desde hoy o antes, las columnas de ajuste del contrato quedan iguales a la versión vigente y, si cambió la periodicidad, se rehace el cronograma pendiente. Errores: 400 `AGREEMENT_BEFORE_START`, 400 `MISSING_ADJUSTMENT_PCT`, 400 `VALIDATION_ERROR`, 400 `USE_DEDICATED_ENDPOINT` (`Prorroga` y `Renovacion` tienen sus propias rutas), 409 `TERMS_VERSION_EXISTS` (ya hay una versión con esa fecha). | Admin, Gerente |
| PATCH | `/contracts/:id/agreements/:agreementId` | Corrige `effectiveTo`, `documentUrl` o `notes`. 409 `AGREEMENT_HAS_LATER_VERSIONS` si una versión posterior depende del convenio; 404 `AGREEMENT_NOT_FOUND`. | Admin, Gerente |
| DELETE | `/contracts/:id/agreements/:agreementId` | Borra el convenio y su versión de reglas, con las mismas condiciones; las columnas del contrato vuelven a la versión vigente. | Admin, Gerente |
| GET | `/contracts/:id/adjustments` | Historial de ajustes del contrato. Con `?pendingTrueUp=true[&upTo=YYYY-MM]` lista en cambio las correcciones de ajustes provisorios todavía sin facturar: por cada una, el ajuste definitivo (`adjustmentId`) y el provisorio, el primer mes afectado (`effectiveFrom`), el alquiler provisorio y el oficial, la diferencia mensual (`monthlyDelta`, negativa si el estimado se pasó), los meses hasta `upTo` (por defecto el mes actual) con su diferencia y el `total`. Es el dato que lee el armado de liquidaciones (ADR-0011). 400 `VALIDATION_ERROR` si `upTo` no es `YYYY-MM`. | Autenticado |
| POST | `/contracts/:id/adjustments/calculate` | Calcula el ajuste pendiente. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/adjustments/:adjId/apply` | Aplica un ajuste calculado. | Admin, Gerente |
| POST | `/contracts/:id/preview-adjustment` | Simula un ajuste sin persistirlo. | Admin, Gerente |
| GET | `/contracts/:id/available-templates` | Plantillas aplicables al contrato. | Admin, Gerente, Ventas |
| GET | `/contracts/:id/template-variables` | Variables que la plantilla puede interpolar: `contrato.*`, `propiedad.*`, `locadores.N.*` y `locador.*` (nombre, documento, domicilio, capacidad, porcentaje; `propietario.*` es un alias del primero), `apoderados.N.*`, `inquilino.*`, `garante.*`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/generate-document` | Renderiza el documento del contrato. | Admin, Gerente, Ventas |
| GET | `/contracts/:contractId/commission` | Comisión pactada. | Autenticado |
| POST | `/contracts/:contractId/commission` | Define la comisión (`type`, `percentage`, `fixedAmount`, `adminFee`, `currency`, `notes`) y, opcional, `repairMgmtFeePct`: honorario por gestión de una reparación a cargo del locador, en % de su importe (0 a 100, `null` = sin honorario; ADR-0009). | Admin, Gerente |
| DELETE | `/contracts/:contractId/commission` | Quita la comisión. | Admin, Gerente |

### Plantillas de contrato

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/contract-templates` | Listado. | Admin, Gerente |
| GET | `/contract-templates/:id` | Detalle. | Admin, Gerente |
| POST | `/contract-templates` | Alta. | Admin, Gerente |
| PATCH | `/contract-templates/:id` | Edición. | Admin, Gerente |
| DELETE | `/contract-templates/:id` | Baja. | Admin, Gerente |
| POST | `/contract-templates/seed-defaults` | Carga el juego de plantillas por defecto. | Admin, Gerente |

## Índices de ajuste

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| POST | `/adjustments/preview-batch` | Previsualiza los ajustes de alquiler que vencen hasta el mes `period` (`YYYY-MM`): un contrato por fila, con su ajuste pendiente más antiguo. Cada fila trae `currentRent`, `newRent`, `percentage`, `factor`, los valores de índice usados (`indexValues`, con los estimados marcados), `isProvisional` y `estimatedPeriods`, `overdue` si venía atrasado, y `status` (`ready`, `provisional`, `fixed_initial`, `missing_data`, `error`) con `selectable`. Si faltan índices, `missing` lista los índices y los meses (`estimatesOnly`: hay estimado pero el pago a cuenta está apagado); otros errores de la modalidad van en `error`. No escribe nada. 400 `VALIDATION_ERROR` ante un período inválido. | Admin, Gerente, Liquidaciones |
| POST | `/adjustments/apply-batch` | Aplica los ajustes elegidos (`period`, `contractIds`, hasta 500). Cada contrato va en su transacción y se informa por contrato: `applied` con `status` (`applied`, `provisional`, `fixed_initial`) y los alquileres, o `skipped` con `reason` (`MISSING_INDEX_DATA` con `indexTypes` y `missingPeriods`, `NO_DUE_ADJUSTMENT`, `CONTRACT_NOT_FOUND` u otro código de la modalidad). Un ajuste con índice oficial queda definitivo; solo con estimados queda provisorio si la inmobiliaria permite el pago a cuenta. Audita cada ajuste. | Admin, Gerente, Liquidaciones |
| POST | `/adjustments/_run-now` | Dispara de inmediato el proceso diario `adjustments-daily` (07:00 de Buenos Aires: aplica los ajustes vencidos y corrige los provisorios) en todas las inmobiliarias y devuelve lo aplicado, lo salteado con los meses que faltan, las correcciones y los provisorios que siguen esperando. Solo con `NODE_ENV=test` o `E2E_TEST_MODE=1`; fuera de eso, 403. | Admin |
| GET | `/index-data` | Valores publicados por tipo de índice y período. | Autenticado |
| GET | `/index-data/latest` | Último valor oficial de cada índice (los estimados no cuentan). | Admin, Gerente |
| GET | `/index-data/estimates-replaced` | Estimados que ya tienen valor oficial (`?since=` filtra por fecha del reemplazo): por cada uno, índice, período, valor estimado y oficial, `via` (`manual` o `published`) y `contractIds` con ajustes provisionales sin corregir. La corrección la hace el proceso diario de ajustes (ADR-0011). | Admin, Gerente |
| POST | `/index-data` | Carga manual de un valor. Acepta `isEstimate` y `estimateSource` (solo con `isEstimate`); un valor oficial reemplaza al estimado de la misma clave y queda registrado, y un estimado sobre un oficial responde 409 `OFFICIAL_VALUE_EXISTS`. `indexType` incluye `TasaActivaBNA`. | Admin |
| POST | `/index-data/bulk` | Carga manual de varios valores. | Admin |
| DELETE | `/index-data/:id` | Borra un valor. | Admin |
| POST | `/index-data/refresh` | Dispara la obtención de los índices desde las fuentes publicadas. | Admin |

## Servicios de la propiedad

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/services` | Listado de servicios asociados a propiedades y contratos. | Autenticado |
| GET | `/services/:id` | Detalle. | Autenticado |
| POST | `/services` | Alta. Además del tipo (incluye `ImpuestoInmobiliario`), acepta `billingFrequency` (`Mensual` por defecto, `Bimestral`, `Trimestral`, `Anual`) y `hasAnnualOption` (falso por defecto). | Admin, Gerente, Ventas |
| PATCH | `/services/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/services/:id` | Baja. | Admin, Gerente |
| POST | `/services/:id/payments` | Registra el pago de un servicio. | Admin, Gerente, Ventas |

### Boletas de servicios e impuestos

La boleta es una entidad propia, distinta del pago (ADR-0008). Cada parte que le toca al inquilino se guarda y se cobra en su liquidación, una sola vez.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/service-bills` | Boletas paginadas; filtra por `period` (`AAAA-MM`), `propertyId`, `serviceId` y `status`. | Autenticado |
| GET | `/service-bills/sheet?period=AAAA-MM` | Planilla del mes: un renglón por servicio activo con sus boletas del período y las reglas vigentes de sus contratos (quién paga, reparto, plan). `propertyId` opcional. | Autenticado |
| GET | `/service-bills/:id` | Boleta con sus partes. | Autenticado |
| GET | `/service-bills/:id/allocations` | Partes guardadas (`stored`, con `billedAt` y `liquidacionId`) y el reparto que da hoy con las reglas vigentes (`preview`, con `skipped` y `warnings`). | Autenticado |
| POST | `/service-bills/bulk` | Carga un arreglo de hasta 500 boletas (`serviceId`, `period`, `amount`, y opcionales `installmentLabel`, `nominalAmount`, `dueDate`, `consumption`, `unitConsumptions`, `notes`). Idempotente por `[serviceId, period, installmentLabel]`: responde 200 con `total`, `created`, `updated`, `unchanged`, `failed` y un resultado por fila (`index`, `status`, `billId` o `error`). Una fila con error no frena las demás. | Admin, Gerente, Liquidaciones |
| PATCH | `/service-bills/:id` | Corrige importe, vencimiento, consumo o notas, o registra el pago (`paidBy`, `paidAt`, `receiptUrl`; con los dos primeros pasa a `Pagada` y deja un pago ligado). `status` `Anulada` quita las partes sin facturar. | Admin, Gerente, Liquidaciones |

Códigos de error propios: `BILL_NOT_FOUND` (404), `BILL_ALREADY_BILLED` (409, la boleta ya tiene partes en una liquidación y no cambia), `BILL_PAYMENT_DATA_REQUIRED` (400, `Pagada` sin `paidBy` o `paidAt`), `ALLOCATION_ALREADY_BILLED` (409, otra generación ya incluyó la parte), `SERVICE_NOT_FOUND` (404), `FIXED_AMOUNT_REQUIRED` e `INVALID_SHARE_PCT` e `INVALID_INSTALLMENTS` (400, regla mal armada) y `VALIDATION_ERROR`. En la carga masiva el código viaja en el `error` de cada fila.

### Centro de carga (cargos pendientes)

Gastos y cargos puntuales del mes (reparaciones, expensas extraordinarias, devoluciones, honorarios por gestión). Cada cargo se imputa una sola vez: al inquilino en su próxima liquidación, o al locador en su próximo estado (la imputación al estado del locador la completa el estado de cuenta del locador; mientras tanto el cargo queda `Pendiente`).

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/charges` | Cargos paginados; filtra por `contractId`, `propertyId`, `status`, `chargedTo`, `period` (`AAAA-MM`: el mes de imputación o, sin él, el del gasto) y `requiresUpfront`. | Autenticado |
| GET | `/charges/:id` | Un cargo con su propiedad, contrato y locador. | Autenticado |
| POST | `/charges` | Carga un cargo: `chargedTo` (`Inquilino`, `Locador`, `Inmobiliaria`), `kind` (`Reparacion`, `ExpensaExtra`, `Devolucion`, `HonorarioGestion`, `AjusteRetroactivo`, `Otro`), `description`, `amount`, `incurredAt`; y opcionales `contractId` (obligatorio si va al inquilino), `propertyId` (obligatorio sin contrato), `lessorPersonId`, `currency`, `beneficiary` (`Locador` por defecto, o `Inmobiliaria`), `targetPeriod`, `installments` (1 a 36, una cuota por mes por mayor resto), `notes`. Devuelve `{ items }` con un cargo por cuota. | Admin, Gerente, Liquidaciones |
| POST | `/charges/bulk` | Carga una planilla de hasta 200 cargos (`{ rows }`); cada fila se valida y se guarda por separado y se informa el resultado de cada una. | Admin, Gerente, Liquidaciones |
| PATCH | `/charges/:id` | Corrige un cargo `Pendiente` (descripción, importe, destino, fechas, notas). `requiresUpfront: false` fuerza la imputación en la liquidación aunque supere el umbral. | Admin, Gerente, Liquidaciones |
| POST | `/charges/:id/cancel` | Anula un cargo `Pendiente` (queda en el historial). | Admin, Gerente, Liquidaciones |
| POST | `/charges/:id/mark-paid-upfront` | El inquilino pagó el cargo por adelantado: pasa a `CobradoAnticipado` y no entra en la liquidación. | Admin, Gerente, Liquidaciones |
| POST | `/charges/:id/release` | Devuelve a `Pendiente` un cargo imputado en una liquidación anulada. | Admin, Gerente, Liquidaciones |
| POST | `/charges/:id/agency-expense` | Cierra un cargo `Pendiente` a la inmobiliaria como egreso de una de sus cuentas: `accountId` (caja o banco activos, de la moneda del cargo), `date` y `note` opcionales. Escribe un movimiento `Gasto` (`Out`, o `In` si el cargo es un crédito) con origen `PendingCharge` y deja el cargo `Imputado`, en una transacción con auditoría. Devuelve `{ charge, movement }`. | Admin, Gerente, Liquidaciones |

- **Importe con signo.** Un importe negativo es un crédito a favor de quien soporta el cargo; una `Devolucion` se guarda siempre negativa. En la liquidación del inquilino va como `Descuento` "a favor del inquilino" (los renglones no pueden ser negativos), sin comisión.
- **Renglón en la liquidación** (solo cargos al inquilino): `Cargo` (reparación, expensa extra, otro), `Honorario` (honorario por gestión, siempre a favor de la inmobiliaria) o `AjusteRetroactivo`. Nunca llevan comisión salvo el ajuste retroactivo. `beneficiary` dice quién recibe el dinero. El renglón lleva `sourceType` `PendingCharge` y el id del cargo.
- **Anticipo.** Un cargo al inquilino cuyo importe supera el umbral de anticipo del contrato queda con `requiresUpfront: true`: sigue `Pendiente` y no entra solo en la liquidación. El umbral (en comisiones mensuales) es el `upfrontThresholdFees` de la versión de reglas vigente a la fecha del gasto o, si es `null`, el de los valores por defecto de la inmobiliaria (2). `upfrontBasis` dice con qué comisión mensual se mide: `ComisionPactada` (la del contrato; sin ella, el porcentaje por defecto) o `PorcentajePorDefecto` (siempre ese porcentaje sobre el alquiler vigente). Ambos se pactan al crear el contrato (`liquidationRules`) o en un convenio (`termsPatch`). Se imputa a la fuerza con `PATCH` (`requiresUpfront: false`) o se marca `mark-paid-upfront`. Sin comisión mensual, o en otra moneda que la del alquiler, no se evalúa.
- **Una sola vez.** La liquidación marca los cargos `Imputado` (`imputedLiquidacionId`) en la misma transacción que la crea; si otra generación ya los tomó, falla y no crea nada. Borrar una liquidación en borrador, anularla o quitar el renglón devuelve a `Pendiente` los cargos, las partes de boletas, las correcciones de ajustes provisorios y los punitorios que traía, en la misma transacción y con una fila de auditoría (`release-on-annulled` o `release-on-deleted`, con la cantidad liberada de cada clase). `POST /charges/:id/release` queda para un cargo que, por datos anteriores, haya quedado `Imputado` en una liquidación anulada.
- **A cargo de la inmobiliaria.** Queda `Pendiente` y no se imputa a nadie hasta que se cierra con `POST /charges/:id/agency-expense` como gasto de la caja (ADR-0012). Un cargo cerrado así no se libera (`CHARGE_PAID_BY_AGENCY`).
- **Locador.** `lessorPersonId` elige un locador; sin él, el gasto es de todos los locadores según su porcentaje de cobro.

Códigos de error propios: `CHARGE_NOT_FOUND` (404), `CHARGE_NOT_EDITABLE` y `CHARGE_NOT_CANCELLABLE` (409, el cargo ya no está `Pendiente`), `CHARGE_NOT_PENDING` (409), `CHARGE_NOT_IMPUTED` (409, solo se libera un cargo imputado), `CHARGE_LIQUIDATION_ACTIVE` (409, la liquidación sigue vigente), `CHARGE_IN_STATEMENT` (409, ya se descontó en un estado del locador), `CHARGE_ALREADY_IMPUTED` (409, otra generación lo tomó), `UPFRONT_NOT_APPLICABLE` (400, el anticipo solo corresponde a un cargo al inquilino), `PROPERTY_MISMATCH` (400), `CHARGE_NOT_AGENCY` (400, solo un cargo a la inmobiliaria se cierra como gasto), `CHARGE_PAID_BY_AGENCY` (409), `CURRENCY_MISMATCH` (400).

### Reglas de impuestos y servicios del contrato

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/contracts/:id/charge-rules` | Reglas del contrato: `current` (vigentes a `at`, hoy si se omite; `serviceId` filtra) y `versions` (todas, con las ya cerradas). | Autenticado |
| POST | `/contracts/:id/charge-rules` | Crea la regla de un servicio desde `validFrom`: `payer` (`Inquilino`, `Inmobiliaria`, `Propietario`), `splitMode` (`Porcentaje` por defecto, `Consumo`, `Fijo`), `tenantSharePct` (100 por defecto), `fixedAmount` (obligatorio con `Fijo`), `paymentPlan` (`Mensual` o `Anual`), `annualRecovery` (`Prorrateado` por defecto o `Unico`), `annualInstallments` (1 a 12, 12 por defecto; solo con `Prorrateado`), `annualDiscountBeneficiary` (`Inquilino` por defecto, `Locador` o `Inmobiliaria`: con los dos últimos se cobra el importe sin descuento y la diferencia sale como renglón `Cargo` a su nombre), `remainingInstallmentsOnEnd` (`CobrarEnLiquidacionFinal` por defecto o `Descartar`: qué se hace con las cuotas posteriores al fin del contrato), `validTo`, `agreementId`, `notes`. Si ya había una regla del servicio, la anterior se cierra el día previo. En un contrato que no es borrador exige `agreementId` de un acuerdo `CambioCargo` con esa fecha. | Admin, Gerente, Liquidaciones |
| PATCH | `/contracts/:id/charge-rules/:ruleId` | Corrige una regla que todavía no se usó para facturar (en un contrato que no es borrador, solo si nació de un acuerdo). | Admin, Gerente, Liquidaciones |

Códigos de error: `CHARGE_RULE_REQUIRES_AGREEMENT` (409), `CHARGE_RULE_EXISTS` (409, ya hay una regla del servicio con esa fecha), `CHARGE_RULE_IN_USE` (409, ya se usó en una liquidación), `CHARGE_RULE_BEFORE_START` y `CHARGE_RULE_DATE_MISMATCH` (400), `CHARGE_RULE_NOT_FOUND` (404), `SERVICE_NOT_APPLICABLE` (400, el servicio no es de la propiedad del contrato ni de su edificio), `AGREEMENT_NOT_FOUND` (404) y `AGREEMENT_KIND_MISMATCH` (400).

## Vencimientos

Seguimiento del fin de los contratos con su semáforo y su checklist. El proceso diario (05:30, hora de Buenos Aires) abre un seguimiento por contrato de alquiler activo cuyo fin efectivo está a `expiryLight.yellowDays` días o menos (60 por defecto), incluidos los ya vencidos y los contratos `Vencido` sin decisión (sin renovación, sin resumen de cierre y sin fecha de cierre), como `Renovacion` con resultado `Pendiente`; es idempotente por `(contractId, kind, dueDate)`. El semáforo (`light`) se calcula y solo viaja en los seguimientos abiertos: `expired` (el fin efectivo pasó), `red` (hasta `redDays` días), `yellow` (hasta `yellowDays`) y `green`.

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/follow-ups` | Lista paginada (`?light=&kind=&status=&assigneeId=&contractId=&page=&limit=`, `limit` hasta 100), de la fecha de fin más próxima a la más lejana. Cada fila trae `effectiveEnd`, `signedEnd`, `daysLeft`, `light`, `property`, `tenantName`, `tasks` y `progress`. Filtrar por `light` limita a los abiertos. 400 `VALIDATION_ERROR`. | Autenticado |
| GET | `/follow-ups/:id` | Un seguimiento con su checklist. 404 `FOLLOW_UP_NOT_FOUND`. | Autenticado |
| PATCH | `/follow-ups/:id` | Cambia `assigneeId` (`null` lo quita), `kind` (arma el checklist del tipo nuevo y conserva lo hecho), `notes` y `outcome` (cualquiera distinto de `Pendiente` cierra el seguimiento; `Pendiente` lo reabre). Errores: 400 `ASSIGNEE_NOT_FOUND`, 404 `FOLLOW_UP_NOT_FOUND`, 409 `FOLLOW_UP_CLOSED` (cambiar el tipo de uno cerrado), 409 `FOLLOW_UP_EXISTS` (ya hay uno de ese tipo para ese fin). Audita. | Admin, Gerente, Ventas |
| PATCH | `/follow-ups/:id/tasks/:taskId` | Marca o desmarca un paso (`{ done, dueDate? }`) con quién y cuándo. 404 `FOLLOW_UP_TASK_NOT_FOUND`, 409 `FOLLOW_UP_CLOSED`. | Admin, Gerente, Ventas |

La prórroga de palabra, la renovación y la adenda están en [Contratos](#contratos) (`/contracts/:id/oral-extension`, `/contracts/:id/renew`, `/contracts/:id/periods/:seq/addendum`). Los avisos de vencimiento del barrido de las 08:00 y el panel (`expiringContracts` y la agenda de vencimientos) miden con el fin efectivo.

### Depósitos y liquidación de egreso

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/contracts/:id/deposit` | `{ deposit, defaults }`: el depósito con sus cuotas (`installmentRows`), `collectedAmount` y `pendingAmount`, o `null`; `defaults` trae los valores por defecto de la inmobiliaria (`operationalDefaults.deposits`). 404 `CONTRACT_NOT_FOUND`. | Admin, Gerente, Liquidaciones, Lectura |
| PUT | `/contracts/:id/deposit` | Alta o cambio (`{ amount, currency, heldBy, heldByPersonId, installments, refundRule, refundInstallments, refundDueDays?, firstDueDate?, notes? }`). Rehace las cuotas si no hay cobradas; con cobradas solo cambian la regla, el plazo y las notas. Errores: 400 `VALIDATION_ERROR` (pesos actualizado solo en ARS; el locador es obligatorio si lo guarda el locador), 400 `HOLDER_NOT_FOUND`, 409 `DEPOSIT_REFUNDED`, 409 `DEPOSIT_HAS_PAYMENTS`. Audita. | Admin, Gerente |
| POST | `/contracts/:id/deposit/installments/:number/collect` | Cobra una cuota (`{ paidAt?, method?, accountId?, note? }`). Si lo guarda la inmobiliaria entra a la cuenta indicada (o a la caja o el banco de la moneda) o, con un locador dueño del dinero, a su custodia, como movimiento `Deposito`; si lo guarda el locador solo se anota. Errores: 404 `DEPOSIT_NOT_FOUND`, 404 `INSTALLMENT_NOT_FOUND`, 409 `INSTALLMENT_ALREADY_COLLECTED`, 409 `DEPOSIT_REFUNDED`. Audita. | Admin, Gerente, Liquidaciones |
| GET | `/contracts/:id/move-out` | `{ settlement }`: la liquidación de egreso del contrato o `null`. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/contracts/:id/move-out/preview?date=&rate=` | Vista previa a la fecha (por defecto, hoy): `items` (alquileres sin cobrar, el alquiler del último mes prorrateado con la convención del contrato si ese mes no tiene liquidación, punitorios devengados a esa fecha, partes de boletas sin facturar, cargos y reparaciones pendientes del inquilino), `deposit` (con `refundable` según la regla y `collected`) y los totales `totalOwed`, `depositAvailable`, `retained`, `refundToTenant`, `owedByTenant`, `netAmount`. No guarda nada. 400 `RATE_REQUIRED` si un renglón está en otra moneda que el depósito y falta `rate`. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/contracts/:id/move-out` | Crea o reemplaza el borrador (`{ date, rate?, items, notes? }`); los totales se recalculan en el servidor. 409 `MOVE_OUT_CONFIRMED` si ya está confirmada. Audita. | Admin, Gerente |
| GET | `/move-outs/:id` | La liquidación. 404 `MOVE_OUT_NOT_FOUND`. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/move-outs/:id/confirm` | Confirma una sola vez (`{ accountId?, method?, note?, lessorApproved? }`): devuelve el depósito desde la caja o la custodia (movimiento `Deposito`), aplica el depósito como pagos reales (método `AplicacionDeposito`, no se puede elegir en `POST /liquidaciones/:id/payments`) a las liquidaciones abiertas incluidas, de la más antigua a la más nueva y con su punitorio si alcanza, con el mismo camino que un cobro (recibo, reparto, caja y cuenta corriente del locador; `receivedBy` es la inmobiliaria o el locador según quién guarda el depósito), imputa los cargos y las boletas incluidos, deja el saldo a cargo del inquilino como cargo pendiente, marca el depósito `Devuelto` y tilda el paso `DEPOSITO` del seguimiento de devolución. Errores: 404 `MOVE_OUT_NOT_FOUND`, 409 `MOVE_OUT_ALREADY_CONFIRMED`, 409 `LESSOR_APPROVAL_REQUIRED`, 409 `CUSTODY_INSUFFICIENT`, 409 `LIQUIDACION_NOT_PAYABLE` (no está enviada ni vencida), 409 `LIQUIDACION_CURRENCY_MISMATCH`. Audita (`move-out-confirm`, con los pagos creados). | Admin, Gerente |
| GET | `/move-outs/:id/pdf` | PDF de la liquidación de egreso con los renglones incluidos, el resultado y el plazo y las cuotas de la devolución. | Admin, Gerente, Liquidaciones, Lectura |

Los valores por defecto (`operationalDefaults.deposits`) son quién guarda el depósito (`defaultHeldBy`, `Locador`), el plazo de devolución (`refundDueDays`, 30 días corridos) y si los descuentos y las reparaciones necesitan la conformidad del locador (`deductionsNeedLessorApproval`, `false`). Un contrato nuevo con `depositAmount` crea su depósito pendiente, en una cuota al inicio; `PATCH /contracts/:id` ya no acepta `depositAmount` ni `depositCurrency` (el depósito se cambia en `PUT /contracts/:id/deposit`). Convenciones: pesos actualizado sigue la evolución del alquiler del contrato (su propio índice) y no devuelve menos que el nominal; el depósito lo guarda por defecto el locador; la conformidad del locador está apagada; el plazo de devolución es de 30 días.

Las convenciones de ventas (`operationalDefaults.sales`) son los días de vigencia de una reserva (`reservationDays`, 7), quién guarda el dinero por defecto (`defaultDepositHolder`, `Inmobiliaria`) y si el boleto exige la documentación obligatoria (`requireDocsForBoleto`, `true`).

## Liquidaciones

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/liquidaciones` | Listado paginado y filtrable por estado y período. | Autenticado |
| GET | `/liquidaciones/:id` | Detalle con líneas (con `beneficiary` y `commissionable`), pagos (con su recibo y `receipt.label`, el número como se imprime), locadores y `receiptNumber` (nulo hasta aprobar). | Autenticado |
| GET | `/liquidaciones/:id/pdf` | Recibo en PDF: número, monto en letras, "por cuenta y orden de" los locadores vigentes y renglones agrupados por destino. | Autenticado |
| POST | `/liquidaciones/generate` | Genera las liquidaciones del período con las reglas y el alquiler vigentes en ese mes: respeta el inicio y el fin efectivo del contrato, el día de vencimiento y el prorrateo del primer y último mes, y suma como renglones las partes de boletas de servicios e impuestos sin facturar de cada contrato (a lo sumo hasta ese mes), con su destino y sin comisión. Devuelve `created`, `skipped`, `outOfRange`, `notBilled` (primeros meses que la convención del contrato manda cobrar al firmar o con el mes siguiente), `failed`, `total` y el resultado por contrato (`status` `created`, `skipped`, `out_of_range`, `not_billed` o `failed`, con su `reason`). | Admin, Gerente, Liquidaciones |
| POST | `/liquidaciones/_run-now` | Corre ahora el proceso diario de generación para todas las inmobiliarias; `today` (`YYYY-MM-DD`) opcional fija el día. Solo con `NODE_ENV=test` o `E2E_TEST_MODE=1`, como `/penalties/_run-now`; fuera de ese modo responde 403. | Admin |
| GET | `/liquidaciones/:id/payoff` | Monto a pagar en `date` (`YYYY-MM-DD`, por defecto hoy en Buenos Aires): `balance`, `penalty` (`accrued`, `waived`, `alreadyBilled`, `due`, `daysOverdue`, regla aplicada y, con tasa BNA, los días regidos por la tasa o por el piso) y `total`. No guarda nada. | Autenticado |
| POST | `/liquidaciones/:id/transition` | Cambia el estado. Ante un estado inválido devuelve las transiciones posibles. | Admin, Gerente, Liquidaciones |
| POST | `/liquidaciones/bulk-approve` | Aprueba en lote. | Admin, Gerente |
| POST | `/liquidaciones/bulk-send` | Envía en lote. | Admin, Gerente |
| POST | `/liquidaciones/:id/line-items` | Agrega una línea; `beneficiary` y `commissionable` son opcionales y, si faltan, rigen los del tipo. | Admin, Gerente, Liquidaciones |
| PATCH | `/liquidaciones/:id/line-items/:lineItemId` | Edita una línea. | Admin, Gerente, Liquidaciones |
| DELETE | `/liquidaciones/:id/line-items/:lineItemId` | Quita una línea. | Admin, Gerente, Liquidaciones |
| GET | `/liquidaciones/:id/payments` | Pagos imputados, con cuenta, compensaciones y recibo (`receipt.label`: el número como se imprime, igual que en `/receipts`). | Autenticado |
| POST | `/liquidaciones/:id/payments` | Registra un pago e imputa el saldo. Rechaza con `PAYMENT_EXCEEDS_BALANCE` un importe mayor al saldo. Con `settlePenalties: true` agrega a la liquidación un renglón Multa con los punitorios devengados a `paidAt` (sin lo condonado ni lo ya cobrado), marca esas filas como cobradas y, con `RentaPrimero`, exige que el pago cubra el total (400 `PAYOFF_REQUIRES_FULL_AMOUNT`, con `expectedAmount`); con `PunitorioPrimero` el pago puede ser parcial y cubre primero la Multa; la respuesta suma `penaltySettled`. Un pago tardío que salda la liquidación fija el devengo hasta su fecha. Caja y cobros (ADR-0012), opcionales: `receivedBy` (`Inmobiliaria` o `Locador`; sin valor, según el flujo de pago del contrato), `accountId` (cuenta de la inmobiliaria; sin ella, la caja o el banco de la moneda según el medio, creados al primer uso), `inCustody` (la parte de los locadores va a su custodia), `receivedByUserId` (por defecto quien registra) y `externalRef` (única por inmobiliaria, 409 `PAYMENT_EXTERNAL_REF_EXISTS`). En la misma transacción reparte el cobro (`settlement`), escribe los movimientos y, si cobró la inmobiliaria, emite el recibo numerado. La respuesta suma `registeredPayment` con `receivedBy`, `account`, `receipt` (`series`, `number` y `label`, el número como se imprime), `inCustody` y `settlement`. Con reparto, el cobro deja en la misma transacción los asientos de la cuenta corriente de cada locador (ADR-0009). | Admin, Gerente, Liquidaciones |
| DELETE | `/liquidaciones/:id` | Borra la liquidación. | Admin, Gerente |

## Pagos

El registro de un pago ocurre siempre contra su liquidación; este módulo es de
consulta agregada.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/payments` | Listado de pagos registrados. | Admin, Gerente, Liquidaciones, Lectura |
| GET | `/payments/debt` | Deuda pendiente y vencida de la cartera. | Admin, Gerente, Liquidaciones, Lectura |

## Caja y cobros

Cuentas de la inmobiliaria, libro de movimientos, custodia, compensaciones y recibos
de cobro (ADR-0012). Los importes son siempre positivos; el sentido lo da
`direction` (`In`/`Out`). Una cuenta tiene una sola moneda (`ARS`, `USD`, `EUR`) y no
hay conversión implícita.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/financial-accounts` | Cuentas (`kind`: `Caja`, `Banco`, `Custodia`) con `balance`, y `totals` por moneda: `agency` (caja y banco), `custody` y `total` (suma la custodia solo si `cash.custodyInAgencyBalance`). Filtros `kind`, `currency`, `ownerPersonId`, `includeInactive`. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/financial-accounts` | Alta: `kind`, `name`, `currency` y, solo en una custodia (obligatorio), `ownerPersonId`. Una custodia por locador y moneda (409 `ACCOUNT_EXISTS`). | Admin, Gerente |
| PATCH | `/financial-accounts/:id` | Cambia `name` o `isActive`; una cuenta con saldo no se desactiva (409 `ACCOUNT_HAS_BALANCE`). | Admin, Gerente |
| GET | `/cash-movements` | Libro paginado; filtros `accountId`, `category`, `contractId`, `from` y `to` (`YYYY-MM-DD`). Cada movimiento trae su cuenta y su contraparte. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/cash-movements` | Movimiento manual: `accountId` (caja o banco activos), `date`, `direction`, `amount`, `category` (`PagoEnte`, `PagoProveedor`, `Honorario`, `Gasto`, `ComisionEmpleado`, `Sena`), y opcionales `counterpartyId`, `contractId`, `note`. Toma la moneda de la cuenta. `PagoLocador` ya no es manual: lo escribe `POST /owners/:personId/payouts`. | Admin, Gerente, Liquidaciones |
| POST | `/cash-movements/conversion` | Conversión: `fromAccountId`, `toAccountId` (de distinta moneda), `date`, `amount` y `rate` (unidades de destino por unidad de origen, hasta 6 decimales). Escribe una salida y una entrada `Conversion` con el mismo `sourceId`; el importe de destino se redondea al centavo. Devuelve `{ out, in }`. | Admin, Gerente, Liquidaciones |
| POST | `/custody/:accountId/deliver` | Entrega al locador el efectivo en custodia: `date`, `amount` (sin él, todo el saldo) y `note`. Bloquea la cuenta hasta el commit y deja una `EntregaEfectivo` en la cuenta corriente del locador. Devuelve `{ movement, balance }`. | Admin, Gerente, Liquidaciones |
| GET | `/compensations` | Compensaciones de un cobro (`paymentId`) o de una persona (`personId`). | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/compensations` | Registra que `fromLessorId` recibió un cobro (`paymentId`, recibido por un locador) que le correspondía a `toLessorId` (locador del contrato). `amount` opcional (por defecto, lo que `to` figuraba cobrando en mano en el reparto, su parte más lo que debía por el cobro, menos lo ya compensado); `fromCustody: true` lo paga con la custodia de `from` y lo ingresa en `toAccountId` (por defecto, la caja de la moneda). `date` opcional (`YYYY-MM-DD`): fecha de los asientos y de la entrega de custodia; sin ella, los asientos van con la fecha del cobro y la entrega, con la de hoy. En la cuenta corriente resta a `from` y suma a `to` (`Compensacion`). | Admin, Gerente, Liquidaciones |
| GET | `/receipts` | Recibos de cobro paginados (`from`, `to`, `contractId`) con número, fecha, importe, inquilino, propiedad, medio y quién recibió; los de una cuota de honorarios traen `concept` y quien paga. | Admin, Gerente, Liquidaciones, Lectura |
| GET | `/receipts/:id/pdf` | PDF del recibo con su número, el monto en letras y "por cuenta y orden" de los locadores. | Admin, Gerente, Liquidaciones, Lectura |

- **Categorías** del libro: `AlquilerCobrado` (cobros), `Custodia` (entradas y entregas de custodia), `Compensacion`, `Conversion`, `PagoLocador` (las escribe el sistema) y las manuales de la tabla. Una cuenta de custodia no admite movimientos manuales ni conversiones (`CUSTODY_ACCOUNT_RESERVED`).
- **Recibos.** Serie `RECIBO_COBRO` (una por inmobiliaria por defecto; `cash.receiptSeries` permite una por moneda o por cuenta), numerada con `document_sequences` en la transacción del cobro; distinta de la del recibo de la liquidación (`RECIBO_LIQUIDACION`). Un cobro del locador no emite recibo salvo `cash.receiptWhenLessorReceives`.
- **Reparto guardado** (`payments.settlement`): `flow`, `buckets` (total, base y comisión, gastos, inmobiliaria, entes, locadores), `payment` (la parte de este cobro), `agencyCash`, `custodyTotal`, `enteHeldBy`, `positions` (por locador: `share`, `received`, `custody`, `balance`; positivo = la inmobiliaria le debe) y `compensations`. Si el reparto no se puede hacer y cobró la inmobiliaria sin custodia, el cobro se registra con `settlement: { error }`.

Códigos de error: `ACCOUNT_NOT_FOUND` (404), `ACCOUNT_INACTIVE` (409), `ACCOUNT_EXISTS` (409), `ACCOUNT_HAS_BALANCE` (409), `ACCOUNT_NOT_CUSTODY` (400), `CUSTODY_ACCOUNT_RESERVED` (400), `CUSTODY_EMPTY` (409), `CUSTODY_INSUFFICIENT` (409), `CURRENCY_MISMATCH` (400), `CONVERSION_SAME_CURRENCY` (400), `RECEIPT_NOT_FOUND` (404), `PAYMENT_NOT_FOUND` (404), `USER_NOT_FOUND` (404), `PAYMENT_EXTERNAL_REF_EXISTS` (409), y los del reparto (400): `SETTLEMENT_LESSOR_SHARES`, `SETTLEMENT_NEGATIVE_SHARE`, `SETTLEMENT_CURRENCY_MISMATCH`, `SETTLEMENT_INVALID_AMOUNT`, `COMPENSATION_REQUIRES_LESSOR_RECEIPT`, `COMPENSATION_SAME_LESSOR`, `COMPENSATION_OUT_OF_SCOPE`, `COMPENSATION_EXCEEDS_PAYMENT`.

## Morosidad y punitorios

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/penalties` | Punitorios calculados; `status` (`active`, `waived`) y `contractId` filtran. | Admin, Gerente |
| GET | `/penalties/delinquent-tenants` | Inquilinos con liquidaciones vencidas, con deuda y días de atraso. | Admin, Gerente |
| GET | `/penalties/delinquent-tenants/count` | Cantidad de casos, para el panel. | Admin, Gerente |
| POST | `/penalties/preview` | Simula el punitorio de una liquidación (`debt`, `daysOverdue`, `config`); con `max_bna_or_daily`, `bnaAnnualPct` fija la TNA de la simulación. | Admin, Gerente |
| POST | `/penalties/:id/waive` | Condona un punitorio; el cuerpo `{ reason }` es obligatorio y la condonación queda auditada. Errores: 404 `PENALTY_NOT_FOUND`, 409 `PENALTY_ALREADY_WAIVED`, 409 `PENALTY_ALREADY_SETTLED`. | Admin, Gerente |
| POST | `/contracts/:id/penalties/waive-all` | Condona los punitorios activos y sin cobrar del contrato hasta `upTo` (`YYYY-MM-DD`, por defecto hoy); `{ reason }` obligatorio. Responde `{ waived, total, upTo }` y deja una fila de auditoría. | Admin, Gerente |
| POST | `/penalties/run` | Dispara la corrida de cálculo. | Admin |
| GET | `/tenants/me/penalty-config` | Parámetros de punitorios de la inmobiliaria. | Admin, Gerente |
| PUT | `/tenants/me/penalty-config` | Actualiza esos parámetros: `mode` (`daily_fixed`, `daily_percent`, `compound_percent`, `max_bna_or_daily`), `value`, `graceDays`, `maxMultiplier` y, solo con `max_bna_or_daily`, `bnaMultiplier` (2), `yearDays` (365 o 360) y `bnaRateKind` (`Nominal` o `Efectiva`) y `missingRateBehavior` (`AplicarPiso` o `Bloquear`); en cualquier modo, `partialPaymentAllocation` (`RentaPrimero` o `PunitorioPrimero`), `roundingMode` (`Total` o `Diario`) y `capBase` (`SaldoInicioMora` o `TotalOriginal`); sin ellas rige el primer valor. Un contrato puede fijar la suya en `termsPatch.penaltyConfig`. | Admin |

Existe además `POST /penalties/_run-now`, que fuerza la corrida diaria sin
esperar al planificador. No declara roles, pero el propio manejador rechaza la
petición con 403 salvo que el servicio corra en modo de prueba: es una compuerta
para las pruebas de extremo a extremo, no un endpoint de operación.

## Cuenta corriente y estado de cuenta del locador

Asientos con signo por locador (positivo: la inmobiliaria le debe; negativo: se le
descuenta o ya lo recibió) y estado mensual consolidado por locador, mes y moneda
(ADR-0009). Las lecturas respetan la política de lectura del recurso `renditions`.
Conceptos (`type`): `SaldoInicial`, `Alquiler`, `Punitorio`, `ReintegroImpuesto`,
`Comision`, `Honorario`, `Cargo`, `PagoEnte`, `Transferencia`, `EntregaEfectivo`,
`CobroDirecto`, `Compensacion`, `Custodia`, `Ajuste`. Los asientos los escriben el
cobro, la compensación, la entrega de custodia, el pago al locador, la boleta
«Propietario» pagada por la inmobiliaria, los cargos al locador (al generar o emitir
el estado) y el saldo inicial; cada origen se asienta una sola vez por persona y
concepto.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/owners/balances` | Saldo de cada locador por moneda (`currency` filtra): `balance`, `custody` (efectivo en su custodia), `payoutDue` (lo que falta pagarle fuera de la custodia), `lastMovement` y `lastStatement` (último emitido: período, cierre, estado). Los locadores de algún contrato sin movimientos aparecen con saldo cero en ARS. | Admin, Gerente, Liquidaciones, Lectura |
| GET | `/owners/:personId/ledger` | Movimientos de una moneda (`currency`, por defecto `ARS`; `from` y `to` `YYYY-MM-DD`; `page`, `limit` hasta 200) del más viejo al más nuevo, cada uno con `balance` (saldo después del movimiento), unidad, origen y estado que lo bloquea. Devuelve `person`, `currency`, `currencies` (las monedas con movimientos), `opening` (saldo anterior a `from`), `closing`, `custody` y la página. 404 `PERSON_NOT_FOUND`. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/owners/:personId/opening-balance` | Saldo inicial por moneda: `currency`, `amount` (con signo; cero no deja asiento), `date` opcional (por defecto hoy) y `reason` (obligatorio). Crea o corrige el único `SaldoInicial` de esa moneda y deja la auditoría con el antes, el después y el motivo. 409 `OPENING_BALANCE_LOCKED` si ya está en un estado emitido. | Admin, Gerente |
| POST | `/owners/:personId/payouts` | Pago al locador: `accountId` (caja o banco activos; una custodia da 400 `CUSTODY_ACCOUNT_RESERVED`), `method` (`Transferencia` o `EntregaEfectivo`), `amount`, `date` y `note`. En una transacción escribe el egreso `PagoLocador` de la cuenta y el asiento negativo. Devuelve `{ movement, entry, person, balance }`. Puede dejar el saldo negativo. | Admin, Gerente, Liquidaciones |
| POST | `/owner-statements/generate` | `period` (`YYYY-MM`, en la URL o el cuerpo) y `personId` opcional. Arma o recalcula el borrador de cada locador y moneda con asientos sin emitir hasta ese mes o con saldo arrastrado; antes asienta los cargos al locador del mes (según `ownerAccounts.lessorChargeTiming`). Devuelve `{ period, created, updated, skipped: [{ personId, currency, reason }], chargesPosted }`; `reason` es `STATEMENT_ALREADY_ISSUED` o `STATEMENT_PERIOD_CLOSED`. | Admin, Gerente, Liquidaciones |
| GET | `/owner-statements` | Estados paginados con filtros `period`, `personId`, `status` (`Borrador`, `Emitido`, `Enviado`, `Anulado`) y `currency`: locador, período, moneda, estado y `opening`, `credits`, `debits`, `payouts`, `closing`. | Admin, Gerente, Liquidaciones, Lectura |
| GET | `/owner-statements/:id` | Detalle: el resumen, `from`/`to` del período, `totals` (con `initial`, los saldos iniciales del período), `custody` y `groups` (por unidad: `label`, créditos, débitos, pagos, neto y movimientos). Un borrador se recalcula al leerlo; con los cargos al emitir, los muestra con `provisional: true`. 404 `STATEMENT_NOT_FOUND`. | Admin, Gerente, Liquidaciones, Lectura |
| GET | `/owner-statements/:id/pdf` | PDF para imprimir o compartir (`estado-de-cuenta-<locador>-<YYYY-MM>-<moneda>.pdf`), con cómo se lee el saldo; un borrador lleva marca de agua. | Admin, Gerente, Liquidaciones, Lectura |
| POST | `/owner-statements/:id/issue` | Emite: recalcula y bloquea los asientos (`statementId`). 409 `STATEMENT_NOT_DRAFT`, 409 `STATEMENT_PERIOD_CLOSED` (ya hay uno emitido de ese mes o posterior), 409 `STATEMENT_CHANGED` (los asientos cambiaron mientras se emitía). | Admin, Gerente, Liquidaciones |
| POST | `/owner-statements/:id/annul` | Anula con `reason` obligatorio y libera los asientos. Solo el último emitido de cada locador y moneda (409 `STATEMENT_NOT_LATEST`); 409 `STATEMENT_ALREADY_ANNULLED`. Los cargos asentados no vuelven a pendiente. | Admin, Gerente |

Una boleta, un saldo inicial o cualquier origen cuyos asientos estén en un estado
emitido no se cambia hasta anular el estado: 409 `OWNER_LEDGER_LOCKED`. Un cargo al
locador ya imputado no se libera (`POST /charges/:id/release`, 409
`CHARGE_IN_STATEMENT`). Opciones de la inmobiliaria en `operationalDefaults.ownerAccounts`:
`statementCloseDay` (`null` = fin de mes, o 1 a 28) y `lessorChargeTiming`
(`AlGenerarEstado` o `AlEmitirEstado`).

## Honorarios

Honorarios por operación (D10): alta de alquiler, renovación, venta, tasación y
gestión de reparación. Un honorario es de **una** persona que paga; cuando pagan dos
(inquilino y locador, o comprador y vendedor) se crea uno por cada una con el mismo
`groupId`. Los importes salen del motor `fee-engine` de `packages/shared`: `netAmount`
(honorario sin IVA, lo que se reparte con el coorretaje y el personal), `vatAmount` y
`total` (lo que paga quien paga). Las cuotas son mensuales desde `firstDueDate` y
reparten el total por mayor residuo. Con `adjustInstallments`, el importe a cobrar de
cada cuota pendiente (`dueAmount`) sigue los ajustes aplicados al alquiler del
contrato: importe × alquiler a su vencimiento ÷ alquiler al inicio del tramo; al
cobrarla se guarda en `adjustedAmount`.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/fees/preview` | Propuesta con los valores por defecto de la inmobiliaria, sin guardar: `kind` y, según el caso, `contractId` o `contractPeriodId` (alta y renovación: base = total del contrato o del período según `fees.contractTotalMode`, porcentaje `fees.alta` o `fees.renovacion`, quién paga según `fees.payer` y `fees.lessorSharePct`), `propertyId`, `saleAsset` (`Construido`, `Lote`), `baseAmount` y `currency` (venta: `fees.ventaConstruido` o `fees.ventaLote` por parte, en dólares por defecto) o `valuationId` (tasación: `valuationUsd` dólares al titular de la propiedad). Devuelve base, porcentaje, moneda, quienes pagan con su parte, cuotas, ajuste, IVA, comisión del personal por defecto, `contractTotal` (meses, si proyectó ajustes, si la regla es por índice) y `estimate` (total por persona). | Admin, Gerente |
| POST | `/fees` | Alta: `kind`, `basis` (`TotalContrato`, `ValorOperacion`, `MontoFijo`), `baseAmount`, `pct` (salvo monto fijo), `currency`, `payers` (`role`: `Inquilino`, `Locador`, `Comprador`, `Vendedor`, `Otro`; `personId`; `sharePct`), `payerMode` (`Reparto`: el honorario se reparte y las partes suman 100; `CadaParte`: cada uno paga el porcentaje completo), `vatMode` (`NoAplica`, `Incluido`, `Adicional`) y `vatPct`, `installments` (1 a 60), `firstDueDate`, `adjustInstallments` (solo con contrato), `shares` (coorretaje: `counterparty`, `pct`) y `staff` (`userId` o `personId`, `pct`), y opcionales `contractId`, `contractPeriodId` (toma su contrato), `propertyId`, `valuationId`, `notes`. Un honorario de alquiler necesita contrato (400 `CONTRACT_REQUIRED`). Un total en cero queda `SinCargo` y sin cuotas. Devuelve `{ items }`. | Admin, Gerente |
| GET | `/fees` | Honorarios paginados con cuotas (`dueAmount`), coorretaje y comisiones; filtros `kind`, `status` (`Pendiente`, `Parcial`, `Pagado`, `SinCargo`, `Anulado`), `payerRole`, `payerPersonId`, `contractId`, `propertyId` y `period` (`YYYY-MM`: con alguna cuota que vence en el mes). | Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte |
| GET | `/fees/installments` | Cuotas paginadas por vencimiento con su `dueAmount` y su honorario; filtros `kind`, `status` (`Pendiente`, `Pagada`, `Anulada`), `payerRole`, `contractId` y `period`. | Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte |
| GET | `/fees/:id` | Un honorario. 404 `FEE_NOT_FOUND`. | Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte |
| PATCH | `/fees/:id` | Cambia `notes`. | Admin, Gerente |
| POST | `/fees/:id/cancel` | Anula con `reason` un honorario sin cuotas cobradas (409 `FEE_HAS_PAYMENTS`) ni comisiones pagadas (409 `FEE_HAS_PAID_COMMISSIONS`); las cuotas pendientes quedan `Anulada`. | Admin, Gerente |
| POST | `/fees/:id/installments/:n/pay` | Cobra la cuota `n`: `settlement` `Caja` (por defecto: entra a `accountId` o a la caja o el banco de la moneda según `method`, como movimiento `In` `Honorario` con origen `FeeInstallment`, y emite un recibo de la serie de cobros) o `CuentaLocador` (solo si paga un locador del contrato, 400 `FEE_PAYER_NOT_LESSOR`: asiento `Honorario` negativo en su cuenta corriente, sin caja ni recibo), `date`, y opcionales `amount` (por defecto el `dueAmount`) y `note`. Deja el honorario `Parcial` o `Pagado`. 409 `FEE_INSTALLMENT_NOT_PENDING` o `FEE_CANCELLED`. | Admin, Gerente, Liquidaciones |
| POST | `/fees/:id/shares` | Coorretaje: `counterparty`, `pct` (del honorario sin IVA). Recalcula las comisiones sin pagar. | Admin, Gerente |
| DELETE | `/fees/:id/shares/:shareId` | Quita un coorretaje y recalcula las comisiones sin pagar. | Admin, Gerente |
| POST | `/fees/:id/staff-commissions` | Comisión de una persona del personal: `userId` o `personId` (uno solo), `pct`. | Admin, Gerente |
| DELETE | `/fees/:id/staff-commissions/:commissionId` | Quita una comisión sin pagar (409 `STAFF_COMMISSION_PAID`). | Admin, Gerente |
| GET | `/staff-commissions` | Comisiones del personal de honorarios no anulados con su beneficiario y su honorario; filtros `paid` (`true`/`false`), `userId`, `personId`, `feeId`. | Admin, Gerente |
| POST | `/staff-commissions/:id/pay` | Paga la comisión desde `accountId` (caja o banco de la misma moneda, 400 `CURRENCY_MISMATCH`) en `date`: movimiento `Out` `ComisionEmpleado` con origen `StaffCommission`. 409 `STAFF_COMMISSION_PAID`. | Admin, Gerente |

- **Coorretaje y comisión del personal.** Cada parte de coorretaje es su porcentaje
  del honorario sin IVA. La comisión del personal es un porcentaje del neto de la
  inmobiliaria (honorario sin IVA menos coorretaje) o del honorario sin IVA, según
  `fees.staffCommissionBase` (`Neto` por defecto). Una comisión pagada no se
  recalcula.
- **Renovación.** `POST /contracts/:id/renew` con `fee` crea, en la misma
  transacción, un honorario `Renovacion` `MontoFijo` por ese importe sobre el período
  nuevo, a cargo de quien paga según `fees.payer` (400 `FEE_PAYER_NOT_FOUND` si el
  contrato no tiene a nadie), con las cuotas, el ajuste y el IVA por defecto desde el
  inicio del período.
- **Recibos y facturas.** Los recibos de honorarios comparten la serie de los cobros
  y aparecen en `GET /receipts` (con `concept`, quien paga y la propiedad; el filtro
  `contractId` los incluye) y en su PDF. `POST /invoices/emit` acepta
  `feeInstallmentId` para indicar la cuota que factura (404 `FEE_INSTALLMENT_NOT_FOUND`)
  y `GET /invoices` filtra por `feeInstallmentId`.

Códigos de error: `FEE_NOT_FOUND`, `FEE_INSTALLMENT_NOT_FOUND`, `FEE_SHARE_NOT_FOUND`,
`STAFF_COMMISSION_NOT_FOUND`, `CONTRACT_PERIOD_NOT_FOUND`, `VALUATION_NOT_FOUND`,
`USER_NOT_FOUND` (404); `CONTRACT_REQUIRED`, `PERIOD_CONTRACT_MISMATCH`,
`FEE_PAYER_NOT_LESSOR`, `PAYER_SHARES_NOT_100`, `INVALID_SHARES`,
`INVALID_STAFF_COMMISSION`, `INVALID_INSTALLMENTS`, `INVALID_TERM` (400);
`FEE_CANCELLED`, `FEE_HAS_PAYMENTS`, `FEE_HAS_PAID_COMMISSIONS`,
`FEE_INSTALLMENT_NOT_PENDING`, `STAFF_COMMISSION_PAID` (409).

## Ventas

Operaciones de venta (D14): de la captación a la escritura. La escritura **no se gestiona**:
queda como estado final (`Escriturada`) y su fecha. Una propiedad tiene a lo sumo una
operación abierta (409 `SALES_OPERATION_EXISTS`). Las rutas las escriben Admin, Gerente y
Ventas; las leen además Lectura. Devolver o retener una seña y pactar el honorario son solo
de Admin y Gerente. Cada alta y cada cambio de etapa, seña o documentación se audita.

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/sales-operations` | Embudo paginado. Filtros: `status`, `open=true|false`, `propertyId`, `personId`, `exclusive`, `page`, `limit`. Cada operación trae la propiedad, las partes, las reservas y señas (con `expired` y `unresolvedMoney`), la documentación, los honorarios, `docProgress`, `nextExpiry` y `validTransitions`. | Admin, Gerente, Ventas, Lectura |
| GET | `/sales-operations/:id` | Una operación. 404 `SALES_OPERATION_NOT_FOUND`. | Ídem |
| GET | `/properties/:propertyId/sales-operations` | La operación abierta (si hay) y el historial de la propiedad. | Ídem |
| POST | `/sales-operations` | Alta: `propertyId`, `status` (`Captacion` o `Publicada`), `exclusive`, `price`, `currency` (USD por defecto), `agentUserId`, `parties[]` (`role`, `personId`, `sharePct`; cada lado suma 100), `notes`. Crea la lista de documentación del inmueble. 404 `PROPERTY_NOT_FOUND`, `PERSON_NOT_FOUND`, `USER_NOT_FOUND`; 409 `SALES_OPERATION_EXISTS`. | Admin, Gerente, Ventas |
| PATCH | `/sales-operations/:id` | Exclusividad, `price`, `agreedPrice`, `currency`, responsable y notas, mientras la operación esté abierta (409 `SALES_OPERATION_CLOSED`). | Ídem |
| PUT | `/sales-operations/:id/parties` | Reemplaza compradores y vendedores. 400 si un lado no suma 100 o repite a una persona. | Ídem |
| PATCH | `/sales-operations/:id/docs/:code` | Tilda (`done`) o anota (`notes`) un renglón de la documentación. 404 `DOC_CHECK_NOT_FOUND`. | Ídem |
| POST | `/sales-operations/:id/transition` | Cambio de etapa: `to` y, según la etapa, `reason` (obligatorio al cancelar), `boletoDate`, `escrituraDate` (no futura), `agreedPrice`, `docsOverrideReason`. | Ídem |
| GET | `/sales-operations/deposits/pending` | Señas pendientes: pendientes de cobro, recibidas sin resolver y vencidas con dinero. Filtros `holder`, `status`. Trae `held`: el dinero recibido sin resolver por moneda y por quién lo guarda. | Admin, Gerente, Ventas, Lectura |
| POST | `/sales-operations/:id/deposits` | Alta de una reserva o seña: `kind`, `amount`, `currency` (la de la operación), `holder` (`Inmobiliaria`, `Vendedor` o `Escribano`; por defecto `sales.defaultDepositHolder`), `holderPersonId`, `payerPersonId`, `expiresAt` (una reserva sin fecha vence a los `sales.reservationDays`), `notes`. 409 `INVALID_STAGE_FOR_DEPOSIT`; 400 `EXPIRY_IN_PAST`. | Admin, Gerente, Ventas |
| PATCH | `/sales-operations/:id/deposits/:depositId` | Prorroga el vencimiento o cambia las notas de una reserva o seña viva. 400 `EXPIRY_REQUIRED`, `EXPIRY_IN_PAST`; 409 `DEPOSIT_CLOSED`. | Ídem |
| POST | `/sales-operations/:id/deposits/:depositId/receive` | El dinero entró (`receivedAt`, `method`, `accountId`, `note`). Si lo guarda la inmobiliaria escribe un movimiento de caja de categoría `Sena` (entrada, con el comprador de contraparte); si no, solo se anota. 409 `DEPOSIT_NOT_PENDING`, `DEPOSIT_EXPIRED`. | Ídem |
| POST | `/sales-operations/:id/deposits/:depositId/refund` | Devolución al comprador (`at`, `amount` hasta lo recibido, `method`, `note`). Si lo guarda la inmobiliaria sale un movimiento de caja `Sena` de la misma cuenta. Deja la seña `Devuelta`. 400 `REFUND_EXCEEDS_DEPOSIT`; 409 `NO_MONEY_TO_RESOLVE`. | Admin, Gerente |
| POST | `/sales-operations/:id/deposits/:depositId/forfeit` | Retención (`at`, `amount`, `note` obligatoria). **Solo se registra**: deja la seña `Retenida` y no mueve la caja. 400 `FORFEIT_EXCEEDS_DEPOSIT`; 409 `NO_MONEY_TO_RESOLVE`. | Admin, Gerente |
| GET | `/sales-operations/:id/fee-proposal` | Honorario sugerido: porcentaje por defecto según el tipo de inmueble (`fees.ventaConstruido`, 3 %; `fees.ventaLote`, 5 %), base (precio pactado o de publicación) y el pagador principal de cada lado. | Admin, Gerente |
| POST | `/sales-operations/:id/fee` | Crea el honorario de venta, uno por comprador y vendedor principal (cada parte paga el porcentaje), con `Fee.salesOpId` apuntando a la operación. Cuerpo opcional: `pct`, `baseAmount`, `installments`, `firstDueDate`, `payers[]`, `notes`. 409 `INVALID_STAGE_FOR_FEE`, `SALES_FEE_EXISTS`; 400 `PRICE_REQUIRED`, `PAYERS_REQUIRED`, `PAYER_NOT_PARTY`. El cobro sigue en `/fees`. | Admin, Gerente |

**Etapas.** `Captacion` → `Publicada` → `Reservada` → `SenaRecibida` → `Boleto` →
`Escriturada`; desde `Reservada` y `SenaRecibida` se vuelve a `Publicada`, y todas las
abiertas pueden pasar a `Cancelada`. Una transición no permitida da 400 `INVALID_TRANSITION`
con los destinos válidos. Reservar exige un comprador (409 `BUYER_REQUIRED`) y una reserva
viva (409 `RESERVATION_REQUIRED`); `SenaRecibida`, una seña recibida (409
`DEPOSIT_NOT_RECEIVED`); `Boleto`, `boletoDate` y la documentación obligatoria o
`docsOverrideReason` (409 `DOCS_PENDING`; la exigencia se apaga con
`sales.requireDocsForBoleto`); `Escriturada`, `escrituraDate` (400 `ESCRITURA_IN_FUTURE`). Volver a
`Publicada` o cancelar con dinero recibido sin resolver da 409 `DEPOSITS_UNRESOLVED`: primero
se registra la devolución o la retención. Al salir de la etapa las señas pendientes de cobro
pasan a `Vencida`; al escriturar las recibidas pasan a `Aplicada`.

**Vencimiento de reservas.** Un proceso diario (05:45, hora de Buenos Aires, por inmobiliaria) marca
`Vencida` a la reserva viva cuya fecha pasó y, si la operación estaba `Reservada` y no le queda
otra reserva o seña viva, la vuelve a `Publicada`. No devuelve ni retiene nada: el dinero ya
recibido sigue en las señas pendientes hasta resolverse. Es idempotente.

**Convenciones** (`operationalDefaults.sales`): `reservationDays` (7), `defaultDepositHolder`
(`Inmobiliaria`) y `requireDocsForBoleto` (`true`). Son conservadoras: el sistema registra y
nunca decide por su cuenta las reglas de pérdida de la seña, de devolución en doble ni de
quién se queda con el dinero.

## Llaves

Juegos de llaves por propiedad (D14). Siempre que un juego no está en la oficina tiene una
salida abierta; devolverlo la cierra. Cargan y mueven Admin, Gerente y Ventas; ven además
Soporte y Lectura.

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/properties/:propertyId/keys` | Juegos de la propiedad con quién los tiene, `openMovement`, `overdue`, `daysOverdue` y las últimas 20 salidas. | Admin, Gerente, Ventas, Soporte, Lectura |
| POST | `/properties/:propertyId/keys` | Alta de un juego: `label`, `copies`, `location`, `holder` (`Oficina` por defecto), `holderPersonId`, `holderUserId`, `holderName`, `notes`. Si nace fuera de la oficina queda con su salida abierta. | Admin, Gerente, Ventas |
| GET | `/keys/:id` | Un juego. 404 `KEY_SET_NOT_FOUND`. | Admin, Gerente, Ventas, Soporte, Lectura |
| PATCH | `/keys/:id` | Nombre, copias, lugar, notas o baja (`isActive`; 409 `KEY_SET_OUT` si está fuera). | Admin, Gerente, Ventas |
| POST | `/keys/:id/check-out` | Salida: `holder` (no `Oficina`), `holderPersonId`, `holderUserId` o `holderName`, `reason`, `outAt`, `expectedReturnAt`. 409 `KEY_ALREADY_OUT`, `KEY_SET_INACTIVE`; 400 `DATE_IN_FUTURE`, `RETURN_BEFORE_OUT`. | Ídem |
| POST | `/keys/:id/check-in` | Devolución: `returnedAt`, `location`, `notes`. El juego vuelve a la oficina. 409 `KEY_NOT_OUT`; 400 `DATE_IN_FUTURE`, `RETURN_BEFORE_OUT`. | Ídem |
| GET | `/keys/out` | «Llaves fuera»: salidas abiertas, las de fecha de vuelta más antigua primero, con `overdue` y `daysOverdue`. Filtros `holder`, `propertyId`, `overdue=true`, `page`, `limit`. | Admin, Gerente, Ventas, Soporte, Lectura |

## Rendiciones al propietario (histórico)

Las rendiciones por contrato quedan como histórico de solo lectura (ADR-0009): ya no
se generan, no cambian de estado, no se editan ni se envían. Se retiraron `POST
/renditions/generate`, `PATCH /renditions/:id/transition`, `POST
/renditions/:id/send`, `POST` y `DELETE /renditions/:id/line-items` y `PATCH
/renditions/:id/notes` (responden 404).

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/renditions` | Listado por propietario y período. | Autenticado |
| GET | `/renditions/:id` | Detalle con los conceptos discriminados. | Autenticado |
| GET | `/renditions/:id/pdf` | Rendición en PDF. | Autenticado |

## Facturación electrónica

Los roles de este módulo se resuelven con tres conjuntos: la emisión y la
administración de emisores son de Admin, Gerente y Liquidaciones; la lectura
alcanza a todos los roles salvo Marketing —es decir Admin, Gerente,
Liquidaciones, Ventas, Soporte y Lectura—; y el certificado es exclusivo de
Admin. En la tabla, esos seis roles de lectura figuran como **lectura**.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/invoices` | Listado de comprobantes. | Lectura |
| GET | `/invoices/:id` | Detalle con CAE y su vencimiento. | Lectura |
| GET | `/invoices/:id/pdf` | Comprobante en PDF. | Lectura |
| POST | `/invoices/preview` | Simula la emisión sin enviarla al organismo. | Admin, Gerente, Liquidaciones |
| POST | `/invoices/emit` | Emite una factura A, B o C. `paymentId` y `feeInstallmentId` (cuota de honorario que factura) son opcionales; la moneda sale de `monId` (`PES` o `DOL`). | Admin, Gerente, Liquidaciones |
| POST | `/invoices/emit-nc` | Emite una nota de crédito. | Admin, Gerente, Liquidaciones |
| POST | `/invoices/:id/void` | Anula un comprobante por nota de crédito. | Admin, Gerente, Liquidaciones |
| GET | `/invoices/healthcheck` | Estado de la conexión con los servicios del organismo. | Lectura |
| GET | `/invoices/padron/:cuit` | Consulta de padrón por CUIT. | Lectura |
| GET | `/invoices/param-cache/:type` | Tablas de parámetros en caché. | Lectura |
| GET | `/invoices/certificate` | Metadatos del certificado cargado. | Admin |
| POST | `/invoices/certificate` | Carga el certificado. La clave privada se guarda cifrada. | Admin |
| DELETE | `/invoices/certificate` | Borra el certificado. Responde 204. | Admin |
| GET | `/invoices/issuers` | Emisores dados de alta. | Lectura |
| POST | `/invoices/issuers` | Da de alta un emisor propio o delegado. | Admin, Gerente, Liquidaciones |
| PATCH | `/invoices/issuers/:id` | Edita un emisor. | Admin, Gerente, Liquidaciones |
| DELETE | `/invoices/issuers/:id` | Baja de un emisor. | Admin, Gerente, Liquidaciones |
| POST | `/invoices/issuers/:id/verify-delegation` | Verifica la delegación del emisor. | Admin, Gerente, Liquidaciones |
| POST | `/invoices/issuers/:id/sync-pdv` | Sincroniza los puntos de venta con el organismo. | Admin, Gerente, Liquidaciones |

### Facturación por cuenta del locador (ADR-0017)

La inmobiliaria factura el alquiler con la delegación de ARCA del locador (un emisor con `personId`), nunca a nombre propio. Qué se factura, cuándo y con qué IVA es configuración (`operationalDefaults.invoicing` y, por locador, `invoicingSettings`). Una cola por origen, locador y tipo evita que un fallo de ARCA rompa el cobro y que se facture dos veces. Los GET son de Admin, Gerente, Liquidaciones y Lectura.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/persons/:id/invoicing-settings` | Emisor delegado del locador (con su delegación y puntos de venta), lo que definió (`override`), los valores de la inmobiliaria (`agencyDefaults`), lo que rige (`effective`) y desde cuándo factura solo (`autoSince`). | Lectura |
| PUT | `/persons/:id/invoicing-settings` | Define `scope` (`Alquiler`, `AlquilerPunitorios`, `TodoLocador`), `when` (`Manual`, `AlPagar`, `AlEmitirEstado`) y `vatPct` (0, 2.5, 5, 10.5, 21 o 27, IVA incluido); `null` vuelve a lo de la inmobiliaria. 409 `LESSOR_ISSUER_REQUIRED` sin emisor. | Admin, Gerente |
| POST | `/persons/:id/invoicing-issuer` | Da de alta (o reactiva) el emisor delegado con el CUIT, el nombre y la condición de la persona; admite `ingresosBrutos`, `activityStartDate` y `businessAddress`. 400 `PERSON_CUIT_REQUIRED`, `PERSON_FISCAL_CONDITION_REQUIRED` o `FISCAL_CONDITION_CANNOT_INVOICE`; 409 `LESSOR_ISSUER_EXISTS`. La delegación se verifica y los puntos de venta se traen con las rutas de emisores. | Admin, Gerente |
| GET | `/payments/:id/invoices` | Comprobantes y trabajos de facturación de un cobro. | Lectura |
| POST | `/payments/:id/invoices` | Factura el cobro por cuenta de cada locador con emisor delegado (o del `personId` indicado): una factura por contrato, al inquilino, por la parte del locador. Idempotente. 409 `INVOICING_TRIGGER_MISMATCH` si el locador factura al emitir el estado; 422 `LESSOR_INVOICE_FAILED` con el motivo si falla (el cobro no cambia y el trabajo queda `Fallido`). | Admin, Gerente, Liquidaciones |
| GET | `/owner-statements/:id/invoices` | Comprobantes y trabajos de un estado de cuenta. | Lectura |
| POST | `/owner-statements/:id/invoices` | Factura un estado emitido por cuenta de su locador. 409 `STATEMENT_NOT_ISSUED` o `INVOICING_TRIGGER_MISMATCH`; 422 si falla. | Admin, Gerente, Liquidaciones |
| GET | `/invoices/pending` | Cola de emisión: `status` (`Pendiente`, `Fallido`, `Emitido`, `Omitido`; por defecto pendientes y fallidos), `personId`, `page`, `limit`. | Lectura |
| POST | `/invoices/pending/run` | Pone en cola lo que la configuración manda facturar solo (cobros o estados nuevos de locadores con delegación activa, desde que se activó y hasta 60 días atrás) y emite lo pendiente. `retryAll: true` reintenta también los que agotaron los 5 intentos automáticos; `personId` limita a un locador. Responde `enqueued`, `processed`, `emitted`, `skipped`, `failed` y `results`. Un proceso lo corre solo cada 30 minutos. | Admin, Gerente, Liquidaciones |

El listado `GET /invoices` admite `personId` (locador por cuyo emisor se emitió), `source` (`Payment`, `OwnerStatement` o `FeeInstallment`) y `ownerStatementId`. Anular un estado de cuenta deja en cola la nota de crédito de sus facturas (`creditNotes` en la respuesta de `annul`), que se emite con la cola.
| GET | `/invoices/issuers/:id/pdv` | Puntos de venta del emisor. | Lectura |
| POST | `/invoices/issuers/:id/pdv` | Agrega un punto de venta. | Admin, Gerente, Liquidaciones |
| DELETE | `/invoices/pdv/:id` | Quita un punto de venta. | Admin, Gerente, Liquidaciones |

## CRM

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/leads` | Listado paginado y filtrable. | Autenticado |
| GET | `/leads/:id` | Detalle. | Autenticado |
| POST | `/leads` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/leads/:id` | Edición. | Admin, Gerente, Ventas |
| PATCH | `/leads/:id/stage` | Mueve el lead a otra etapa. | Admin, Gerente, Ventas |
| PATCH | `/leads/:id/assign` | Asigna un responsable. | Admin, Gerente, Ventas |
| POST | `/leads/:id/convert` | Convierte el lead en persona. | Admin, Gerente, Ventas |
| POST | `/leads/:id/lose` | Descarta el lead con motivo. | Admin, Gerente, Ventas |
| DELETE | `/leads/:id` | Borra el lead. | Admin, Gerente, Ventas |
| GET | `/leads/:leadId/interactions` | Historial de interacciones. | Autenticado |
| POST | `/leads/:leadId/interactions` | Registra una llamada, un correo o un mensaje. | Admin, Gerente, Ventas |
| GET | `/leads/:leadId/visits` | Visitas agendadas. | Autenticado |
| POST | `/leads/:leadId/visits` | Agenda una visita. | Admin, Gerente, Ventas |
| PATCH | `/leads/:leadId/visits/:visitId` | Actualiza una visita. | Admin, Gerente, Ventas |
| POST | `/leads/:leadId/send-email` | Envía un correo al lead a partir de una plantilla. | Admin, Gerente, Ventas, Marketing |

### Embudos

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/pipelines` | Embudos configurados. | Autenticado |
| GET | `/pipelines/:id` | Detalle con sus etapas. | Autenticado |
| POST | `/pipelines` | Crea un embudo. | Admin, Gerente |
| PATCH | `/pipelines/:id` | Edita un embudo. | Admin, Gerente |
| DELETE | `/pipelines/:id` | Borra un embudo. | Admin, Gerente |
| POST | `/pipelines/:id/stages` | Agrega una etapa. | Admin, Gerente |
| PATCH | `/pipelines/:pipelineId/stages/reorder` | Reordena las etapas. | Admin, Gerente |
| PATCH | `/pipelines/:pipelineId/stages/:stageId` | Edita una etapa. | Admin, Gerente |
| DELETE | `/pipelines/:pipelineId/stages/:stageId` | Quita una etapa. | Admin, Gerente |

## Tickets

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/tickets` | Listado paginado y filtrable. | Autenticado |
| GET | `/tickets/:id` | Detalle. | Autenticado |
| POST | `/tickets` | Abre un ticket. | Admin, Gerente, Soporte |
| PATCH | `/tickets/:id` | Edita el ticket y su responsable. | Admin, Gerente, Soporte |
| POST | `/tickets/:id/transition` | Cambia el estado según la máquina de estados; un ticket con pagos al proveedor no se cancela (409 `TICKET_HAS_PAYMENTS`). | Admin, Gerente, Soporte |
| POST | `/tickets/:id/assign-provider` | Asigna un proveedor. | Admin, Gerente, Soporte |
| PATCH | `/tickets/:id/cost` | Carga el costo del trabajo; `costPayer` es `Inquilino`, `Locador`, `Inmobiliaria` o null (otro texto da 400). | Admin, Gerente, Soporte |
| POST | `/tickets/:id/estimate` | Anota el costo estimado (`amount`, `currency`). Si supera el límite (el pactado en la versión de reglas vigente del contrato, `repairPreauthLimitAmount` y su moneda, y sin él el de la inmobiliaria `repairs.preauthLimit`, en pesos; un estimado en otra moneda que el límite siempre se consulta) o el tope ya autorizado para el caso, y el caso no empezó, pasa a `PendienteAutorizacion`. Devuelve `{ ticket, requiresAuthorization, limit, limitCurrency, limitSource }` (`Contrato` o `Inmobiliaria`). 409 `TICKET_NOT_ESTIMABLE` si ya empezó. | Admin, Gerente, Soporte |
| POST | `/tickets/:id/preauthorize` | Registra la preautorización del locador (`amount` tope, `approvedByPersonId`, `channel`, `note`) y pasa a `Presupuestado`. 409 `TICKET_NOT_AWAITING_AUTHORIZATION`. | Admin, Gerente, Soporte |
| GET | `/tickets/:id/quotes` | Presupuestos del ticket, en orden de carga. | Autenticado |
| POST | `/tickets/:id/quotes` | Carga un presupuesto (`providerId`, `amount`, `currency`, `documentUrl`, `notes`); el primero pasa el caso a `Presupuestado`. 409 `TICKET_NEEDS_AUTHORIZATION` si espera la autorización, `TICKET_NOT_QUOTABLE` si ya se trabaja. | Admin, Gerente, Soporte |
| PATCH | `/tickets/:id/quotes/:quoteId` | Corrige un presupuesto pendiente. | Admin, Gerente, Soporte |
| DELETE | `/tickets/:id/quotes/:quoteId` | Quita un presupuesto pendiente. | Admin, Gerente, Soporte |
| POST | `/tickets/:id/quotes/:quoteId/reject` | Descarta un presupuesto pendiente (queda en el historial). | Admin, Gerente, Soporte |
| POST | `/tickets/:id/quotes/:quoteId/approve` | Aprueba el presupuesto: `approvedByPersonId` y `channel` (`WhatsApp`, `Telefono`, `Mail`, `Presencial`) son obligatorios; queda auditado (`ticket-quote-approve`). Los demás pendientes pasan a `Rechazado` y el ticket a `PresupuestoAprobado` con el proveedor y el importe aprobados. 409 `QUOTE_NOT_PENDING`, `TICKET_NOT_QUOTING`. | Admin, Gerente, Soporte |
| GET | `/tickets/:id/provider-payments` | Pagos al proveedor (movimientos `PagoProveedor` con origen en el ticket) y su total. | Autenticado |
| POST | `/tickets/:id/provider-payments` | Paga al proveedor desde una cuenta de la inmobiliaria (`accountId`, `amount`, `date`, `note`): un movimiento `Out` `PagoProveedor` con el proveedor como contraparte. Desde `PresupuestoAprobado` en adelante y mientras no esté imputado; no supera lo aprobado (409 `PAYMENT_EXCEEDS_APPROVED`); la cuenta es de la moneda del trabajo (400 `CURRENCY_MISMATCH`) y no de custodia (400 `CUSTODY_ACCOUNT_RESERVED`). | Admin, Gerente, Liquidaciones |
| POST | `/tickets/:id/impute` | Imputa lo pagado a quien lo soporta, **una sola vez**: `chargedTo` (por defecto el `costPayer` del ticket; 400 `PAYER_REQUIRED`), `targetPeriod` y `managementFee` (`mode` `None`, `Percent` con `pct` o `Fixed` con `amount`). Crea el cargo `Reparacion` (origen `Ticket`, beneficiario la inmobiliaria): al inquilino queda para su próxima liquidación, al locador para su estado y a la inmobiliaria nace `Imputado` (el pago ya es su gasto en la caja). Con honorario, otro cargo `HonorarioGestion` (no se admite si paga la inmobiliaria, 400 `FEE_NOT_APPLICABLE`). El porcentaje, si no se indica, es el del contrato (`ContractCommission.repairMgmtFeePct`) y, sin él, el de la inmobiliaria (`repairs.managementFeePct`, de fábrica 0); sin IVA. Si paga el locador y el contrato pacta el porcentaje, lo asienta el estado del locador al descontar la reparación: no se crea otro cargo (`feeCharge` null, `feeAppliedByStatement` con el porcentaje) y pedir un honorario propio da 400 `FEE_SET_BY_CONTRACT`. Devuelve `{ ticket, charge, feeCharge, total, currency }`. 409 `TICKET_ALREADY_IMPUTED`, `TICKET_NOT_IMPUTABLE`, `NO_PROVIDER_PAYMENTS`; 400 `CONTRACT_REQUIRED` si paga el inquilino y el ticket no tiene contrato. | Admin, Gerente, Liquidaciones |
| GET | `/tickets/:id/comments` | Comentarios y adjuntos. | Autenticado |
| POST | `/tickets/:id/comments` | Comenta, con archivo adjunto opcional. | Admin, Gerente, Soporte |
| GET | `/ticket-categories` | Categorías de ticket. | Autenticado |
| POST | `/ticket-categories` | Crea una categoría. | Admin, Gerente |
| PATCH | `/ticket-categories/:id` | Edita una categoría. | Admin, Gerente |
| DELETE | `/ticket-categories/:id` | Borra una categoría. | Admin, Gerente |

## Puntaje de inquilinos

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/scoring/config` | Pesos de los componentes del puntaje. | Admin, Gerente |
| PATCH | `/scoring/config` | Actualiza los pesos. | Admin, Gerente |
| GET | `/scoring/persons/:personId` | Puntaje de una persona. | Admin, Gerente |
| PUT | `/scoring/persons/:personId` | Recalcula y guarda el puntaje. El total se computa siempre en el servidor. | Admin, Gerente |

## Panel

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/dashboard/stats` | Métricas generales de la cartera. | Autenticado |
| GET | `/dashboard/occupancy-trend` | Ocupación de los últimos doce meses. | Admin, Gerente |
| GET | `/dashboard/profitability` | Rentabilidad por propiedad. | Admin, Gerente |
| GET | `/dashboard/cash-flow` | Flujo de caja. | Admin, Gerente, Liquidaciones |
| GET | `/dashboard/delinquency-rate` | Tasa de morosidad. | Admin, Gerente, Liquidaciones |
| GET | `/dashboard/fiscal` | Indicadores de facturación electrónica. | Admin, Gerente |

## Reportes

El parámetro `:type` acepta `ownerStatement`, `propertyProfitability`,
`cashFlow`, `commissionSummary`, `pipelineAnalytics` y `morosidad`; cualquier
otro valor devuelve 400. `ownerStatement`, `commissionSummary` y los egresos de
`cashFlow` leen la cuenta corriente del locador; las rendiciones históricas siguen
sumando, con «(rendición histórica)» en la propiedad.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/reports/:type` | Reporte en JSON. | Admin, Gerente, Liquidaciones |
| GET | `/reports/:type/excel` | El mismo reporte en Excel. | Admin, Gerente, Liquidaciones |
| GET | `/reports/:type/pdf` | El mismo reporte en PDF. | Admin, Gerente, Liquidaciones |
| GET | `/report-schedules` | Envíos programados. | Admin, Gerente |
| POST | `/report-schedules` | Programa un envío periódico. | Admin, Gerente |
| PATCH | `/report-schedules/:id` | Edita un envío programado. | Admin, Gerente |
| DELETE | `/report-schedules/:id` | Borra un envío programado. | Admin, Gerente |

## Importación y exportación

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| POST | `/import/upload` | Sube el archivo y devuelve las columnas detectadas. Multipart, campo `file`. | Admin, Gerente |
| POST | `/import/validate` | Valida fila por fila con el mapeo de columnas elegido. | Admin, Gerente |
| POST | `/import/execute` | Confirma la importación de las filas válidas. | Admin, Gerente |
| POST | `/import/batches` | Importa o ensaya (`dryRun`) un lote JSON de `persons`, `properties` y `contracts` con upsert por `externalRef`. Devuelve el lote con el registro de cada fila. | Admin |
| GET | `/import/batches` | Lotes de la inmobiliaria, del más reciente al más antiguo (`limit`, hasta 200). | Admin |
| GET | `/import/batches/:id` | Un lote con su estado y sus totales por entidad. 404 si es de otra inmobiliaria. | Admin |
| GET | `/import/batches/:id/rows` | Registro por fila. Filtros `action` (`Creado`, `Actualizado`, `SinCambios`, `Error`) y `entity`; `limit` (500 por defecto, hasta 5000) y `offset`. Responde `{ data, total }`. | Admin |
| GET | `/import/batches/:id/rows/csv` | El mismo registro como CSV, una línea por error, con los mismos filtros. | Admin |
| GET | `/properties/export/csv` | Exporta propiedades a CSV. | Admin, Gerente, Ventas |
| GET | `/properties/export/excel` | Exporta propiedades a Excel. | Admin, Gerente, Ventas |
| GET | `/persons/export/csv` | Exporta personas a CSV. | Admin, Gerente, Ventas |
| GET | `/persons/export/excel` | Exporta personas a Excel. | Admin, Gerente, Ventas |

### Lotes de importación desde el sistema anterior

`POST /import/batches` es la API que usan los scripts de migración (ADR-0015; el procedimiento está en `tesis/32-migracion.md`). El cuerpo es JSON de hasta 25 MB:

```json
{ "dryRun": true, "atomic": false, "kind": "SistemaAnterior",
  "persons": [], "properties": [], "contracts": [] }
```

- `dryRun` es obligatorio. Con `true` el lote corre entero y se deshace: las acciones devueltas son las que haría la ejecución. `atomic` (por defecto `false`) hace todo o nada: con una fila con error no se escribe nada y el lote queda `Fallido`. Sin `atomic`, cada fila va en su transacción y una con error no frena a las demás.
- Un cuerpo mal formado (campo desconocido, `dryRun` ausente, un arreglo que no es arreglo) responde 400 `VALIDATION_ERROR`. Cada fila se valida por separado: su error queda en el registro de la fila y la respuesta es 201.
- Se procesan en este orden: personas, propiedades (los edificios antes que sus unidades) y contratos. Las referencias entre filas (`personExternalRef`, `propertyExternalRef`, `parentExternalRef`...) se resuelven por `externalRef` dentro de la inmobiliaria, y pueden apuntar a filas del mismo lote o de uno anterior.
- Idempotencia: la fila se busca por `[tenantId, externalRef]`. Los mismos datos dan `SinCambios`; un campo distinto, `Actualizado`. Lo que la fila no informa no se toca; los conjuntos hijos que informa (`owners`, `tenants`, `guarantors`, `lessors`) se reemplazan completos si difieren; `bankAccounts` y `adjustmentsHistory` se agregan y corrigen sin borrar.
- Respuesta: `{ id, status, dryRun, atomic, counts: { total, errors, byEntity }, rows: [{ entity, rowNumber, externalRef, action, entityId, errors }] }`.

**Persona** (`persons[]`). Obligatorio: `externalRef` y, según `personType` (`Fisica` por defecto), `firstName` o `businessName` (`Juridica`). Opcionales: `lastName`, `dni`, `cuit` (con dígito verificador), `fiscalCondition`, `email`, `phone`, `phone2`, `address`, `maritalStatus`, `nationality`, `payoutMethod`, `notes`, `roles[]` (se aseguran, no se quitan) y `bankAccounts[]` (`currency` por defecto `ARS`, `bank`, `cbu` de 22 dígitos, `alias`, `holder`, `isDefault`; se necesita `cbu` o `alias`). La cuenta se identifica por su CBU (o por su alias si no tiene).

**Propiedad** (`properties[]`). Obligatorio: `externalRef` y `type`. Opcionales: `title` (si falta se arma con la dirección o, al crear, con la referencia), `street`, `number`, `floor`, `unit` (se guarda como departamento), `city`, `province`, `zipCode`, `cadastralId`, `parentExternalRef` (el edificio) y `owners[]` (`personExternalRef`, `sharePct` de 0 a 100) como titularidad.

**Contrato** (`contracts[]`). Obligatorio: `externalRef`, `propertyExternalRef`, `status` (`Borrador`, `Activo`, `Vencido`, `Rescindido`, `Renovado`, `Archivado`), `startDate`, `endDate` (`YYYY-MM-DD` o ISO), `rentAmount` (el vigente) y `terms` con `adjustmentType` y `adjustmentPeriod`. Opcionales: `contractType` (`Alquiler`), `actualEndDate`, `currency` (`ARS`), `initialRent`, `depositAmount`, `notes`, `tenants[]` y `guarantors[]` (referencias de personas), `lessors[]` (`personExternalRef`, `payoutPct`, `capacity`, `payeeExternalRef`, `bankAccountCbu`, `needsReview`), `terms.adjustmentBase`, `terms.indexLagMonths` (al crear, el de la inmobiliaria; al actualizar, el guardado), `terms.fixedInitialMonths`, `terms.dueDay`, `terms.paymentFlow`, `terms.customPct`, `commission` (`type`, `percentage`, `fixedAmount`, `adminFee`), `adjustmentsHistory[]` (`periodNumber`, `appliedAt`, `previousAmount`, `newAmount`, `factor`) y `selfManaged` (cobra directo el locador, flujo `TodoLocador` y sólo la comisión inicial como importe fijo). Un contrato `Activo` exige locadores que sumen 100 %, un inquilino (si es de alquiler) y ningún otro activo superpuesto en la propiedad; al importarlo la operación de alquiler de la propiedad queda `Alquilado`, sin enviar avisos.

Códigos de error por fila (`errors[].code`): `VALIDATION_ERROR`, `REFERENCE_NOT_FOUND`, `DUPLICATE_IN_BATCH`, `DUPLICATE_KEY`, `INVALID_DATES`, `LESSOR_SHARES_INVALID`, `MISSING_INQUILINO`, `OVERLAPPING_ACTIVE_CONTRACT`, `ADJUSTMENT_HISTORY_INVALID`, `RENT_MISMATCH`, `PROPERTY_STATE_CONFLICT` e `INTERNAL_ERROR`.

### Calidad de datos

Detecta lo que conviene corregir después de una migración (`tesis/32-migracion.md`). Cada control es una función pura sobre filas leídas por inmobiliaria; nada se guarda ni se marca como resuelto.

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| GET | `/data-quality` | Cantidad de hallazgos por control: `{ generatedAt, total, checks: [{ check, group, severity, count }] }`. | Admin, Gerente |
| GET | `/data-quality/:check` | Hallazgos de un control, paginados (`page`, `limit` hasta 200, por defecto 25). 400 `UNKNOWN_CHECK` si el control no existe. | Admin, Gerente |
| POST | `/data-quality/persons/merge/preview` | Qué se movería y qué se descartaría al unir `{ keepId, mergeIds }`, con las mismas reglas que la unión y sin cambiar nada. | Admin, Gerente |
| POST | `/data-quality/persons/merge` | Une personas repetidas en `keepId`. Transaccional y auditada (antes y después de cada persona). | Admin |

Controles (`check`): `duplicate-cuit`, `duplicate-dni`, `duplicate-cbu`, `duplicate-phone`, `duplicate-email`, `duplicate-name`, `lessors-sum`, `ownership-sum`, `property-no-owner`, `owner-no-bank-account`, `lessor-no-tax-id`, `contract-expired-undecided`, `contract-essentials`.

Cada hallazgo es `{ id, check, severity: 'error' | 'warning', entityType, entityId, label, fields, link, members?, details? }`. `link` es la ruta de la web donde se corrige; en los duplicados, `members` trae todas las personas del grupo y `details` el valor repetido normalizado.

Normalización para comparar (la clave no se guarda): CUIT y CBU, sólo dígitos (11 y 22); DNI sin puntos ni ceros a la izquierda, o el que lleva el CUIL de una persona física (prefijo 20, 23, 24 o 27); correo en minúsculas y sin espacios; nombre sin tildes, signos ni mayúsculas y con las palabras ordenadas (coincidencia exacta del normalizado: no hay búsqueda por parecido porque la base no tiene `pg_trgm`); teléfono a sus 10 dígitos nacionales: se sacan el `00`, el `54` del país, el `0` de discado, el `9` de celular que sigue al `54` y el `15` que sigue al código de área (2, 3 o 4 dígitos). Dos personas con el mismo nombre pero CUIT o DNI distintos no se agrupan. Un número sin área no se compara con uno que la tiene.

Unión de personas: `{ keepId, mergeIds[1..10] }` (UUID, sin repetir ni incluir a `keepId`). Las referencias a la persona (contratos, locadores y apoderados de cobro, titularidades, cuentas, documentos, roles, poderes, consultas, cargos pendientes, reclamos y sus comentarios, sesiones e invitaciones del portal, rendiciones, movimientos de caja, compensaciones, custodias, cuenta corriente y estados de cuenta) pasan a `keepId`; las filas con clave única que ya existen en la conservada (un rol, una parte del mismo contrato y rol, una cuenta con el mismo CBU) se descartan. Las unidas quedan con `isActive` falso, sin CUIT y con una nota. Respuestas: 201 con `{ keepId, mergeIds, items, discarded, merged }`; 404 `PERSON_NOT_FOUND`; 409 `MERGE_CONFLICT` con `conflicts: [{ entity, field, count }]` si una persona está dada de baja, si las dos tienen una fila que no se puede combinar (perfil de proveedor, acceso al portal, puntaje de inquilino, rendición del mismo contrato y período, custodia de la misma moneda, asiento de cuenta corriente del mismo origen y concepto, estado de cuenta del mismo mes y moneda) o si hay un poder entre ellas.

## Plantillas de correo

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/email-templates` | Listado. | Admin, Gerente, Marketing |
| GET | `/email-templates/:id` | Detalle. | Admin, Gerente, Marketing |
| POST | `/email-templates` | Alta. | Admin, Gerente, Marketing |
| PATCH | `/email-templates/:id` | Edición. | Admin, Gerente, Marketing |
| DELETE | `/email-templates/:id` | Baja. | Admin, Gerente, Marketing |
| POST | `/email-templates/:id/preview` | Previsualiza la plantilla con datos reales. | Admin, Gerente, Ventas, Marketing |

## Mensajería

Mensajes salientes por mail y WhatsApp a través de la bandeja de salida
(ADR-0013). Ninguna operación manda un mensaje en el momento: lo encola con una
clave de idempotencia (`<tipo>:<id>:<canal>`) y un proceso programado lo despacha
cada minuto según el modo del ambiente (`MESSAGING_MODE`: `off` por defecto,
`allowlist` o `live`), el consentimiento y el horario permitido
(`operationalDefaults.messaging`, por defecto `{ fromHour: 9, untilHour: 20 }`
en hora de Buenos Aires, solo para los mensajes a la cartera). Encolan mensajes:
la liquidación al pasar a `Enviada` (mail al inquilino), las invitaciones de
usuarios, los avisos al personal de los procesos diarios (mail), los cambios de
estado y comentarios del personal en un ticket del portal (al inquilino, por
WhatsApp si dio el alta o si no por mail) y `POST /outbox/send`.

Estados (`status`): `Pending`, `Sending`, `Sent`, `Delivered`, `Read`, `Failed`,
`Blocked`, `Cancelled`. `statusReason` dice por qué uno sigue pendiente o quedó
bloqueado: `MESSAGING_OFF`, `PROVIDER_NOT_CONFIGURED`, `QUIET_HOURS`,
`NOT_IN_ALLOWLIST`, `OPTED_OUT`, `NO_OPT_IN`. `error` trae el rechazo del
proveedor de un `Failed` (`ATTACHMENT_UNAVAILABLE: …` si el PDF ya no se puede
generar; `INTERRUPTED: …` si el despacho se cortó mientras lo mandaba). Las
variables con secretos (el enlace de una invitación) se devuelven como
`[oculto]`.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/outbox` | Bandeja de salida paginada, del más nuevo al más viejo, con filtros `status`, `channel`, `personId`, `relatedType` (`Receipt`, `OwnerStatement`, `Liquidacion`, `UserInvitation`, `Notification`, `Ticket`, `TicketComment`) y `relatedId`. Cada mensaje: canal, persona, dirección, plantilla, variables, estado, motivo, error, intentos, próximo intento y fechas. | Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte |
| POST | `/outbox/send` | Manda un documento a su destinatario: `{ kind: 'Receipt' \| 'OwnerStatement', id, channel: 'Email' \| 'WhatsApp' }`. Un recibo va al inquilino del contrato o a quien pagó el honorario; un estado de cuenta, al locador, solo emitido (400 `OWNER_STATEMENT_NOT_ISSUED`). Pedirlo dos veces devuelve el mismo mensaje. 400 `NO_CONTACT_ADDRESS` (la persona no tiene mail o celular válido), `NO_RECIPIENT`; 404 `RECEIPT_NOT_FOUND`, `OWNER_STATEMENT_NOT_FOUND`. El estado de cuenta pasa a `Enviado` cuando el mensaje sale. | Admin, Gerente, Liquidaciones |
| POST | `/outbox/:id/retry` | Vuelve a encolar un `Failed`, `Blocked` o `Cancelled` desde cero (se revisan otra vez el modo, el consentimiento y el horario). 400 `MESSAGE_NOT_RETRYABLE`; 400 `MESSAGE_EXPIRED` si llevaba un enlace de un solo uso ya borrado (se reenvía la invitación). | Admin, Gerente |
| POST | `/outbox/:id/cancel` | Cancela un `Pending` o `Blocked`. 400 `MESSAGE_NOT_CANCELLABLE` si ya salió o el despacho lo está mandando. | Admin, Gerente |
| POST | `/outbox/_run-now` | Una vuelta del despacho para la inmobiliaria del pedido. Solo con `NODE_ENV=test` o `E2E_TEST_MODE=1`. | Admin |
| GET | `/messaging/settings` | Modo del ambiente, cantidad de direcciones permitidas, proveedores (`configured`, remitente, webhook configurado), horario permitido y catálogo de plantillas (canales, destinatarios, plantilla de WhatsApp y su texto propuesto). Nunca devuelve credenciales. | Admin, Gerente |

**Webhooks** (públicos, sin sesión; el pedido se rechaza con 401
`INVALID_SIGNATURE` si la firma no coincide, y sin el secreto configurado se
rechaza todo):

| Método | Ruta | Para qué |
|---|---|---|
| GET | `/webhooks/whatsapp` | Verificación de la suscripción de Meta: con `hub.mode=subscribe` y `hub.verify_token` igual a `WHATSAPP_VERIFY_TOKEN` devuelve `hub.challenge` en texto; si no, 403. |
| POST | `/webhooks/whatsapp` | Firmado con `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo con `WHATSAPP_APP_SECRET`). Estados `sent`, `delivered`, `read` y `failed` por el id del mensaje (sin retroceder); mensajes entrantes guardados para la bandeja de consultas; `BAJA` o `STOP` registran la baja de WhatsApp. |
| POST | `/webhooks/resend` | Firmado por svix (`svix-id`, `svix-timestamp` a menos de 5 minutos, `svix-signature`, con `RESEND_WEBHOOK_SECRET`). `email.sent`, `email.delivered`, `email.bounced` y `email.failed` actualizan el estado; `email.complained` registra la baja del mail. |

Ambos responden `{ received: true }`.

## Notificaciones

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/notifications` | Notificaciones del usuario. | Autenticado |
| GET | `/notifications/unread-count` | Cantidad sin leer. | Autenticado |
| PATCH | `/notifications/:id/read` | Marca una como leída. | Autenticado |
| PATCH | `/notifications/mark-all-read` | Marca todas como leídas. | Autenticado |
| POST | `/notifications/run` | Dispara la corrida de generación de avisos. | Admin |

Tipos nuevos (ADR-0013): `MessageFailed` (un mensaje no se pudo enviar), `ContactOptedOut` (una persona pidió la baja por WhatsApp) e `InboundMessageReceived` (llegó un WhatsApp); `SystemAlert` avisa de mensajes trabados por falta de proveedor. `TicketCreated` y `TicketCommentAdded` avisan al personal de los tickets del portal. `PaymentReceived` y `TicketStatusChanged` quedan sin emisor: el aviso al cliente es un mensaje de la bandeja de salida.

## Asistencia sobre el modelo de lenguaje

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/ai/priorities` | Prioridades del día sobre la cartera. | Admin, Gerente |
| GET | `/ai/contracts/:contractId/closure-summary` | Resumen de gestión del contrato cerrado. | Admin, Gerente |
| POST | `/ai/contracts/:contractId/closure-summary` | Genera ese resumen. | Admin, Gerente |

Sin credencial configurada estas funciones resuelven por sus propias reglas en
lugar de fallar.

## Portal del inquilino

El portal usa un ámbito de autenticación propio. Sus rutas quedan fuera del guard
general y aplican su propio guard, que exige un token cuyo tipo sea el del
portal; un token del personal es rechazado acá, y uno del portal es rechazado en
el resto de la API. La identidad del portal no tiene rol: lo que puede ver está
delimitado por la persona a la que pertenece el token.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| POST | `/portal/auth/login` | Ingreso del inquilino. | Público, 5/min |
| POST | `/portal/auth/refresh` | Rota el token de refresco del portal. | Público |
| POST | `/portal/auth/set-password` | Define la contraseña a partir del token de invitación. | Público |
| POST | `/portal/auth/logout` | Cierra la sesión. | Sesión del portal |
| GET | `/portal/contract` | Contratos del inquilino. | Sesión del portal |
| GET | `/portal/liquidaciones` | Sus liquidaciones. | Sesión del portal |
| GET | `/portal/liquidaciones/:id/pdf` | Comprobante en PDF. | Sesión del portal |
| GET | `/portal/categories` | Categorías disponibles para abrir un reclamo. | Sesión del portal |
| GET | `/portal/tickets` | Sus reclamos. | Sesión del portal |
| POST | `/portal/tickets` | Abre un reclamo, con adjunto opcional. | Sesión del portal |
| GET | `/portal/tickets/:id` | Detalle de un reclamo. | Sesión del portal |
| POST | `/portal/tickets/:id/comments` | Comenta un reclamo, con adjunto opcional. | Sesión del portal |

El token de refresco del portal rota en cada uso, y reutilizar uno ya revocado
revoca todos los de esa persona: es la detección de robo de token.

## Publicación

Estado de cada propiedad en cada portal, aviso listo para copiar y resumen de lo
que falta publicar. Un aviso es una fila por propiedad, operación y portal
(`property_listings`); el portal `micrositio` es el sitio propio y siempre
existe, los demás se configuran por inmobiliaria en
`operationalDefaults.publication`. La publicación en Zonaprop, Argenprop,
MercadoLibre y La Voz es manual: ninguno ofrece una interfaz utilizable desde acá
(ver `tesis/01-alcance-y-objetivos.md`), así que la API solo registra el estado.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/properties/:id/listings` | Estado de la propiedad en cada portal: operaciones, portales, avisos con estado vigente (un aviso publicado y vencido sale `Vencido`), enlace y quién lo actualizó. | Autenticado |
| PUT | `/properties/:id/listings` | Guarda uno o más avisos (`{ listings: [{ operationType, portal, status, externalUrl?, externalCode?, publishedAt?, expiresAt? }] }`). 400 `PORTAL_UNKNOWN`, `OPERATION_NOT_FOUND`, `EXPIRY_IN_PAST` o URL que no es http(s); 409 `OPERATION_NOT_PUBLISHABLE` (solo una operación Disponible o Reservada se publica), `PORTAL_DISABLED`. | Admin, Gerente, Ventas, Marketing |
| GET | `/properties/:id/ad-copy` | Aviso para copiar: `?portal=` (por defecto `micrositio`) y `?operation=`. Devuelve título, descripción, límites del portal, fotos en orden de carga y advertencias. | Autenticado |
| GET | `/listings/overview` | Disponibles sin publicar, por vencer, vencidos y publicados de lo que ya no está disponible, con totales y avisos por portal. | Autenticado |
| POST | `/listings/pause-unavailable` | Pasa a `Pausado` los avisos publicados de operaciones que ya no están disponibles o de propiedades dadas de baja. | Admin, Gerente, Ventas, Marketing |
| GET | `/listings/portals` | Portales configurados, privacidad (`hideExactAddress`, `showMap`) y días de aviso (`expiryWarnDays`). | Autenticado |
| PUT | `/listings/portals` | Reemplaza esa configuración. `PUT /tenants/me/operational-defaults` no la borra si el cuerpo no la trae. | Admin, Gerente |

El aviso para copiar se arma con plantillas deterministas, sin servicios
externos. Nunca usa el título interno de la ficha ni datos de propietarios o
inquilinos, quita mails, teléfonos y links del texto libre, y muestra la calle y
la altura solo si `hideExactAddress` es falso.

## Micrositio público

Estas rutas no requieren ninguna sesión. La inmobiliaria se resuelve por su
`slug`, que un guard propio traduce leyendo por fuera del filtro por
inmobiliaria, porque en ese momento todavía no hay —ni va a haber— contexto de
sesión. Solo se devuelve lo que alguien publicó: una operación `Disponible` con
su aviso en el portal `micrositio` en `Publicado` y sin vencer. Nunca se
devuelven propietarios, inquilinos ni notas internas, y la calle, la altura y las
coordenadas solo si la configuración de publicación lo permite (las coordenadas,
redondeadas a unos 100 m). La web resuelve la inmobiliaria por dominio con
`MICROSITE_HOST_MAP` o `MICROSITE_BASE_DOMAIN` (ver `despliegue.md`).

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/public/:slug` | Perfil público de la inmobiliaria. | Público |
| GET | `/public/:slug/properties` | Propiedades publicadas, filtrables por operación, tipo, zona (`city`) y rango de precio (`minPrice`, `maxPrice`, sobre el precio de la operación). | Público |
| GET | `/public/:slug/properties/:id` | Ficha de una propiedad publicada. | Público |
| GET | `/public/:slug/sitemap` | Ids y fecha de cambio de lo publicado, para el `sitemap.xml`. | Público |
| POST | `/public/:slug/inquiries` | Consulta del formulario, que entra como lead (origen `WebInquiry`; la bandeja de consultas la toma de ahí). No se escribe en `inbound_messages` porque esa tabla solo admite los canales `Email` y `WhatsApp` y exige el id del proveedor; sumar un canal web exigiría una migración de enum sin ganancia, ya que el interesado ya tiene responsable, embudo y seguimiento. El campo `website` es un señuelo: lleno, se responde 201 igual y no se guarda nada. | Público, 10/min |
