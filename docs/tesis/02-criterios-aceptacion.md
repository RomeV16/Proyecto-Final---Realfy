# Criterios de Aceptación

Criterios organizados por módulo. Se utilizan como referencia durante el desarrollo y como guía para las pruebas integrales con Playwright.

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
- Al firmar el contrato la propiedad asociada pasa automáticamente al estado alquilada.
- Las garantías cargadas se pueden listar y el contrato no puede activarse sin al menos una garantía válida (salvo excepción habilitada).
- Al renovar un contrato, el sistema clona partes y garantías pero exige nueva confirmación de los valores.

## Liquidaciones

- La generación de una liquidación crea una entrada por cada concepto configurado (alquiler, expensas, servicios, impuestos, honorarios).
- El monto de alquiler refleja el último ajuste aplicado al período liquidado.
- Una liquidación no puede modificarse si ya tiene comprobante ARCA emitido; solo se admite anulación con nota de crédito.
- El sistema impide generar dos liquidaciones para el mismo contrato y período.
- El total de la liquidación equivale a la suma de sus líneas, sin discrepancias por redondeo mayor a un centavo.

## Pagos

- Un pago puede ser total o parcial; el saldo restante queda como deuda imputable.
- Un pago no puede ser mayor al saldo pendiente de la liquidación.
- Cada pago queda asociado a un medio de pago (efectivo, transferencia, otro) y a un usuario que lo registra.
- El registro de un pago actualiza inmediatamente el estado de morosidad del contrato.
- Los pagos eliminados quedan en auditoría con el motivo y el usuario.

## Tickets

- Un ticket abierto desde el portal del inquilino aparece en el backlog del agente en menos de un minuto.
- Los tickets pueden tener uno o más comentarios y archivos adjuntos.
- Al asignar un proveedor, el ticket cambia a estado en curso y se envía notificación.
- Un ticket cerrado no admite nuevos comentarios públicos para el inquilino, salvo reapertura.
- La categoría del ticket es obligatoria.

## Portal inquilino

- El inquilino solo accede a información del contrato y las propiedades donde figura como parte.
- La descarga de un comprobante exige que el comprobante tenga CAE válido.
- Las credenciales del portal son independientes de las credenciales del sistema interno.
- El inquilino puede actualizar sus datos de contacto, no los datos del contrato.
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
- Al convertir un lead en contrato, sus datos personales se transfieren a la entidad `Person`.
- Un lead descartado se conserva con motivo de descarte y queda fuera de reportes activos.
