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

## Inmobiliaria y usuarios

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| POST | `/tenants` | Crea una inmobiliaria. | Público |
| GET | `/tenants/me` | Datos de la inmobiliaria de la sesión. | Autenticado |
| PATCH | `/tenants/:id` | Edita nombre, provincia, colores de marca y logo. | Admin, Gerente |
| GET | `/users` | Usuarios de la inmobiliaria. | Admin, Gerente |
| POST | `/users/invite` | Invita a un usuario con un rol asignado. | Admin, Gerente |
| POST | `/users/accept-invitation` | Acepta la invitación y define la contraseña. | Público |
| PATCH | `/users/me` | Edita los datos propios. | Autenticado |
| PATCH | `/users/:id/role` | Cambia el rol de un usuario. | Admin |
| PATCH | `/users/:id/deactivate` | Desactiva un usuario. | Admin |
| GET | `/audit-logs` | Traza de las operaciones sensibles, con filtros. | Admin, Gerente |

## Propiedades

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/properties` | Listado paginado y filtrable. | Autenticado |
| GET | `/properties/:id` | Detalle con operaciones, media y personas vinculadas. | Autenticado |
| POST | `/properties` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/properties/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/properties/:id` | Baja. | Admin, Gerente |
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

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/persons` | Listado paginado y filtrable. | Autenticado |
| GET | `/persons/:id` | Detalle con roles, documentos e historial. | Autenticado |
| POST | `/persons` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/persons/:id` | Edición. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id` | Baja. | Admin, Gerente |
| POST | `/persons/:id/roles` | Asigna un rol —propietario, inquilino, garante, proveedor, comprador— opcionalmente ligado a una propiedad o un contrato. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id/roles/:roleId` | Quita una asignación de rol. | Admin, Gerente, Ventas |
| POST | `/persons/:id/documents` | Sube un documento. Multipart, campo `file`. | Admin, Gerente, Ventas |
| DELETE | `/persons/:id/documents/:docId` | Borra un documento. | Admin, Gerente, Ventas |
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

| Método | Ruta | Para qué | Acceso |
|---|---|---|---|
| GET | `/contracts` | Listado filtrable. | Autenticado |
| GET | `/contracts/:id` | Detalle con partes, garantías, ajustes y comisión. | Autenticado |
| POST | `/contracts` | Alta. | Admin, Gerente, Ventas |
| PATCH | `/contracts/:id` | Edición. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/terminate` | Rescinde el contrato y produce el resumen de cierre. | Admin, Gerente |
| GET | `/contracts/:id/adjustments` | Cronograma de ajustes. | Autenticado |
| POST | `/contracts/:id/adjustments/calculate` | Calcula el ajuste pendiente. | Admin, Gerente, Ventas |
| POST | `/contracts/:id/adjustments/:adjId/apply` | Aplica un ajuste calculado. | Admin, Gerente |
| POST | `/contracts/:id/preview-adjustment` | Simula un ajuste sin persistirlo. | Admin, Gerente |
| GET | `/contracts/:id/available-templates` | Plantillas aplicables al contrato. | Admin, Gerente, Ventas |
| GET | `/contracts/:id/template-variables` | Variables que la plantilla puede interpolar. | Admin, Gerente, Ventas |
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
| GET | `/index-data/latest` | Último valor de cada índice. | Admin, Gerente |
| POST | `/index-data` | Carga manual de un valor. | Admin |
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
| GET | `/liquidaciones/:id` | Detalle con líneas y pagos. | Autenticado |
| GET | `/liquidaciones/:id/pdf` | Comprobante en PDF. | Autenticado |
| POST | `/liquidaciones/generate` | Genera las liquidaciones de todos los contratos activos del período. | Admin, Gerente, Liquidaciones |
| POST | `/liquidaciones/:id/transition` | Cambia el estado. Ante un estado inválido devuelve las transiciones posibles. | Admin, Gerente, Liquidaciones |
| POST | `/liquidaciones/bulk-approve` | Aprueba en lote. | Admin, Gerente |
| POST | `/liquidaciones/bulk-send` | Envía en lote. | Admin, Gerente |
| POST | `/liquidaciones/:id/line-items` | Agrega una línea. | Admin, Gerente, Liquidaciones |
| PATCH | `/liquidaciones/:id/line-items/:lineItemId` | Edita una línea. | Admin, Gerente, Liquidaciones |
| DELETE | `/liquidaciones/:id/line-items/:lineItemId` | Quita una línea. | Admin, Gerente, Liquidaciones |
| GET | `/liquidaciones/:id/payments` | Pagos imputados. | Autenticado |
| POST | `/liquidaciones/:id/payments` | Registra un pago e imputa el saldo. | Admin, Gerente, Liquidaciones |
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
| POST | `/renditions/generate` | Genera la rendición de un contrato y período. | Admin, Gerente, Liquidaciones |
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
| POST | `/invoices/emit` | Emite una factura A, B o C. | Admin, Gerente, Liquidaciones |
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
