# Modelo de Datos

El modelo está implementado con Prisma sobre PostgreSQL. A continuación se describen las entidades principales agrupadas por dominio, sus campos representativos y sus relaciones más relevantes. El detalle exhaustivo de columnas e índices vive en `apps/api/prisma/schema.prisma`, que hoy define cincuenta y cinco modelos.

Una convención vale aclararla antes del detalle: **todas las tablas del dominio llevan una columna `tenantId`**, que es el ancla del aislamiento entre inmobiliarias. Sólo algunas declaran además la relación inversa hacia `Tenant`; el resto lleva la columna sin relación declarada, para no acumular medio centenar de campos de vuelta sobre la misma entidad. El filtro no se aplica a mano en cada consulta sino desde una extensión del cliente de Prisma, según se describe en el ADR 0006.

## Auth y Tenant

### Tenant

Inmobiliaria. Es el ancla de aislamiento del sistema.

- `id`, `name`, `slug`, `cuit`, `province`, `timezone`, `currency`, `tier`, `brandPrimary`, `brandSecondary`, `logoUrl`, `penaltyConfig`, `isActive`, `createdAt`.
- `slug` es lo que resuelve el micrositio público; `brandPrimary`, `brandSecondary` y `logoUrl` son los que lo pintan. `penaltyConfig` guarda como JSON los parámetros de punitorios de la inmobiliaria.

### User

Usuario interno de una inmobiliaria.

- `id`, `tenantId`, `email`, `passwordHash`, `firstName`, `lastName`, `role`, `isActive`, `lastLoginAt`.
- `role` toma uno de los siete valores de `UserRole`. Relación N-1 con `Tenant`, 1-N con `RefreshToken` y `AuditLog`.

### RefreshToken

Token de refresco emitido al usuario, rotado en cada uso.

- `id`, `token`, `userId`, `expiresAt`, `isRevoked`, `createdAt`.
- No lleva `tenantId`: su aislamiento depende de la relación con `User`. El token se guarda tal cual y la revocación es una marca booleana, no una fecha.

### UserInvitation

Invitación pendiente para incorporar un usuario nuevo.

- `id`, `tenantId`, `email`, `role`, `token`, `expiresAt`, `acceptedAt`.

### AuditLog

Registro de acciones sensibles.

- `id`, `tenantId`, `userId`, `action`, `entity`, `entityId`, `changes`, `ipAddress`, `userAgent`, `createdAt`.
- El detalle del cambio va en `changes`, como JSON.

## Personas

### Person

Persona física o jurídica genérica. Una misma persona puede tener varios roles.

- `id`, `tenantId`, `firstName`, `lastName`, `email`, `phone`, `phone2`, `cuit`, `fiscalCondition`, `bankName`, `cbu`, `bankAlias`, `notes`, `isActive`.
- La identificación fiscal es `cuit`; no hay una columna de número de documento separada. Los datos bancarios son los que alimentan la rendición al propietario.

### PersonRoleAssignment

Vincula a una `Person` con un rol: propietario, inquilino, garante, comprador, proveedor o lead.

- `id`, `tenantId`, `personId`, `role`, `assignedAt`, `propertyId`, `guarantorForPersonId`.
- La asignación puede acotarse a una propiedad concreta mediante `propertyId`, y en el caso del garante apunta a quién garantiza mediante `guarantorForPersonId`. Es lo que permite que la misma persona sea propietaria de un inmueble e inquilina de otro.

### PersonDocument

Documentación adjunta (DNI, recibos de sueldo, escrituras).

- `id`, `tenantId`, `personId`, `fileName`, `url`, `mimeType`, `sizeBytes`, `uploadedAt`.

### ProviderProfile

Perfil específico cuando la persona es proveedor de servicios.

- `id`, `tenantId`, `personId`, `rubros`, `coverageZones`, `isActive`, `notes`.
- `rubros` y `coverageZones` son arreglos, y son los dos criterios con los que se ofrecen proveedores habilitados para un ticket.

## Propiedades

### Property

Inmueble administrado por la inmobiliaria.

- `id`, `tenantId`, `title`, `description`, `type`, `street`, `number`, `floor`, `apartment`, `city`, `province`, `zipCode`, `country`, `latitude`, `longitude`, `area`, `rooms`, `bedrooms`, `bathrooms`, `garages`, `age`, `orientation`, `amenities`, `price`, `currency`, `isActive`.
- La dirección está desagregada en columnas, no en un campo único. La propiedad **no** tiene un estado de disponibilidad ni un propietario directo: el estado vive en cada `PropertyOperation` y la titularidad se expresa como una `PersonRoleAssignment` de rol propietario apuntando a la propiedad.
- Relación 1-N con `PropertyOperation`, `PropertyMedia`, `PriceHistory`, `PropertyValuation`, `Service`, `Ticket`, `LeadVisit`.

### PropertyOperation

Operación habilitada sobre la propiedad, con su propio estado.

- `id`, `tenantId`, `propertyId`, `operationType`, `state`, `price`, `currency`.
- `operationType` es alquiler, alquiler temporario o venta. `state` recorre la máquina de estados de disponibilidad: borrador, disponible, reservado, alquilado, vendido, ocupado, suspendido y archivado. Que el estado esté acá y no en la propiedad es lo que permite tener un mismo inmueble publicado en venta y alquilado a la vez.

### PropertyMedia

Imágenes de la propiedad, en dos resoluciones.

- `id`, `tenantId`, `propertyId`, `url`, `thumbnailUrl`, `mimeType`, `sizeBytes`, `width`, `height`, `sortOrder`, `isPrimary`.
- El orden de la galería es `sortOrder` y la portada es `isPrimary`. Ambas versiones del archivo viven en el almacenamiento de objetos; las URLs de lectura se firman por pedido.

### PriceHistory

Historial de cambios de precio de la propiedad.

- `id`, `tenantId`, `propertyId`, `price`, `currency`, `changedAt`, `changedByUserId`.

### PropertyValuation

Tasación de la propiedad.

- `id`, `tenantId`, `propertyId`, `valuationDate`, `value`, `currency`, `method`, `appraiser`, `notes`.

## Contratos

### Contract

Contrato entre propietario e inquilino, o de venta.

- `id`, `tenantId`, `propertyId`, `contractType`, `status`, `startDate`, `endDate`, `rentAmount`, `rentCurrency`, `depositAmount`, `depositCurrency`, `adjustmentType`, `adjustmentPeriod`, `customAdjustmentPct`, `notes`, `isActive`, `closedAt`.
- **La configuración del ajuste vive en el contrato**, no en una tabla aparte: `adjustmentType` toma IPC, ICL, CCP, porcentaje fijo o personalizado, `adjustmentPeriod` va de mensual a anual, y `customAdjustmentPct` guarda el porcentaje cuando la modalidad es de porcentaje fijo.
- Relación 1-N con `ContractPerson`, `ContractGuarantee`, `ContractAdjustment`, `AdjustmentSchedule`, `Liquidacion`, `OwnerRendicion`; 1-1 con `ContractCommission` y `ContractClosureSummary`.

### ContractPerson

Relación N-M entre `Contract` y `Person`, indicando el rol de cada parte.

- `id`, `tenantId`, `contractId`, `personId`, `role`.

### ContractGuarantee

Garantías asociadas al contrato.

- `id`, `tenantId`, `contractId`, `type`, `status`, `description`, `amount`, `currency`, `issuer`, `policyNumber`, `startDate`, `endDate`.
- `type` es seguro de caución, garantía propietaria, garantía bancaria, depósito u otra. La garantía no apunta a una `Person`: los datos del garante se cargan en `issuer` y la vinculación como persona, cuando existe, se expresa por `PersonRoleAssignment`.

### AdjustmentSchedule

Cronograma de ajustes pendientes del contrato. Es lo que el barrido diario consulta para saber a qué contratos les toca ajustar.

- `id`, `tenantId`, `contractId`, `nextAdjustmentDate`, `periodNumber`, `status`.
- `status` recorre pendiente, calculado, aplicado y omitido. Cuelga del contrato directamente, no de un registro de configuración intermedio.

### ContractAdjustment

Ajuste ya calculado o aplicado sobre el contrato. Es el registro histórico, uno por período ajustado.

- `id`, `tenantId`, `contractId`, `periodNumber`, `adjustmentDate`, `previousAmount`, `newAmount`, `percentage`, `currency`, `indexType`, `indexValues`, `notes`, `calculatedAt`, `appliedAt`.
- `indexValues` guarda como JSON los valores de índice que se usaron en el cálculo, de modo que un ajuste aplicado se pueda reconstruir aunque después se corrija la serie publicada. Mientras `appliedAt` esté vacío, el ajuste está calculado pero no impactado en el contrato.

### IndexData

Valores publicados de los índices.

- `id`, `tenantId`, `indexType`, `period`, `value`, `source`.
- `indexType` toma IPC, ICL, CVS, CER o UVA. Los valores se consumen como variación del período, no como nivel absoluto.

### ContractTemplate

Plantillas para generar el documento del contrato.

- `id`, `tenantId`, `name`, `contractType`, `body`, `variables`, `isDefault`, `isActive`.

### ContractCommission

Comisión de la inmobiliaria sobre un contrato. Es el parámetro que determina la rendición al propietario.

- `id`, `tenantId`, `contractId`, `type`, `percentage`, `fixedAmount`, `adminFee`, `currency`, `notes`.

### ContractClosureSummary

Resumen de gestión producido al cerrar el contrato.

- `id`, `tenantId`, `contractId` (único), `summary`, `highlights`, `metrics`, `source`, `model`, `generatedAt`.
- `source` distingue si el texto lo produjo el modelo de lenguaje o las reglas propias del sistema, y `model` registra cuál se usó cuando corresponde.

## Liquidaciones y cobranzas

### Liquidacion

Liquidación mensual al inquilino.

- `id`, `tenantId`, `contractId`, `period`, `status`, `dueDate`, `subtotal`, `total`, `currency`, `notes`, `pdfUrl`, `sentAt`, `paidAt`.
- Relación 1-N con `LiquidacionLineItem`, `Payment` y `Penalty`.

### LiquidacionLineItem

Línea de la liquidación.

- `id`, `tenantId`, `liquidacionId`, `type`, `description`, `amount`, `currency`, `sortOrder`.
- `type` toma alquiler, ajuste, extra, descuento o multa.

### Payment

Pago aplicado a una liquidación.

- `id`, `tenantId`, `liquidacionId`, `amount`, `currency`, `method`, `reference`, `notes`, `paidAt`.
- `method` es transferencia, efectivo, MercadoPago o cheque. El pago no registra qué usuario lo cargó: esa traza queda en `AuditLog`.

### Penalty

Punitorio calculado sobre una liquidación vencida.

- `id`, `tenantId`, `liquidacionId`, `amount`, `appliedOn`, `daysOverdue`, `compoundBase`, `status`, `waivedAt`, `waivedBy`, `waiveReason`, `settledLiquidacionId`.
- La condonación no borra el registro: lo marca con su fecha, su responsable y su motivo. `settledLiquidacionId` apunta a la liquidación en la que el punitorio terminó cobrándose.

### Service / ServicePayment

Servicios asociados a una propiedad (gas, luz, ABL) y sus pagos.

- `Service`: `id`, `tenantId`, `propertyId`, `serviceType`, `providerName`, `accountNumber`, `amount`, `currency`, `dueDay`, `isActive`, `notes`.
- `ServicePayment`: `id`, `tenantId`, `serviceId`, `amount`, `paymentDate`, `period`, `notes`.

### OwnerRendicion / RendicionLineItem

Rendición mensual al propietario y sus conceptos.

- `OwnerRendicion`: `id`, `tenantId`, `contractId`, `ownerId`, `period`, `status`, `rentCollected`, `commissionAmount`, `adminFeeAmount`, `deductionTotal`, `netDeposit`, `currency`, `pdfUrl`, `sentAt`, `depositedAt`, `notes`.
- `RendicionLineItem`: `id`, `tenantId`, `rendicionId`, `type`, `description`, `amount`, `isDebit`, `currency`, `sortOrder`.
- Los montos de la rendición están desagregados en columnas propias —lo cobrado, la comisión, el honorario administrativo, el total deducido y el depósito neto— y no se recalculan al leer.

## Facturación electrónica (ARCA)

### ArcaCertificate

Certificado digital de la inmobiliaria para autenticarse contra el WSAA de ARCA. El certificado y su clave privada se guardan cifrados: el contenido se sella con una clave de datos (DEK) propia de la fila, y esa DEK se envuelve a su vez con la clave maestra del sistema.

- `id`, `tenantId` (único), `commonName`, `notBefore`, `notAfter`, `isProduction`, `isActive`, `certEncrypted`, `keyEncrypted`, `dekWrapped`, `kekVersion`.
- Relación 1-1 con `Tenant`. Relación 1-N con `ArcaCertificateAccessLog`.

### ArcaCertificateAccessLog

Auditoría de cada desencriptado de la clave privada del certificado, de forma que un uso indebido pueda trazarse hasta el actor y el motivo que lo originó.

- `id`, `tenantId`, `certificateId`, `actor`, `reason`, `createdAt`.

### ArcaIssuer

CUIT en nombre del cual la inmobiliaria puede facturar: el propio (`isSelf`) o el de un propietario que le delegó el servicio de facturación electrónica (WSFE) en ARCA.

- `id`, `tenantId`, `cuit`, `businessName`, `fiscalCondition`, `delegationStatus` (Pending, Active, Revoked), `delegationVerifiedAt`, `delegationLastError`, `isSelf`, `isActive`.
- Único por `(tenantId, cuit)`. Relación 1-N con `ArcaPuntoDeVenta` y con `Comprobante`.

### ArcaPuntoDeVenta

Punto de venta habilitado en ARCA para un emisor determinado.

- `id`, `issuerId`, `number`, `nombre`, `tipo`, `bloqueado`, `lastSyncAt`.
- Único por `(issuerId, number)`. Relación N-1 con `ArcaIssuer`.

### ArcaRequestLog

Registro literal de cada llamada a los web services de ARCA (WSAA/WSFEv1), con el request y la respuesta completos, ya que un rechazo de AFIP sólo se entiende junto al payload exacto que lo produjo.

- `id`, `tenantId`, `issuerId?`, `operation`, `issuerCuit?`, `requestPayload`, `responsePayload`, `latencyMs`, `success`, `errorCode?`, `errorMessage?`, `comprobanteId?`.

### Comprobante

Comprobante electrónico autorizado por ARCA (factura, nota de crédito o nota de débito, en sus variantes A, B o C) emitido sobre un `Payment`.

- `id`, `tenantId`, `paymentId`, `issuerId?`, `type` (`ComprobanteType`), `status` (Emitido, Anulado), `cbteTipo`, `puntoDeVenta`, `numero`, `docTipo`, `docNro`, `receptorName`, `receptorFiscalCondition`, `impTotal`, `impNeto`, `impIva`, `cae`, `caeFchVto`, `emittedAt`.
- La terna `(tenantId, puntoDeVenta, cbteTipo, numero)` es única, ya que la numeración que exige AFIP no admite huecos ni repeticiones.
- Relación N-1 con `Payment` y con `ArcaIssuer`. Una nota de crédito referencia al comprobante que anula a través de `originalComprobanteId` (relación `ComprobanteNC`).

### LibroIvaExport

Libro IVA ventas del período, generado y exportado a Excel para su guarda en almacenamiento de objetos. Hay un registro por tenant y período: regenerar un período reemplaza el archivo anterior.

- `id`, `tenantId`, `period`, `rowCount`, `s3Key`, `fileUrl`, `generatedAt`.
- Único por `(tenantId, period)`. Relación N-1 con `Tenant`.

## CRM

### Pipeline / PipelineStage

Embudo configurable con sus etapas ordenadas.

- `Pipeline`: `id`, `tenantId`, `type`, `name`, `isActive`.
- `PipelineStage`: `id`, `pipelineId`, `name`, `sortOrder`, `staleDays`, `isDefault`.
- La etapa no lleva `tenantId`: su aislamiento depende de la relación con `Pipeline`. `staleDays` es la cantidad de días tras la cual un lead detenido en esa etapa se marca como estancado.

### Lead

Interesado en alquilar, comprar o publicar.

- `id`, `tenantId`, `personId`, `pipelineId`, `currentStageId`, `propertyId`, `assignedToUserId`, `source`, `status`, `notes`, `budget`, `budgetCurrency`, `lostReason`, `convertedAt`, `lostAt`, `lastContactAt`, `staleDays`, `isActive`.
- La etapa actual es `currentStageId`, y el lead guarda además su embudo en `pipelineId`. Al descartarse conserva `lostReason` y `lostAt`; al convertirse, `convertedAt` y la `Person` resultante en `personId`.

### LeadInteraction

Eventos registrados sobre el lead.

- `id`, `tenantId`, `leadId`, `type`, `notes`, `contactedBy`, `occurredAt`.

### LeadVisit

Visita agendada sobre una propiedad concreta.

- `id`, `tenantId`, `leadId`, `propertyId`, `scheduledAt`, `completedAt`, `status`, `outcome`, `notes`, `conductedBy`.

## Tickets

### TicketCategory

Categoría configurable (plomería, electricidad, otros).

- `id`, `tenantId`, `name`, `isActive`.

### Ticket

Reclamo abierto por el inquilino o por la inmobiliaria.

- `id`, `tenantId`, `propertyId`, `categoryId`, `createdByUserId`, `createdByPersonId`, `assignedToUserId`, `providerId`, `title`, `description`, `status`, `priority`, `slaDeadline`, `costAmount`, `costCurrency`, `costPayer`, `providerNotes`, `resolvedAt`, `closedAt`.
- El ticket cuelga de la propiedad, no del contrato. Quien lo abre se registra en una de dos columnas según el ámbito: `createdByUserId` si lo abrió el personal, `createdByPersonId` si entró por el portal del inquilino. `slaDeadline` se deriva de la prioridad.

### TicketComment / TicketAttachment

Conversación y archivos asociados al ticket.

- `TicketComment`: `id`, `tenantId`, `ticketId`, `userId`, `personId`, `content`.
- `TicketAttachment`: `id`, `tenantId`, `commentId`, `url`, `thumbnailUrl`, `mimeType`, `sizeBytes`, `width`, `height`.
- El adjunto cuelga del comentario, no del ticket: todo archivo entra acompañando un mensaje.

## Portal del inquilino

### InquilinoCredential

Credenciales del inquilino para el portal de autogestión.

- `id`, `tenantId`, `personId`, `passwordHash`, `isActive`, `lastLoginAt`.
- No guarda un correo propio: el inquilino ingresa con el correo de su `Person`, de modo que no hay dos direcciones que puedan divergir.

### PortalRefreshToken

Equivalente al `RefreshToken` de los usuarios internos, acotado al portal.

- `id`, `token`, `personId`, `tenantId`, `expiresAt`, `isRevoked`.

### PortalInvitation

Invitación al inquilino para activar su acceso.

- `id`, `tenantId`, `personId`, `invitedByUserId`, `token`, `expiresAt`, `acceptedAt`.

## Puntaje, notificaciones y reportes

### TenantScoreConfig / TenantScore

Pesos de los criterios de puntaje y resultado calculado por inquilino.

- `TenantScoreConfig`: `id`, `tenantId`, `guaranteeWeight`, `jobStabilityWeight`, `referencesWeight`, `paymentHistoryWeight`, `manualRatingWeight`.
- `TenantScore`: `id`, `tenantId`, `personId`, `guaranteeScore`, `jobStabilityScore`, `referencesScore`, `paymentHistoryScore`, `manualRating`, `totalScore`, `notes`, `scoredByUserId`, `scoredAt`.
- Los cinco componentes se guardan por separado y `totalScore` se calcula siempre en el servidor, ponderando por la configuración de la inmobiliaria.

### Notification

Avisos generados para un usuario interno.

- `id`, `tenantId`, `userId`, `type`, `title`, `message`, `isRead`, `entityType`, `entityId`.
- `entityType` y `entityId` son los que permiten llevar al usuario directo al registro que originó el aviso.

### EmailTemplate

Plantillas reutilizables de correo.

- `id`, `tenantId`, `name`, `subject`, `body`, `variables`, `isActive`.

### ReportSchedule

Envío periódico de un reporte.

- `id`, `tenantId`, `reportType`, `frequency`, `filters`, `recipients`, `format`, `isActive`, `lastRunAt`, `nextRunAt`.

## Relaciones críticas

- `Tenant` 1-N `User`, `Property`, `Person`, `Pipeline`, `Ticket`, `TicketCategory`, `ArcaIssuer`, `ReportSchedule`, con relación declarada. El resto de las tablas del dominio —`Contract`, `Liquidacion`, `Lead`, `Payment` y demás— lleva la columna `tenantId` sin relación inversa.
- `Property` 1-N `PropertyOperation`, y es la operación la que tiene el estado de disponibilidad. La titularidad del propietario se expresa mediante `PersonRoleAssignment`, no con una clave foránea en `Property`.
- `Property` 1-N `Contract` a lo largo del tiempo.
- `Contract` N-M `Person` mediante `ContractPerson`.
- `Contract` 1-N `AdjustmentSchedule` (lo pendiente) y 1-N `ContractAdjustment` (lo calculado y aplicado).
- `Contract` 1-N `Liquidacion` 1-N `LiquidacionLineItem`.
- `Liquidacion` 1-N `Payment` 1-N `Comprobante`, y 1-N `Penalty`.
- `Contract` 1-1 `ContractCommission`, y esa comisión es la que determina el `netDeposit` de `OwnerRendicion`.
- `Lead` N-1 `Pipeline` y N-1 `PipelineStage` a través de `currentStageId`.
- `Ticket` N-1 `Property`, N-1 `TicketCategory` y N-1 `Person` en el rol de proveedor (opcional). `TicketAttachment` cuelga de `TicketComment`.
- `InquilinoCredential` 1-1 `Person`, con el rol de inquilino asignado por `PersonRoleAssignment`.
- `RefreshToken` y `PipelineStage` son las dos únicas tablas sin `tenantId`: se aíslan por su padre, `User` y `Pipeline` respectivamente.
