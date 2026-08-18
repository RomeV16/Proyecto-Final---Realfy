# Contratos de API

Catálogo resumido de los endpoints REST expuestos por `apps/api`. El detalle
completo —todas las rutas, los roles habilitados en cada una y la forma de la
respuesta de error— está en `docs/api.md`; acá se describe la organización
general y los endpoints principales de cada módulo.

Todas las rutas cuelgan del prefijo global `/api`, fijado en el arranque de la
aplicación. Salvo las de autenticación, las del portal del inquilino y las del
micrositio público, todas requieren un JWT en el header
`Authorization: Bearer <token>` —o en la cookie de sesión— y se filtran
automáticamente por la inmobiliaria del usuario autenticado. El identificador de
la inmobiliaria se toma siempre del token, nunca del cuerpo ni de la query.

Las respuestas exitosas devuelven directamente la entidad o la colección
solicitada, sin envoltorio. Los listados paginados agregan los datos de
paginación al mismo nivel. Los errores, en cambio, sí tienen una forma uniforme
que produce un filtro global de excepciones:

```
{ statusCode, message, error, errorCode, correlationId, timestamp }
```

`message` es un texto, o un arreglo de textos cuando el error viene de la
validación de entrada. `error` y `errorCode` llevan el mismo código —
`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`INTERNAL_ERROR`, o el código de dominio que haya lanzado el servicio—. La
decisión está documentada en el ADR 0005.

El control de acceso por rol se aplica endpoint por endpoint con el decorador
`@Roles`. Los endpoints que no lo declaran quedan disponibles para cualquier
usuario autenticado de la inmobiliaria: en la práctica, la mayoría de las
lecturas están abiertas y las escrituras restringidas.

## Autenticación

- `POST /api/auth/register` — Da de alta una inmobiliaria y su primer usuario, con rol Admin. Límite de 5 intentos por minuto.
- `POST /api/auth/login` — Inicia sesión con email y contraseña. Devuelve el usuario y el par de tokens. Mismo límite.
- `POST /api/auth/refresh` — Rota el token de refresco y emite uno nuevo de acceso.
- `POST /api/auth/logout` — Invalida el token de refresco de la sesión.

Los tokens de refresco no son JWT: son identificadores opacos persistidos en la
tabla `RefreshToken`, y rotan en cada uso.

## Inmobiliaria, usuarios y auditoría

- `GET /api/tenants/me` — Datos de la inmobiliaria de la sesión.
- `PATCH /api/tenants/:id` — Edita nombre, provincia, colores de marca y logo.
- `GET /api/users` — Usuarios de la inmobiliaria.
- `POST /api/users/invite` — Invita a un usuario con un rol asignado.
- `POST /api/users/accept-invitation` — Acepta la invitación y define la contraseña.
- `PATCH /api/users/me` — Edita los datos propios.
- `PATCH /api/users/:id/role` — Cambia el rol de un usuario.
- `PATCH /api/users/:id/deactivate` — Desactiva un usuario.
- `GET /api/audit-logs` — Traza paginada de las operaciones sensibles, con filtros por entidad, usuario y rango de fechas.

## Propiedades

- `GET /api/properties` — Listado paginado con filtros por tipo, operación, estado y ciudad.
- `POST /api/properties` — Alta de propiedad.
- `GET /api/properties/:id` — Detalle con operaciones, media y personas vinculadas.
- `PATCH /api/properties/:id` — Edición.
- `DELETE /api/properties/:id` — Baja.
- `POST /api/properties/:id/operations` — Agrega una operación de alquiler, alquiler temporario o venta.
- `PATCH /api/properties/:id/operations/:opId/state` — Transiciona el estado de la operación.
- `POST /api/properties/:id/media` — Sube una imagen (multipart).
- `PATCH /api/properties/:id/media/reorder` — Reordena la galería.

El estado no se transiciona sobre la propiedad sino sobre cada una de sus
operaciones: una misma propiedad puede estar publicada en venta y alquilada al
mismo tiempo.

## Tasaciones

Cuelgan de la propiedad.

- `GET /api/properties/:propertyId/valuations` — Historial de tasaciones.
- `GET /api/properties/:propertyId/valuations/comparables` — Comparables de la propia cartera por ciudad, tipo y ambientes.
- `POST /api/properties/:propertyId/valuations` — Alta de tasación.

## Personas

- `GET /api/persons` — Listado paginado y filtrable.
- `POST /api/persons` — Alta con los datos base.
- `GET /api/persons/:id` — Detalle con roles, documentos e historial.
- `PATCH /api/persons/:id` — Edición.
- `POST /api/persons/:id/roles` — Asigna un rol —propietario, inquilino, garante, proveedor, comprador—, opcionalmente ligado a una propiedad o un contrato.
- `POST /api/persons/:id/documents` — Sube un documento asociado.
- `POST /api/persons/:id/portal-invite` — Genera la invitación al portal del inquilino.

## Proveedores

- `GET /api/providers` — Listado de proveedores.
- `GET /api/providers/for-ticket/:ticketId` — Proveedores habilitados para un ticket, según rubro y zona.
- `POST /api/providers` — Alta.
- `PATCH /api/providers/:id` — Edita el perfil del proveedor.

## Contratos

- `GET /api/contracts` — Listado filtrable por estado, propiedad, persona y tipo de ajuste.
- `POST /api/contracts` — Alta de contrato con partes, garantías y esquema de ajuste.
- `GET /api/contracts/:id` — Detalle con partes, garantías, cronograma de ajustes y comisión.
- `PATCH /api/contracts/:id` — Edición.
- `POST /api/contracts/:id/terminate` — Rescinde el contrato y produce el resumen de cierre.
- `GET /api/contracts/:contractId/commission` — Comisión pactada.
- `POST /api/contracts/:contractId/commission` — Define la comisión, que es la que determina la rendición al propietario.

No hay un endpoint de renovación ni de alta de garantías por separado: la
renovación se resuelve dando de alta un contrato nuevo, y las garantías se cargan
en el mismo cuerpo del contrato.

## Ajustes de alquiler

- `GET /api/contracts/:id/adjustments` — Cronograma de ajustes del contrato.
- `POST /api/contracts/:id/adjustments/calculate` — Calcula el ajuste pendiente.
- `POST /api/contracts/:id/adjustments/:adjId/apply` — Aplica un ajuste ya calculado.
- `POST /api/contracts/:id/preview-adjustment` — Simula un ajuste sin persistirlo.

## Plantillas de contrato

- `GET /api/contract-templates` — Listado de plantillas.
- `POST /api/contract-templates` — Crea una plantilla con su cuerpo y sus variables.
- `POST /api/contract-templates/seed-defaults` — Carga el juego de plantillas por defecto.
- `GET /api/contracts/:id/available-templates` — Plantillas aplicables al contrato.
- `GET /api/contracts/:id/template-variables` — Variables que la plantilla puede interpolar.
- `POST /api/contracts/:id/generate-document` — Renderiza el documento del contrato.

## Índices

- `GET /api/index-data` — Valores publicados por tipo de índice y período.
- `GET /api/index-data/latest` — Último valor de cada índice.
- `POST /api/index-data` — Carga manual de un valor.
- `POST /api/index-data/bulk` — Carga manual de varios valores.
- `POST /api/index-data/refresh` — Dispara la obtención de los índices desde las fuentes publicadas.

## Servicios de la propiedad

- `GET /api/services` — Listado de servicios asociados a propiedades y contratos.
- `POST /api/services` — Alta.
- `POST /api/services/:id/payments` — Registra el pago de un servicio.

## Liquidaciones

- `GET /api/liquidaciones` — Listado paginado con filtros por estado y período.
- `POST /api/liquidaciones/generate` — Genera las liquidaciones de todos los contratos activos del período indicado.
- `GET /api/liquidaciones/:id` — Detalle con líneas y pagos.
- `GET /api/liquidaciones/:id/pdf` — Comprobante en PDF.
- `POST /api/liquidaciones/:id/transition` — Cambia el estado. Ante una transición inválida devuelve las transiciones posibles.
- `POST /api/liquidaciones/bulk-approve` — Aprueba en lote.
- `POST /api/liquidaciones/bulk-send` — Envía en lote.
- `POST /api/liquidaciones/:id/line-items` — Agrega una línea.
- `DELETE /api/liquidaciones/:id/line-items/:lineItemId` — Quita una línea.

La generación no es por contrato: recibe el período y produce las liquidaciones
de todos los contratos activos, informando cuántas creó y cuántas omitió por ya
existir.

## Pagos

El registro de un pago ocurre siempre contra su liquidación; el módulo de pagos
es de consulta agregada.

- `POST /api/liquidaciones/:id/payments` — Registra un pago e imputa el saldo.
- `GET /api/liquidaciones/:id/payments` — Pagos imputados a la liquidación.
- `GET /api/payments` — Listado de los pagos registrados.
- `GET /api/payments/debt` — Deuda pendiente y vencida de la cartera.

## Morosidad y punitorios

- `GET /api/penalties` — Punitorios calculados.
- `GET /api/penalties/delinquent-tenants` — Inquilinos con liquidaciones vencidas, con deuda y días de atraso.
- `POST /api/penalties/preview` — Simula el punitorio de una liquidación.
- `POST /api/penalties/:id/waive` — Condona una multa, con motivo.
- `POST /api/penalties/run` — Dispara la corrida de cálculo.
- `GET /api/tenants/me/penalty-config` — Parámetros de punitorios de la inmobiliaria.
- `PUT /api/tenants/me/penalty-config` — Actualiza esos parámetros.

## Rendiciones al propietario

- `GET /api/renditions` — Listado por propietario y período.
- `POST /api/renditions/generate` — Genera la rendición de un contrato y período.
- `GET /api/renditions/:id` — Detalle con los conceptos discriminados.
- `GET /api/renditions/:id/pdf` — Rendición en PDF.
- `PATCH /api/renditions/:id/transition` — Cambia el estado.
- `POST /api/renditions/:id/send` — Envía la rendición por correo al propietario.
- `POST /api/renditions/:id/line-items` — Agrega un concepto.

## Comprobantes electrónicos

- `GET /api/invoices` — Listado de comprobantes.
- `GET /api/invoices/:id` — Detalle con CAE y su vencimiento.
- `GET /api/invoices/:id/pdf` — Comprobante en PDF.
- `POST /api/invoices/preview` — Simula la emisión sin enviarla al organismo.
- `POST /api/invoices/emit` — Emite una factura A, B o C.
- `POST /api/invoices/emit-nc` — Emite una nota de crédito.
- `POST /api/invoices/:id/void` — Anula un comprobante por nota de crédito.
- `GET /api/invoices/padron/:cuit` — Consulta de padrón por CUIT.
- `POST /api/invoices/certificate` — Carga el certificado, cuya clave privada se guarda cifrada.
- `GET /api/invoices/issuers` — Emisores dados de alta, propios y delegados.
- `POST /api/invoices/issuers/:id/sync-pdv` — Sincroniza los puntos de venta con el organismo.

La configuración fiscal no es un único endpoint sino tres recursos: el
certificado de la inmobiliaria, sus emisores y los puntos de venta de cada
emisor.

## CRM

- `GET /api/pipelines` — Embudos configurados con sus etapas.
- `POST /api/pipelines` — Crea un embudo.
- `POST /api/pipelines/:id/stages` — Agrega una etapa.
- `PATCH /api/pipelines/:pipelineId/stages/reorder` — Reordena las etapas.
- `GET /api/leads` — Listado paginado y filtrable.
- `POST /api/leads` — Alta de lead.
- `PATCH /api/leads/:id/stage` — Mueve el lead a otra etapa.
- `POST /api/leads/:id/convert` — Convierte el lead en `Person`.
- `POST /api/leads/:id/lose` — Descarta el lead con motivo.
- `POST /api/leads/:leadId/interactions` — Registra una interacción.
- `POST /api/leads/:leadId/visits` — Agenda una visita.
- `POST /api/leads/:leadId/send-email` — Envía un correo al lead a partir de una plantilla.

La conversión produce una `Person`; el contrato se da de alta después, como una
operación aparte.

## Tickets

- `GET /api/tickets` — Listado paginado y filtrable por estado, prioridad, categoría y responsable.
- `POST /api/tickets` — Abre un ticket.
- `GET /api/tickets/:id` — Detalle.
- `PATCH /api/tickets/:id` — Edita el ticket y su responsable.
- `POST /api/tickets/:id/transition` — Cambia el estado según la máquina de estados.
- `POST /api/tickets/:id/assign-provider` — Asigna un proveedor.
- `PATCH /api/tickets/:id/cost` — Carga el costo del trabajo.
- `POST /api/tickets/:id/comments` — Comenta, con archivo adjunto opcional.
- `GET /api/ticket-categories` — Categorías de ticket.

Los adjuntos no tienen endpoint propio: viajan junto al comentario.

## Puntaje de inquilinos

- `GET /api/scoring/config` — Pesos de los componentes del puntaje.
- `PATCH /api/scoring/config` — Actualiza los pesos.
- `GET /api/scoring/persons/:personId` — Puntaje de una persona.
- `PUT /api/scoring/persons/:personId` — Recalcula y guarda el puntaje. El total se computa siempre en el servidor.

## Panel

- `GET /api/dashboard/stats` — Métricas generales de la cartera.
- `GET /api/dashboard/occupancy-trend` — Ocupación de los últimos doce meses.
- `GET /api/dashboard/profitability` — Rentabilidad por propiedad.
- `GET /api/dashboard/cash-flow` — Flujo de caja.
- `GET /api/dashboard/delinquency-rate` — Tasa de morosidad.
- `GET /api/dashboard/fiscal` — Indicadores de facturación electrónica.

## Reportes

El tipo de reporte va en la ruta y acepta `ownerStatement`,
`propertyProfitability`, `cashFlow`, `commissionSummary`, `pipelineAnalytics` y
`morosidad`.

- `GET /api/reports/:type` — Reporte en JSON.
- `GET /api/reports/:type/excel` — El mismo reporte en Excel.
- `GET /api/reports/:type/pdf` — El mismo reporte en PDF.
- `GET /api/report-schedules` — Envíos programados.
- `POST /api/report-schedules` — Programa un envío periódico.

## Importación y exportación

La importación es un circuito de tres pasos y no un único envío del archivo.

- `POST /api/import/upload` — Sube el archivo y devuelve las columnas detectadas.
- `POST /api/import/validate` — Valida fila por fila con el mapeo de columnas elegido.
- `POST /api/import/execute` — Confirma la importación de las filas válidas.
- `GET /api/properties/export/csv` y `GET /api/properties/export/excel` — Exportan propiedades.
- `GET /api/persons/export/csv` y `GET /api/persons/export/excel` — Exportan personas.

## Plantillas de correo

- `GET /api/email-templates` — Listado.
- `POST /api/email-templates` — Alta.
- `PATCH /api/email-templates/:id` — Edición.
- `POST /api/email-templates/:id/preview` — Previsualiza la plantilla con datos reales.

## Notificaciones

- `GET /api/notifications` — Notificaciones del usuario.
- `GET /api/notifications/unread-count` — Cantidad sin leer.
- `PATCH /api/notifications/:id/read` — Marca una como leída.
- `PATCH /api/notifications/mark-all-read` — Marca todas como leídas.
- `POST /api/notifications/run` — Dispara la corrida de generación de avisos.

## Asistencia sobre el modelo de lenguaje

- `GET /api/ai/priorities` — Prioridades del día sobre la cartera.
- `GET /api/ai/contracts/:contractId/closure-summary` — Resumen de gestión del contrato cerrado.
- `POST /api/ai/contracts/:contractId/closure-summary` — Genera ese resumen.

Sin credencial configurada, estas funciones resuelven por sus propias reglas en
lugar de fallar.

## Portal del inquilino

El portal tiene su propio ámbito de autenticación. Sus rutas quedan fuera del
guard general y aplican el suyo, que exige un token del portal; un token del
personal es rechazado acá, y uno del portal es rechazado en el resto de la API.
La identidad del portal no tiene rol: lo que puede ver está delimitado por la
persona a la que pertenece el token.

- `POST /api/portal/auth/login` — Ingreso del inquilino. Límite de 5 intentos por minuto.
- `POST /api/portal/auth/set-password` — Define la contraseña a partir del token de invitación.
- `POST /api/portal/auth/refresh` — Rota el token de refresco del portal.
- `GET /api/portal/contract` — Contratos del inquilino.
- `GET /api/portal/liquidaciones` — Sus liquidaciones.
- `GET /api/portal/liquidaciones/:id/pdf` — Comprobante en PDF.
- `GET /api/portal/tickets` — Sus reclamos.
- `POST /api/portal/tickets` — Abre un reclamo, con adjunto opcional.
- `POST /api/portal/tickets/:id/comments` — Comenta un reclamo.

## Micrositio público

Sin sesión. La inmobiliaria se resuelve por su `slug`, que un guard propio
traduce leyendo por fuera del filtro por inmobiliaria, porque en ese momento no
hay —ni va a haber— contexto de sesión.

- `GET /api/public/:slug` — Perfil público de la inmobiliaria.
- `GET /api/public/:slug/properties` — Propiedades publicadas, filtrables por operación, tipo y ciudad.
- `GET /api/public/:slug/properties/:id` — Ficha de una propiedad publicada.
- `POST /api/public/:slug/inquiries` — Consulta del formulario, que entra como lead. Límite de 10 por minuto.

## Salud

- `GET /api/health` — Estado del servicio y de la conexión a la base. Público, y no se cae si la base no responde: devuelve `degraded`.
