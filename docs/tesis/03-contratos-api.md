# Contratos de API

Catálogo resumido de endpoints REST expuestos por `apps/api`. Todos los endpoints, salvo los de autenticación y los del portal público, requieren JWT en el header `Authorization: Bearer <token>` y se filtran automáticamente por el `tenantId` del usuario autenticado.

Las respuestas siguen un formato uniforme `{ data, meta?, error? }`. Los errores devuelven códigos HTTP estándar y un cuerpo `{ error: { code, message, details? } }`.

## Auth

- `POST /auth/login` — Inicia sesión con email y password. Devuelve `{ accessToken, refreshToken, user }`.
- `POST /auth/refresh` — Rota el refresh token. Devuelve `{ accessToken, refreshToken }`.
- `POST /auth/logout` — Invalida el refresh token recibido.
- `POST /auth/invitations/accept` — Acepta una invitación con token y define password.
- `GET /auth/me` — Datos del usuario actual.

## Users e invitaciones

- `GET /users` — Lista de agentes del tenant.
- `POST /users/invitations` — Crea una invitación con email y rol.
- `DELETE /users/:id` — Desactiva un agente.
- `PATCH /users/:id` — Actualiza nombre, rol o estado.

## Audit logs

- `GET /audit-logs` — Lista paginada de eventos. Filtros por entidad, usuario y rango de fechas.

## Propiedades

- `GET /properties` — Lista paginada con filtros (estado, tipo, propietario).
- `POST /properties` — Alta de propiedad. Devuelve la entidad creada.
- `GET /properties/:id` — Detalle con propietario, media y operaciones.
- `PATCH /properties/:id` — Edición de campos generales.
- `DELETE /properties/:id` — Baja lógica si no hay contratos activos.
- `POST /properties/:id/media` — Sube imágenes (multipart).
- `PATCH /properties/:id/status` — Cambia el estado (disponible, alquilada, fuera de servicio).

## Personas

- `GET /persons` — Lista filtrable por rol y documento.
- `POST /persons` — Alta con datos base y roles iniciales.
- `GET /persons/:id` — Detalle con roles, documentos e historial.
- `PATCH /persons/:id` — Edición.
- `POST /persons/:id/roles` — Asigna un rol nuevo a la persona.
- `POST /persons/:id/documents` — Sube documento asociado.

## Proveedores

- `GET /providers` — Lista de proveedores (personas con rol provider).
- `PATCH /providers/:personId` — Edita el `ProviderProfile`.

## Contratos

- `GET /contracts` — Lista filtrable por estado, propiedad e inquilino.
- `POST /contracts` — Alta de contrato.
- `GET /contracts/:id` — Detalle con partes, garantías y ajustes.
- `PATCH /contracts/:id` — Edición de campos editables.
- `POST /contracts/:id/renew` — Renovación a partir del contrato actual.
- `POST /contracts/:id/guarantees` — Agrega garantía.
- `DELETE /contracts/:id/guarantees/:guaranteeId` — Quita una garantía.
- `POST /contracts/:id/adjustments` — Configura el ajuste.
- `POST /contracts/:id/adjustments/apply` — Aplica el próximo ajuste programado.

## Plantillas de contrato

- `GET /contract-templates` — Lista de plantillas.
- `POST /contract-templates` — Crea plantilla con cuerpo y variables.
- `POST /contracts/:id/generate-document` — Renderiza el contrato a partir de su plantilla.

## Índices

- `GET /index-data` — Lista de valores IPC y UVA por período.
- `POST /index-data` — Carga manual de un valor.
- `POST /index-data/sync` — Dispara la sincronización con fuentes externas (INDEC, BCRA).

## Liquidaciones

- `GET /liquidaciones` — Lista paginada con filtros (contrato, período, estado).
- `POST /liquidaciones` — Genera la liquidación para un contrato y período.
- `GET /liquidaciones/:id` — Detalle con líneas y pagos.
- `POST /liquidaciones/:id/line-items` — Agrega línea manual.
- `DELETE /liquidaciones/:id/line-items/:itemId` — Quita línea.
- `POST /liquidaciones/:id/cancel` — Anula liquidación (si no tiene comprobante).

## Pagos

- `GET /payments` — Lista paginada.
- `POST /payments` — Registra un pago contra una liquidación.
- `DELETE /payments/:id` — Anula un pago con motivo.

## Morosidad y punitorios

- `GET /penalties` — Lista de punitorios calculados.
- `POST /penalties/recalculate` — Recalcula punitorios para una liquidación.
- `POST /contracts/:id/legal-derivation` — Marca el contrato como derivado a legal.

## Rendiciones

- `GET /renditions` — Lista de rendiciones por propietario y período.
- `POST /renditions` — Genera rendición mensual.
- `GET /renditions/:id` — Detalle.

## Tickets

- `GET /tickets` — Lista paginada con filtros.
- `POST /tickets` — Abre ticket.
- `GET /tickets/:id` — Detalle con comentarios y adjuntos.
- `PATCH /tickets/:id` — Cambia estado, prioridad o categoría.
- `POST /tickets/:id/comments` — Agrega comentario.
- `POST /tickets/:id/attachments` — Sube adjunto.
- `POST /tickets/:id/assign-provider` — Asigna proveedor.

## CRM

- `GET /pipelines` — Lista de pipelines configurados.
- `POST /pipelines` — Crea pipeline con etapas.
- `GET /leads` — Lista paginada filtrable por etapa y origen.
- `POST /leads` — Alta de lead.
- `PATCH /leads/:id/stage` — Mueve a otra etapa.
- `POST /leads/:id/interactions` — Registra interacción.
- `POST /leads/:id/visits` — Programa visita.
- `POST /leads/:id/convert` — Convierte lead en `Person` (y opcionalmente abre contrato).

## ARCA

- `GET /invoices/config` — Configuración ARCA del tenant.
- `PATCH /invoices/config` — Actualiza la configuración.
- `POST /invoices/issue` — Emite un comprobante para una liquidación.
- `POST /invoices/:id/void` — Genera nota de crédito.
- `GET /invoices/:id/pdf` — Descarga el PDF del comprobante.

## Scoring y tasaciones

- `GET /scoring/config` — Configuración de scoring.
- `PATCH /scoring/config` — Actualiza criterios.
- `POST /scoring/recalculate/:personId` — Recalcula score de un inquilino.
- `GET /valuations` — Lista de tasaciones.
- `POST /valuations` — Crea tasación.

## Reportes y dashboard

- `GET /dashboard/summary` — KPIs principales del tenant.
- `GET /reports/occupancy` — Ocupación por período.
- `GET /reports/cashflow` — Flujo de caja mensual.

## Importación y exportación

- `POST /import-export/import` — Recibe archivo (CSV/Excel), valida y carga.
- `GET /import-export/exports/:entity` — Exporta entidad en CSV.

## Notificaciones

- `GET /notifications` — Lista de notificaciones del usuario.
- `PATCH /notifications/:id/read` — Marca como leída.

## Portal del inquilino

- `POST /portal/auth/login` — Login del inquilino.
- `POST /portal/auth/refresh` — Refresh token portal.
- `GET /portal/me` — Datos del inquilino.
- `GET /portal/contracts` — Contratos del inquilino.
- `GET /portal/liquidaciones` — Liquidaciones del inquilino.
- `GET /portal/liquidaciones/:id/invoice` — Comprobante.
- `POST /portal/tickets` — Abre ticket.
- `GET /portal/tickets` — Lista de tickets del inquilino.
