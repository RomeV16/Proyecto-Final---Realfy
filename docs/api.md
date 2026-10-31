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
| GET | `/tenants/me/operational-defaults` | Valores por defecto de la operación: `dueDay`, `leadDays`, `ipcLagMonths`, `commissionPct`, `fees` (`alta`, `renovacion`, `ventaConstruido`, `ventaLote`), `valuationUsd`, `upfrontThresholdFees`, `collectionCadence` (`firstReminderDays`, `everyDays`) y `expiryLight` (`redDays`, `yellowDays`). Sin configurar devuelve los del código (10, 10, 2, 7, 5/5/3/5, 100, 2, 5/5, 0/60). | Autenticado |
| PUT | `/tenants/me/operational-defaults` | Reemplaza los valores; lo que falte toma el del código. 400 `VALIDATION_ERROR` ante un valor fuera de rango, un campo desconocido o `yellowDays` menor que `redDays`. Un contrato nuevo nace con `dueDay` y `ipcLagMonths` de acá. | Admin, Gerente |
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

**Enlaces de invitación y de recupero.** `invite`, `invitation/resend` y `password-reset-link` devuelven `{ id, email, role?, expiresAt, token, link, emailSent }`. El `token` tiene 256 bits aleatorios, en base de datos solo queda su hash SHA-256, y el valor en claro se ve una única vez, en esa respuesta. La invitación vence a los 7 días y el enlace de recupero a la hora; ambos se consumen al usarse. `link` apunta a `WEB_BASE_URL` (o, si falta, al primer origen de `CORS_ORIGINS`) y se comparte a mano. `emailSent` es `true` solo si el servicio de correo está configurado y el envío salió bien; un fallo de correo nunca corta la operación. Un token inexistente, ajeno o de otra inmobiliaria responde como inexistente. Una llamada sobre un usuario (o una invitación) de otra inmobiliaria responde 404 `USER_NOT_FOUND` (`INVITATION_NOT_FOUND`).

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
| POST | `/contracts` | Alta, en `Borrador` por defecto. Con `status: Activo` se crea ya activado y pasa por las mismas validaciones que `/activate`. Los locadores llegan en `lessors` (`personId`, `payoutPct`, `capacity`, `payeePersonId`, `bankAccountId`, `validFrom`, `validTo`); si se omiten, los `persons` con rol `Propietario` se reparten el 100 % en partes iguales. Un locador no necesita tener ya el rol de propietario: se le asigna. Inquilino y garante sí necesitan su rol (400 `INVALID_PERSON_ROLE`). | Admin, Gerente, Ventas |
| PATCH | `/contracts/:id` | Edición. Los cambios de estado respetan la máquina de estados del contrato; pasar a `Activo` se hace con `/activate` (`ACTIVATION_REQUIRED`). Acepta `actualEndDate` (fin real o prórroga de palabra, `null` la quita; no puede ser anterior al inicio, 400 `VALIDATION_ERROR`) y rehace el cronograma pendiente hasta el fin efectivo. Cambiar la modalidad de ajuste de un contrato con más de una versión de reglas se rechaza (409 `RULES_CHANGE_REQUIRES_AGREEMENT`): va por convenio. Un contrato pasado de su fin pactado sin `actualEndDate` sigue `Activo`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/activate` | `Borrador` → `Activo`. Valida propiedad, inquilino, fechas que los locadores vigentes sumen exactamente 100 % en cada fecha del contrato (`LESSOR_SHARES_INVALID`, con las fechas y sumas en `invalidDates`) y que no haya otro alquiler activo de la propiedad con fechas superpuestas; si falla responde `CONTRACT_NOT_ACTIVATABLE` con la lista `problems`. Deja la operación de alquiler de la propiedad en `Alquilado`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/terminate` | Rescinde el contrato y produce el resumen de cierre. Si era el último alquiler activo, la operación de alquiler de la propiedad vuelve a `Disponible`. | Admin, Gerente |
| GET | `/contracts/:id/lessors` | Locadores del contrato con persona, cobrador y cuenta, de menor a mayor fecha de inicio. `?at=` devuelve solo los vigentes en esa fecha. | Autenticado |
| POST | `/contracts/:id/lessors` | Agrega un locador. En un contrato que ya salió de `Borrador`, el resultado tiene que sumar 100 % en cada fecha (400 `LESSOR_SHARES_INVALID`, con `details.invalidDates`). Valida la cuenta (400 `BANK_ACCOUNT_NOT_OF_LESSOR`) y el cobrador (400 `PAYEE_WITHOUT_POWER`). | Admin, Gerente, Ventas |
| PUT | `/contracts/:id/lessors` | Reemplaza todo el conjunto en una transacción (`{ lessors: [{ id?, ... }] }`): las filas con `id` se actualizan, las nuevas se crean y las que faltan se borran. Siempre exige que sumen 100 %. Sirve para cambiar el reparto o hacer una cesión de un contrato activo. | Admin, Gerente, Ventas |
| PATCH | `/contracts/:id/lessors/:lessorId` | Cambia capacidad, porcentaje, cuenta, cobrador o vigencia. Cambiar el porcentaje baja la marca `needsReview`. 404 `LESSOR_NOT_FOUND`. | Admin, Gerente, Ventas |
| DELETE | `/contracts/:id/lessors/:lessorId` | Quita un locador (mismas reglas de suma que el alta). | Admin, Gerente, Ventas |
| GET | `/contracts/:id/terms` | Versiones de reglas del contrato y la vigente a `?at=` (hoy si se omite): `{ at, current, versions }`; `current` es `null` si la fecha es anterior al inicio. 400 `VALIDATION_ERROR` con una fecha inválida. | Autenticado |
| GET | `/contracts/:id/periods` | Períodos del contrato (original, renovaciones, prórrogas). | Autenticado |
| GET | `/contracts/:id/agreements` | Convenios del contrato con la versión de reglas que crearon. | Autenticado |
| POST | `/contracts/:id/agreements` | Registra un convenio (`kind`, `effectiveFrom`, `effectiveTo`, `documentUrl`, `notes`, `termsPatch`). `CambioRegla`, `Renegociacion`, `Rebaja` y `Bonificacion` exigen `termsPatch` (cualquiera de modalidad, período, base, rezago, porcentaje, escalones, alquiler acordado, descuento, vencimiento, flujo de cobro, punitorios; `null` quita un valor) y crean una versión nueva en la misma transacción; si rige desde hoy o antes, las columnas de ajuste del contrato quedan iguales a la versión vigente y, si cambió la periodicidad, se rehace el cronograma pendiente. Errores: 400 `AGREEMENT_BEFORE_START`, 400 `MISSING_ADJUSTMENT_PCT`, 400 `VALIDATION_ERROR`, 409 `TERMS_VERSION_EXISTS` (ya hay una versión con esa fecha). | Admin, Gerente |
| PATCH | `/contracts/:id/agreements/:agreementId` | Corrige `effectiveTo`, `documentUrl` o `notes`. 409 `AGREEMENT_HAS_LATER_VERSIONS` si una versión posterior depende del convenio; 404 `AGREEMENT_NOT_FOUND`. | Admin, Gerente |
| DELETE | `/contracts/:id/agreements/:agreementId` | Borra el convenio y su versión de reglas, con las mismas condiciones; las columnas del contrato vuelven a la versión vigente. | Admin, Gerente |
| GET | `/contracts/:id/adjustments` | Cronograma de ajustes. | Autenticado |
| POST | `/contracts/:id/adjustments/calculate` | Calcula el ajuste pendiente. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/adjustments/:adjId/apply` | Aplica un ajuste calculado. | Admin, Gerente |
| POST | `/contracts/:id/preview-adjustment` | Simula un ajuste sin persistirlo. | Admin, Gerente |
| GET | `/contracts/:id/available-templates` | Plantillas aplicables al contrato. | Admin, Gerente, Ventas |
| GET | `/contracts/:id/template-variables` | Variables que la plantilla puede interpolar: `contrato.*`, `propiedad.*`, `locadores.N.*` y `locador.*` (nombre, documento, domicilio, capacidad, porcentaje; `propietario.*` es un alias del primero), `apoderados.N.*`, `inquilino.*`, `garante.*`. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/generate-document` | Renderiza el documento del contrato. | Admin, Gerente, Ventas |
| GET | `/contracts/:contractId/commission` | Comisión pactada. | Autenticado |
| POST | `/contracts/:contractId/commission` | Define la comisión. | Admin, Gerente |
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
| GET | `/index-data` | Valores publicados por tipo de índice y período. | Autenticado |
| GET | `/index-data/latest` | Último valor oficial de cada índice (los estimados no cuentan). | Admin, Gerente |
| GET | `/index-data/estimates-replaced` | Estimados que ya tienen valor oficial (`?since=` filtra por fecha del reemplazo): por cada uno, índice, período, valor estimado y oficial, `via` (`manual` o `published`) y `contractIds` con ajustes provisionales sin corregir. La corrección en sí es de una etapa posterior. | Admin, Gerente |
| POST | `/index-data` | Carga manual de un valor. Acepta `isEstimate` y `estimateSource` (solo con `isEstimate`); un valor oficial reemplaza al estimado de la misma clave y queda registrado, y un estimado sobre un oficial responde 409 `OFFICIAL_VALUE_EXISTS`. `indexType` incluye `TasaActivaBNA`. | Admin |
| POST | `/index-data/bulk` | Carga manual de varios valores. | Admin |
| DELETE | `/index-data/:id` | Borra un valor. | Admin |
| POST | `/index-data/refresh` | Dispara la obtención de los índices desde las fuentes publicadas. | Admin |

## Servicios de la propiedad

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/services` | Listado de servicios asociados a propiedades y contratos. | Autenticado |
| GET | `/services/:id` | Detalle. | Autenticado |
| POST | `/services` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/services/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/services/:id` | Baja. | Admin, Gerente |
| POST | `/services/:id/payments` | Registra el pago de un servicio. | Admin, Gerente, Ventas |

## Liquidaciones

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/liquidaciones` | Listado paginado y filtrable por estado y período. | Autenticado |
| GET | `/liquidaciones/:id` | Detalle con líneas (con `beneficiary` y `commissionable`), pagos, locadores y `receiptNumber` (nulo hasta aprobar). | Autenticado |
| GET | `/liquidaciones/:id/pdf` | Recibo en PDF: número, monto en letras, "por cuenta y orden de" los locadores vigentes y renglones agrupados por destino. | Autenticado |
| POST | `/liquidaciones/generate` | Genera las liquidaciones del período con las reglas y el alquiler vigentes en ese mes: respeta el inicio y el fin efectivo del contrato, el día de vencimiento y el prorrateo del primer y último mes. Devuelve `created`, `skipped`, `outOfRange`, `failed`, `total` y el resultado por contrato. | Admin, Gerente, Liquidaciones |
| POST | `/liquidaciones/_run-now` | Corre ahora el proceso diario de generación para todas las inmobiliarias; `today` (`YYYY-MM-DD`) opcional fija el día. Solo con `NODE_ENV=test` o `E2E_TEST_MODE=1`, como `/penalties/_run-now`; fuera de ese modo responde 403. | Admin |
| POST | `/liquidaciones/:id/transition` | Cambia el estado. Ante un estado inválido devuelve las transiciones posibles. | Admin, Gerente, Liquidaciones |
| POST | `/liquidaciones/bulk-approve` | Aprueba en lote. | Admin, Gerente |
| POST | `/liquidaciones/bulk-send` | Envía en lote. | Admin, Gerente |
| POST | `/liquidaciones/:id/line-items` | Agrega una línea; `beneficiary` y `commissionable` son opcionales y, si faltan, rigen los del tipo. | Admin, Gerente, Liquidaciones |
| PATCH | `/liquidaciones/:id/line-items/:lineItemId` | Edita una línea. | Admin, Gerente, Liquidaciones |
| DELETE | `/liquidaciones/:id/line-items/:lineItemId` | Quita una línea. | Admin, Gerente, Liquidaciones |
| GET | `/liquidaciones/:id/payments` | Pagos imputados. | Autenticado |
| POST | `/liquidaciones/:id/payments` | Registra un pago e imputa el saldo. Rechaza con `PAYMENT_EXCEEDS_BALANCE` un importe mayor al saldo. | Admin, Gerente, Liquidaciones |
| DELETE | `/liquidaciones/:id` | Borra la liquidación. | Admin, Gerente |

## Pagos

El registro de un pago ocurre siempre contra su liquidación; este módulo es de
consulta agregada.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/payments` | Listado de pagos registrados. | Admin, Gerente, Liquidaciones, Lectura |
| GET | `/payments/debt` | Deuda pendiente y vencida de la cartera. | Admin, Gerente, Liquidaciones, Lectura |

## Morosidad y punitorios

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/penalties` | Punitorios calculados. | Admin, Gerente |
| GET | `/penalties/delinquent-tenants` | Inquilinos con liquidaciones vencidas, con deuda y días de atraso. | Admin, Gerente |
| GET | `/penalties/delinquent-tenants/count` | Cantidad de casos, para el panel. | Admin, Gerente |
| POST | `/penalties/preview` | Simula el punitorio de una liquidación. | Admin, Gerente |
| POST | `/penalties/:id/waive` | Condona una multa, con motivo. | Admin |
| POST | `/penalties/run` | Dispara la corrida de cálculo. | Admin |
| GET | `/tenants/me/penalty-config` | Parámetros de punitorios de la inmobiliaria. | Admin, Gerente |
| PUT | `/tenants/me/penalty-config` | Actualiza esos parámetros. | Admin |

Existe además `POST /penalties/_run-now`, que fuerza la corrida diaria sin
esperar al planificador. No declara roles, pero el propio manejador rechaza la
petición con 403 salvo que el servicio corra en modo de prueba: es una compuerta
para las pruebas de extremo a extremo, no un endpoint de operación.

## Rendiciones al propietario

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/renditions` | Listado por propietario y período. | Autenticado |
| GET | `/renditions/:id` | Detalle con los conceptos discriminados. | Autenticado |
| GET | `/renditions/:id/pdf` | Rendición en PDF. | Autenticado |
| POST | `/renditions/generate` | Genera la rendición de un contrato y período: una por cada locador vigente al inicio del período, con su parte repartida según `payoutPct`. Responde la del primer locador (el de mayor porcentaje) con `lessorRenditions`, la lista completa. 400 `LESSOR_SHARES_INVALID` si los locadores no suman 100 %. | Admin, Gerente, Liquidaciones |
| PATCH | `/renditions/:id/transition` | Cambia el estado. | Admin, Gerente, Liquidaciones |
| POST | `/renditions/:id/send` | Envía la rendición por correo al propietario. | Admin, Gerente, Liquidaciones |
| POST | `/renditions/:id/line-items` | Agrega un concepto. | Admin, Gerente, Liquidaciones |
| DELETE | `/renditions/:id/line-items/:itemId` | Quita un concepto. | Admin, Gerente, Liquidaciones |
| PATCH | `/renditions/:id/notes` | Edita las observaciones. | Admin, Gerente, Liquidaciones |

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
| POST | `/invoices/emit` | Emite una factura A, B o C. `paymentId` es opcional; la moneda sale de `monId` (`PES` o `DOL`). | Admin, Gerente, Liquidaciones |
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
| POST | `/tickets/:id/transition` | Cambia el estado según la máquina de estados. | Admin, Gerente, Soporte |
| POST | `/tickets/:id/assign-provider` | Asigna un proveedor. | Admin, Gerente, Soporte |
| PATCH | `/tickets/:id/cost` | Carga el costo del trabajo. | Admin, Gerente, Soporte |
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
otro valor devuelve 400.

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
| GET | `/properties/export/csv` | Exporta propiedades a CSV. | Admin, Gerente, Ventas |
| GET | `/properties/export/excel` | Exporta propiedades a Excel. | Admin, Gerente, Ventas |
| GET | `/persons/export/csv` | Exporta personas a CSV. | Admin, Gerente, Ventas |
| GET | `/persons/export/excel` | Exporta personas a Excel. | Admin, Gerente, Ventas |

## Plantillas de correo

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/email-templates` | Listado. | Admin, Gerente, Marketing |
| GET | `/email-templates/:id` | Detalle. | Admin, Gerente, Marketing |
| POST | `/email-templates` | Alta. | Admin, Gerente, Marketing |
| PATCH | `/email-templates/:id` | Edición. | Admin, Gerente, Marketing |
| DELETE | `/email-templates/:id` | Baja. | Admin, Gerente, Marketing |
| POST | `/email-templates/:id/preview` | Previsualiza la plantilla con datos reales. | Admin, Gerente, Ventas, Marketing |

## Notificaciones

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/notifications` | Notificaciones del usuario. | Autenticado |
| GET | `/notifications/unread-count` | Cantidad sin leer. | Autenticado |
| PATCH | `/notifications/:id/read` | Marca una como leída. | Autenticado |
| PATCH | `/notifications/mark-all-read` | Marca todas como leídas. | Autenticado |
| POST | `/notifications/run` | Dispara la corrida de generación de avisos. | Admin |

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

## Micrositio público

Estas rutas no requieren ninguna sesión. La inmobiliaria se resuelve por su
`slug`, que un guard propio traduce leyendo por fuera del filtro por
inmobiliaria, porque en ese momento todavía no hay —ni va a haber— contexto de
sesión.

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/public/:slug` | Perfil público de la inmobiliaria. | Público |
| GET | `/public/:slug/properties` | Propiedades publicadas, filtrables por operación, tipo y ciudad. | Público |
| GET | `/public/:slug/properties/:id` | Ficha de una propiedad publicada. | Público |
| POST | `/public/:slug/inquiries` | Consulta del formulario, que entra como lead. | Público, 10/min |
