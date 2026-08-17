# Modelo de Datos

El modelo está implementado con Prisma sobre PostgreSQL. A continuación se describen las entidades principales agrupadas por dominio, sus campos representativos y sus relaciones más relevantes. El detalle exhaustivo de columnas e índices vive en `apps/api/prisma/schema.prisma`.

## Auth y Tenant

### Tenant

Inmobiliaria. Es el ancla de aislamiento del sistema.

- `id`, `name`, `slug`, `status`, `createdAt`.
- Relación 1-N con `User`, `Property`, `Person`, `Contract`, etc.

### User

Usuario interno de una inmobiliaria.

- `id`, `tenantId`, `email`, `passwordHash`, `role`, `isActive`.
- Relación N-1 con `Tenant`. Relación 1-N con `RefreshToken` y `AuditLog`.

### RefreshToken

Token de refresh emitido al usuario, rotado en cada uso.

- `id`, `userId`, `tokenHash`, `expiresAt`, `revokedAt`.

### UserInvitation

Invitación pendiente para incorporar un nuevo agente.

- `id`, `tenantId`, `email`, `token`, `expiresAt`, `acceptedAt`.

### AuditLog

Registro inmutable de acciones sensibles.

- `id`, `tenantId`, `userId`, `entity`, `entityId`, `action`, `metadata`, `createdAt`.

## Personas

### Person

Persona física o jurídica genérica. Una misma persona puede tener varios roles.

- `id`, `tenantId`, `firstName`, `lastName`, `documentNumber`, `email`, `phone`.

### PersonRoleAssignment

Vincula a una `Person` con uno o más roles (propietario, inquilino, garante, proveedor).

- `id`, `personId`, `role`, `since`.

### PersonDocument

Documentación adjunta (DNI, recibos de sueldo, escrituras).

- `id`, `personId`, `type`, `url`, `uploadedAt`.

### ProviderProfile

Perfil específico cuando la persona es proveedor de servicios.

- `id`, `personId`, `specialty`, `rating`, `isActive`.

## Propiedades

### Property

Inmueble administrado por la inmobiliaria.

- `id`, `tenantId`, `address`, `type`, `status`, `ownerPersonId`.
- Relación 1-N con `PropertyMedia`, `PriceHistory`, `PropertyValuation`, `PropertyInventory`.

### PropertyOperation

Operación habilitada sobre la propiedad (alquiler, venta).

- `id`, `propertyId`, `kind`, `price`, `currency`.

### PropertyMedia

Imágenes y videos.

- `id`, `propertyId`, `url`, `order`, `isCover`.

### PropertyValuation

Tasación periódica de la propiedad.

- `id`, `propertyId`, `value`, `method`, `valuedAt`.

### PropertyInventory / InventoryItem / InventoryItemPhoto

Inventario al momento del ingreso o egreso del inquilino.

## Contratos

### Contract

Contrato de locación entre propietario e inquilino.

- `id`, `tenantId`, `propertyId`, `startDate`, `endDate`, `initialAmount`, `currency`, `status`.

### ContractPerson

Relación N-M entre `Contract` y `Person` indicando rol (inquilino, cofirmante).

- `contractId`, `personId`, `role`.

### ContractGuarantee

Garantías asociadas al contrato.

- `id`, `contractId`, `kind`, `description`, `personId?`.

### ContractAdjustment

Configuración del ajuste pactado.

- `id`, `contractId`, `kind` (IPC, UVA, MANUAL), `frequencyMonths`, `nextAdjustmentAt`.

### AdjustmentSchedule

Ajustes programados y aplicados.

- `id`, `contractAdjustmentId`, `appliedAt?`, `oldAmount`, `newAmount`, `indexValue`.

### IndexData

Valores históricos de IPC y UVA.

- `id`, `kind`, `period`, `value`.

### ContractTemplate

Plantillas Word/HTML para emitir el contrato.

### ContractCommission

Configuración de la comisión de la inmobiliaria sobre un contrato.

## Liquidaciones

### Liquidacion

Liquidación mensual al inquilino.

- `id`, `tenantId`, `contractId`, `period`, `total`, `status`.

### LiquidacionLineItem

Línea de la liquidación (alquiler, expensas, servicio, punitorio, etc.).

- `id`, `liquidacionId`, `concept`, `amount`, `notes`.

### Payment

Pago aplicado a una liquidación.

- `id`, `liquidacionId`, `amount`, `method`, `paidAt`, `recordedById`.

### Service / ServicePayment

Servicios asociados a una propiedad (gas, luz, ABL) y sus pagos.

### OwnerRendicion / RendicionLineItem

Rendición mensual al propietario y sus líneas.

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

Pipeline configurable con sus etapas ordenadas.

### Lead

Interesado en alquilar o publicar.

- `id`, `tenantId`, `pipelineStageId`, `personId?`, `source`, `status`.

### LeadInteraction

Eventos del lead (llamada, email, visita).

### LeadVisit

Visita agendada sobre una propiedad concreta.

## Tickets

### TicketCategory

Categoría configurable (plomería, electricidad, otros).

### Ticket

Reclamo abierto por inquilino o agente.

- `id`, `tenantId`, `contractId?`, `propertyId`, `categoryId`, `status`, `openedById`, `assignedProviderId?`.

### TicketComment / TicketAttachment

Conversación y archivos asociados al ticket.

## Portal

### InquilinoCredential

Credenciales del inquilino para el portal de autogestión.

- `id`, `tenantId`, `personId`, `email`, `passwordHash`, `isActive`.

### PortalRefreshToken

Equivalente al `RefreshToken` para usuarios internos, pero acotado al portal.

### PortalInvitation

Invitación al inquilino para activar su acceso.

## Scoring y notificaciones

### TenantScoreConfig / TenantScore

Configuración de los criterios de scoring y resultado calculado por inquilino.

### Notification

Cola de notificaciones a enviar (email, in-app).

### EmailTemplate

Plantillas reutilizables de email por evento.

## Relaciones críticas

- `Tenant` 1-N `User`, `Property`, `Person`, `Contract`, `Liquidacion`, `Lead`, `Ticket`.
- `Property` 1-N `Contract` (a lo largo del tiempo) y 1-1 `Person` propietario (rol activo).
- `Contract` N-M `Person` mediante `ContractPerson`.
- `Contract` 1-N `Liquidacion` 1-N `LiquidacionLineItem`.
- `Liquidacion` 1-N `Payment` 1-N `Comprobante`.
- `Lead` N-1 `PipelineStage` y N-1 `Pipeline`.
- `Ticket` N-1 `Property`, N-1 `TicketCategory`, N-1 `ProviderProfile` (opcional).
- `InquilinoCredential` 1-1 `Person` (rol inquilino).
