# Criterios de Aceptación

Criterios organizados por módulo. Se utilizan como referencia durante el desarrollo y como guía para las pruebas de extremo a extremo de la API, que son las que verifican estos criterios contra una base real (ver `docs/pruebas.md`).

## Auth

- Dado un usuario con credenciales válidas, cuando ingresa email y contraseña, entonces recibe un token de acceso y uno de refresh con expiración configurada.
- Dado un token de refresh válido, cuando se invoca el endpoint de renovación, entonces se emite un nuevo token de acceso y se invalida el anterior.
- Dado un usuario sin sesión, cuando intenta acceder a un recurso protegido, entonces el sistema responde 401.
- Dado un usuario autenticado en una inmobiliaria, cuando consulta datos de otra, entonces el sistema responde 403 o 404 sin filtrar información.
- Un usuario invitado por email puede registrar su contraseña antes de la expiración del token de invitación.

## Propiedades

- Una propiedad nueva queda con estado disponible al crearse, salvo que se indique lo contrario.
- No se puede crear un contrato sobre una propiedad con estado fuera de servicio.
- Las imágenes cargadas conservan un orden visible y se puede definir la portada.
- Los cambios de estado quedan registrados en la auditoría con usuario y timestamp.
- Una propiedad no puede eliminarse si tiene contratos activos; el sistema lo bloquea con mensaje explicativo.

## Contratos

- Un contrato requiere propiedad disponible, inquilino, fechas de inicio y fin, y monto inicial mayor a cero.
- La modalidad de ajuste debe definirse al alta y queda inmutable salvo modificación explícita con auditoría.
- El estado de disponibilidad vive en la operación de la propiedad y se transiciona sobre ella, no sobre la propiedad ni como efecto automático del alta del contrato.
- Las garantías cargadas se pueden listar y el contrato no puede activarse sin al menos una garantía válida (salvo excepción habilitada).
- La renovación se resuelve dando de alta un contrato nuevo con las mismas partes: el contrato anterior queda en estado Renovado y no hay clonado automático de partes ni de garantías.

## Liquidaciones

- La generación de una liquidación crea la línea de alquiler del período y las líneas que correspondan según los tipos disponibles: alquiler, ajuste, extra, descuento y multa.
- El monto de alquiler refleja el último ajuste aplicado al período liquidado.
- Una liquidación no puede modificarse si ya tiene comprobante ARCA emitido; solo se admite anulación con nota de crédito.
- El sistema impide generar dos liquidaciones para el mismo contrato y período.
- El total de la liquidación equivale a la suma de sus líneas, sin discrepancias por redondeo mayor a un centavo.

## Pagos

- Un pago puede ser total o parcial; el saldo restante queda como deuda imputable.
- Cuando la suma de los pagos alcanza el total de la liquidación, esta pasa sola al estado Pagada.
- Cada pago queda asociado a un medio de pago —transferencia, efectivo, MercadoPago o cheque— y a la liquidación que imputa.
- El pago se registra siempre contra su liquidación; el módulo de pagos es de consulta agregada de cobranzas y deuda.

## Tickets

- Un ticket abierto desde el portal del inquilino aparece de inmediato en el listado de tickets de la inmobiliaria: la apertura es sincrónica, no diferida.
- Los tickets pueden tener uno o más comentarios y archivos adjuntos.
- Al asignar un proveedor, el ticket pasa al estado Proveedor asignado, que es una de las etapas de su máquina de estados.
- Un ticket cerrado no admite nuevos comentarios públicos para el inquilino, salvo reapertura.
- La categoría del ticket es obligatoria.

## Portal inquilino

- El inquilino solo accede a información del contrato y las propiedades donde figura como parte.
- El inquilino descarga el comprobante en PDF de cada una de sus liquidaciones.
- Las credenciales del portal son independientes de las credenciales del sistema interno.
- El inquilino no edita datos desde el portal: los cambios de contacto los hace la inmobiliaria sobre la ficha de la persona.
- Las sesiones expiran y se renuevan mediante refresh token específico del portal.

## ARCA

- La emisión exige que la configuración del tenant (CUIT, punto de venta, certificados) esté validada.
- Una emisión exitosa devuelve CAE, fecha de vencimiento y queda persistida en `Comprobante` ligado a la liquidación.
- Una emisión fallida no genera comprobante y guarda el detalle del error en auditoría.
- Una nota de crédito siempre referencia al comprobante original.
- En ambiente de homologación, los comprobantes se marcan como tales y no se muestran en reportes oficiales.

## CRM

- Un lead pertenece a una sola etapa del pipeline en un momento dado.
- El movimiento de etapa queda registrado en el historial del lead.
- Una visita exige propiedad, lead y fecha futura.
- Al convertir un lead, sus datos personales se transfieren a la entidad `Person`; el contrato se da de alta después, como una operación aparte.
- Un lead descartado se conserva con motivo de descarte y queda fuera de reportes activos.

<!-- Cierre item 02 -->
