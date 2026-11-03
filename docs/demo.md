# Guion de la demostración

Recorrido para la defensa, en el orden en que conviene mostrarlo. La secuencia
sigue el circuito real de una inmobiliaria —de la consulta de un interesado al
estado de cuenta del locador— y deja para el final las dos cosas que no se ven en
una pantalla pero sí se pueden mostrar: el aislamiento entre inmobiliarias y el
control de acceso por rol.

Desde el piloto el circuito es más largo: el mes se prepara con boletas y cargos,
el cobro llega por tres caminos y termina en la cuenta corriente de cada locador,
y alrededor del contrato aparecen los vencimientos, los depósitos, los honorarios,
las incidencias, la mensajería, la cobranza, la publicación y las ventas. El
recorrido completo lleva más tiempo del que suele haber en una defensa; la sección
«Versión corta» dice qué pasos conservar si hay que recortar.

## Antes de empezar

### Qué ambiente se muestra

La demostración se hace en el ambiente `production`, que tiene **solo datos
inventados**. El ambiente `piloto` tiene los datos reales de la inmobiliaria
piloto y **no se muestra** en la defensa: ni en vivo, ni en capturas, ni en
diapositivas. Los resultados del piloto se presentan con las cifras agregadas del
informe final, y solo si la inmobiliaria dio su consentimiento
(`tesis/29-informe-final.md`, sección 9).

### Accesos

Los usuarios y las contraseñas del ambiente de demostración **no están en este
repositorio** y no deben estarlo: es público. Se preparan aparte, en una hoja que
se lleva a la defensa.

Lo que sí conviene fijar de antemano es con qué roles hay que entrar. El
recorrido necesita estos accesos:

| Acceso | Para qué parte |
|---|---|
| Admin | Casi todo el recorrido. Es el único rol que llega a la configuración fiscal, a los permisos y a los valores por defecto. |
| Liquidaciones | Mostrar que el circuito del mes —boletas, liquidaciones, cobros y estados de cuenta— funciona con un rol acotado. |
| Ventas | Vencimientos, ventas y llaves. |
| Soporte | La atención del reclamo y la reparación. |
| Lectura | El cierre sobre control de acceso: menú reducido y pantallas sin acciones. |
| Dos inquilinos del portal | Uno al día y otro con deuda, para mostrar el portal en las dos situaciones. |

Además, un acceso de Admin de una **segunda inmobiliaria**, con datos propios,
para la parte de aislamiento.

### Estado del ambiente

El repositorio no incluye una carga inicial de datos: el ambiente se arma desde
la propia aplicación o con la importación, y eso lleva tiempo, así que hay que
tenerlo listo antes. Todos los nombres, documentos, domicilios e importes son
inventados. Para que el recorrido no se trabe, la inmobiliaria de ejemplo tiene
que llegar a la defensa con:

- Una decena de propiedades cargadas, varias con fotos, en distintos estados de
  operación, al menos una publicada en el micrositio y con su estado cargado en
  un portal, y una con titulares que no coinciden con los locadores del contrato.
- Locadores, inquilinos, garantes y un apoderado, y al menos una persona con dos
  roles a la vez.
- Tres o cuatro contratos vigentes con distintos tipos de ajuste: uno con **dos
  locadores** que cobran 60 % y 40 %; uno con un ajuste del mes por IPC con rezago;
  uno con flujo de cobro *Todo al locador*, y uno que **termine dentro de los
  próximos 60 días**, para que aparezca en Vencimientos. Al menos uno con su
  depósito cargado y su honorario de alta.
- Reglas de impuestos y servicios en un contrato, con una boleta que pague el
  inquilino y otra que pague el locador, y un cargo pendiente en el centro de
  carga.
- Liquidaciones de meses anteriores ya cerradas y cobradas, para que los reportes,
  la cuenta corriente y el panel tengan de dónde calcular, y un estado de cuenta
  del mes anterior emitido.
- Una liquidación vencida sin pagar, con su punitorio acumulado, para Morosos y
  Cobranza; la cobranza escalonada activada en *Valores por defecto* y un caso
  abierto.
- Un reclamo abierto y una reparación con presupuesto pendiente de aprobación.
- Una operación de venta con una reserva, y un juego de llaves fuera de la oficina.
- Dos personas cargadas dos veces a propósito (mismo documento), para el panel de
  calidad de datos.
- Un par de leads en distintas etapas del embudo.
- La configuración fiscal cargada, con `ARCA_MOCK` activo, salvo que se demuestre
  contra el ambiente de homologación del organismo, y un emisor delegado para uno
  de los locadores.
- La mensajería en modo `allowlist`, con las direcciones del equipo en la lista, o
  en `off`, según lo que se quiera mostrar (ver el paso 14), y un par de consultas en
  la bandeja de consultas: una del formulario del micrositio y una llamada anotada.
- Dos accesos al portal ya activados, uno por cada situación de deuda.

La segunda inmobiliaria alcanza con dos o tres propiedades y un contrato: solo
tiene que existir y ser distinta.

Conviene también dejar la pestaña del micrositio público abierta de antemano y
tener a mano el dominio de la API para el punto de salud.

## Recorrido

### 1. La puerta de entrada: el micrositio público

Abrir `/p/<slug>` **sin ninguna sesión**. Mostrar que la inmobiliaria tiene su
catálogo público con sus colores y su logo, filtrar por operación y ciudad, entrar
a la ficha de una propiedad y enviar una consulta desde el formulario.

Es un buen arranque porque no requiere explicar nada todavía y porque abre un
círculo que se cierra en el paso siguiente: esa consulta va a aparecer como lead
dentro del sistema.

### 2. Ingreso y panel

Entrar como Admin. El panel es la pantalla que resume el estado de la cartera:
la masa de alquileres, la tendencia de facturación, las fichas de ocupación,
cobranzas, morosidad y tickets.

Lo que conviene destacar acá no son los números sino la sección de lo que requiere
atención: contratos por vencer, cobranzas pendientes y tickets prioritarios, cada
uno con acceso directo al registro. La idea a transmitir es que el panel es una
lista de tareas y no un tablero decorativo.

Mostrar de paso que el lead de la consulta del paso 1 ya está en el embudo.

### 3. Propiedades, personas y titulares

En Propiedades, mostrar el listado y entrar a una propiedad con fotos: la galería,
las operaciones con su precio y su estado, el historial de precios, las
tasaciones y la sección de **titulares**.

Dar de alta una propiedad nueva en vivo, con lo mínimo, y subir una foto. Alcanza
para mostrar que el procesamiento de imágenes es del servidor —original y
miniatura— y que no hay una carpeta de archivos escondida en el servidor de la
aplicación.

En Personas, entrar a la persona que tiene dos roles, y después a un locador:
datos de identidad, forma de cobro, varias cuentas bancarias y poderes. Es el
lugar para explicar la decisión que más cambió el modelo con el piloto: **el
locador no es necesariamente el propietario**. La titularidad es de la propiedad;
el locador y su porcentaje de cobro son del contrato (ADR-0007).

### 4. Contrato: partes y reglas

Abrir el contrato con dos locadores y recorrer el detalle: los locadores con su
porcentaje, el apoderado, las garantías, el cronograma de ajustes y la comisión
pactada. Mostrar que el contrato no se puede activar si los locadores no suman
100 %.

Pasar a *Reglas vigentes*: vencimiento, punitorio, flujo de cobro, rezago del
índice, prorrateo. Cada regla dice si viene del valor por defecto de la
inmobiliaria o del contrato, y los cambios posteriores son **acuerdos con fecha**
que no reescriben la historia (ADR-0010). Es la respuesta a lo que mostró el
relevamiento: casi todo es pactable.

Generar el documento del contrato a partir de una plantilla. Mostrar que las
variables se resuelven con los datos reales del contrato, incluidos los
locadores.

### 5. Ajustes del mes

En *Ajustes del mes*, mostrar la previsualización de los contratos que ajustan en
el período: el índice usado con el rezago pactado (dos meses por defecto), el
factor y el alquiler nuevo. Vale detenerse en dos cosas: que el índice se consume
como variación del período y no como nivel absoluto, y que si el INDEC todavía no
publicó un mes, el ajuste se marca como provisorio y se corrige cuando sale el dato
(ADR-0011). Aplicar los ajustes elegidos.

### 6. Boletas, cargos y liquidación del mes

En *Boletas del mes*, mostrar la carga tipo planilla: una fila por servicio, con
quién paga según la regla del contrato, y que se puede pegar desde una planilla de
cálculo. En *Centro de carga*, mostrar el cargo pendiente imputado al inquilino o al
locador.

En Liquidaciones, *Generar Mes*. La acción produce las liquidaciones de todos los
contratos activos del período e informa cuántas generó y cuántas omitió. Entrar a
una liquidación y mostrar sus renglones con **destino**: el alquiler, la parte de
cada boleta que le toca al inquilino, el cargo y el punitorio pendiente, y cuáles
son comisionables. Aprobarla y descargar el recibo en PDF, con número y monto en
letras.

Acá conviene cambiar de sesión y entrar con el acceso de **Liquidaciones** para
mostrar el mismo circuito con un rol acotado.

### 7. El cobro por tres caminos

Sobre la liquidación aprobada, *Registrar Pago*. El formulario pregunta **quién
recibió el dinero**: es el punto donde el modelo original no alcanzaba. Mostrar
dos casos:

- *Recibió: la inmobiliaria*, en efectivo, marcando que la parte de los locadores
  queda en **custodia**. Se emite el recibo de cobro numerado y el reparto queda a la
  vista: comisión, entes y la parte de cada locador según su porcentaje.
- En el contrato con flujo *Todo al locador*, *Recibió: el locador*. No entra nada
  a la caja, y la cuenta corriente del locador queda con lo que le debe a la
  inmobiliaria.

En *Caja*, mostrar las cuentas por moneda, la custodia separada del total de la
inmobiliaria y el libro de movimientos que se escribió solo. Si hay tiempo, cargar
una compensación entre locadores. La secuencia completa de los flujos está en
`tesis/30-piloto.md`, «Flujos de cobro y compensación».

### 8. Morosidad, punitorios y cobranza

Volver a la sesión de Admin: Morosos es de Admin y Gerente. Ahí está el contrato
con la liquidación vencida, con su deuda, su multa acumulada y sus días de atraso. Mostrar el punitorio y condonarlo con motivo, que
es una operación exclusiva de Admin.

En *Cobranza*, abrir el caso del mismo contrato: la etapa, los recordatorios en la
línea de tiempo y el borrador de la carta documento en PDF, con la marca de
borrador. Lo que conviene decir es lo que el sistema **no** hace: no manda la
carta ni deriva al abogado; eso lo decide una persona. Y que la cobranza viene
apagada de fábrica.

### 9. Cuenta corriente y estado de cuenta del locador

En *Locadores*, entrar al locador del contrato repartido: su cuenta corriente con
cada cobro, comisión, cargo y pago, y el saldo después de cada movimiento. En
*Estados de cuenta*, generar el mes y abrir el borrador: **todas sus unidades**, el
saldo que viene del mes anterior y el neto a transferir. Emitirlo y descargar el
PDF.

Es el documento que la inmobiliaria piloto arma a mano cada mes y el que reemplaza
a la rendición por contrato, que queda como histórico (ADR-0009). Si se pregunta por
la exactitud, este es el momento de mencionar la suite de reconciliación (paso 18).

### 10. Comprobante electrónico

Mostrar primero la configuración fiscal: el certificado cargado, los emisores
—propios y delegados— y sus puntos de venta sincronizados. Aclarar que la clave
privada del certificado se guarda cifrada.

Emitir una factura propia desde el asistente y la nota de crédito contra ella,
para mostrar que la anulación es fiscal y no un borrado. Después, desde el cobro
del paso 7 o desde el estado de cuenta del paso 9, *Facturar por cuenta del
locador*: la factura sale con el emisor delegado del locador, al inquilino, por la
parte del locador (ADR-0017). Repetir la acción no emite otra.

Si la demostración corre contra el simulador, decirlo explícitamente: es más
sólido aclararlo que dejar que lo pregunten. Y que los criterios fiscales de la
facturación por cuenta del locador están pendientes de confirmación del contador.

### 11. Vencimientos, depósito y honorarios

Entrar con el acceso de **Ventas** a *Vencimientos*: el contrato que termina en los
próximos 60 días aparece con su semáforo y su seguimiento. Abrirlo, asignárselo y
marcar un paso del checklist.

Volver como Admin al contrato y mostrar, en la tarjeta *Vencimiento*, las dos
salidas que deciden Admin y Gerente: la **prórroga de palabra**, que carga un fin
real sin cambiar el pactado, y la **renovación** como un período nuevo del mismo
contrato. Después, la tarjeta del depósito, con su moneda, quién lo guarda y sus
cuotas, y la vista previa de la **liquidación de egreso**, que trae lo que el
inquilino debe a la fecha y lo descuenta del depósito. No hace falta confirmarla.
En *Honorarios*, mostrar el honorario de alta del contrato con sus cuotas.

### 12. El reclamo y la reparación, de punta a punta

Esta parte se hace en dos ventanas, porque se cruzan dos ámbitos.

Entrar al portal con el acceso del inquilino **con deuda** y abrir un reclamo con
un adjunto. Mostrar de paso el resto del portal: su contrato, sus facturas con el
aviso de saldo pendiente y el PDF de cada una.

Volver a la aplicación interna con el acceso de **Soporte**: el reclamo está en el
listado de tickets. Asignarle un proveedor de la lista de habilitados por rubro y
zona y transicionar el estado. Después, en la reparación preparada de antemano,
mostrar el circuito de la incidencia: preautorización, presupuesto, aprobación,
pago al proveedor e **imputación** al inquilino o al locador, que termina como
cargo en el centro de carga del paso 6.

Cerrar el círculo volviendo al portal, donde el inquilino ve el estado nuevo de su
reclamo.

### 13. El portal en la otra situación

Entrar con el acceso del inquilino **al día**. Es la misma pantalla y se lee
distinto: sin aviso de deuda, con el próximo vencimiento en lugar del atraso. La
comparación entre los dos accesos es lo que muestra que el portal informa y no
solo lista.

### 14. Mensajería

En *Configuración → Mensajería*, mostrar el modo de envío del ambiente —apagado,
lista de prueba o activo— y los proveedores configurados. En *Mensajería*, la
bandeja de salida: los recordatorios del paso 8 y el envío del estado de cuenta del
paso 9 están ahí, con su estado y su motivo. En la ficha de una persona, la
tarjeta de **consentimiento** por canal.

Después, la **bandeja de consultas** (`/bandeja`): la consulta que se envió desde el
micrositio en el paso 1 está ahí junto con la llamada anotada, cada una con su
canal, su responsable y la cuenta regresiva del plazo de primera respuesta.
Tomar una, vincularla con la persona y responderla; la respuesta y la
autorrespuesta salen por la misma bandeja de salida.

El punto a transmitir es que nada sale hacia afuera sin pasar por la bandeja de
salida, que un envío fallido no deshace la operación que lo originó y que en el
ambiente piloto la mensajería está apagada hasta que la inmobiliaria apruebe los
envíos (ADR-0013).

### 15. Publicación, ventas y llaves

En la ficha de la propiedad publicada, la tarjeta **Publicación**: el estado del
aviso en cada portal y *Copiar aviso*, que arma el texto sin datos de personas.
Mostrar el mismo inmueble en el micrositio.

En *Ventas*, la operación con su reserva: las partes, la documentación del inmueble
y el paso a boleto. En *Llaves fuera*, el juego que salió, con quién lo tiene y
desde cuándo.

### 16. Datos: importación, calidad y reportes

En *Calidad de datos*, mostrar la tarjeta de personas repetidas con las dos
personas cargadas dos veces y la unión auditada. Es la herramienta con la que se
revisó la carga de la cartera del piloto, y el lugar para explicar que la
importación desde el sistema anterior es **idempotente**: se puede reenviar el lote
corregido sin duplicar nada (ADR-0015). Mostrar también la importación desde
planilla con una fila inválida a propósito, para mostrar que la validación es previa
y fila por fila.

En Reportes, generar la rentabilidad por propiedad y descargar un reporte en Excel
y otro en PDF. En el panel, la tendencia de ocupación de los últimos doce meses.

### 17. Aislamiento entre inmobiliarias

Entrar con el Admin de la **segunda inmobiliaria**. Las mismas pantallas, datos
completamente distintos.

Es el momento de explicar la decisión: una sola base, una columna de inmobiliaria
en cada tabla, el identificador que sale siempre del token y nunca del pedido, y
una extensión del cliente de base de datos que inyecta el filtro en cada consulta.
Y sobre todo, que esa extensión **falla cerrado**: si por un guard olvidado una
consulta llegara sin inmobiliaria en el contexto, se rechaza en lugar de correr
sin filtro. Está documentado en el ADR-0006, y desde el piloto también lo cumplen
los procesos programados, que recorren las inmobiliarias una por una.

### 18. Control de acceso por rol

Entrar con el acceso de **Lectura**. El menú es más corto: desde el piloto la
navegación se filtra por rol, y no aparecen Morosos, Reportes, Ajustes, Boletas,
Importación, Calidad de datos ni la configuración de usuarios y permisos. Las
pantallas que sí ve no ofrecen acciones. Mostrar como Admin la
pantalla de *Permisos de lectura*, donde la inmobiliaria decide qué datos sensibles
ve cada rol.

El punto a transmitir es que el permiso se aplica en el servidor, endpoint por
endpoint, y que la interfaz refleja esa decisión en lugar de ser ella misma el
control.

### 19. Cierre técnico

Para terminar, cuatro cosas rápidas que dan contexto de ingeniería sin abrir el
editor:

- El punto de salud de la API (`/api/health`), que responde el estado del servicio
  y de la base.
- La respuesta uniforme de error: forzar un error de validación y mostrar el
  cuerpo con su código y su identificador de traza (ADR-0005).
- La integración continua: los nueve trabajos, en particular el que aplica todas
  las migraciones sobre una base vacía y las ensaya sobre datos sintéticos.
- La **suite de reconciliación**: un mes sintético con la forma de la cartera real
  que se compara al centavo contra lo calculado a mano en cada cambio, y que
  encontró cuatro defectos antes del primer ciclo (`pruebas.md`).

## Versión corta

Si hay que recortar, el recorrido que conserva la historia del trabajo es: 1
(micrositio), 4 (contrato con dos locadores y reglas), 6 (liquidación), 7 (cobro
por tres caminos), 9 (estado de cuenta del locador), 17 (aislamiento), 18 (roles) y
el punto de reconciliación del 19. El resto se muestra si el tribunal pregunta.

## Contingencias

Conviene tener previsto qué hacer si algo falla en vivo.

- **La emisión del comprobante no responde.** Es la parte que depende de un
  servicio externo. Tener a mano un comprobante ya emitido con su CAE y su PDF
  para mostrar el resultado, y explicar el circuito sobre eso.
- **La obtención de índices no trae el valor del período.** Es el caso que el
  ajuste provisorio resuelve: mostrarlo como tal. Si no, el ajuste se muestra sobre
  un contrato de porcentaje fijo, que no depende de una fuente externa.
- **Un mensaje no sale.** El sistema no se cae si no hay credencial de correo o de
  WhatsApp, o si el modo es *apagado*: la operación se completa y el mensaje queda
  en la bandeja con su motivo. Mostrar la bandeja y el PDF descargado.
- **El ambiente desplegado no responde.** Tener el sistema corriendo también en
  local, con su base propia y los mismos datos inventados, como respaldo. Nunca
  recurrir al ambiente `piloto`.

Y una recomendación general: cada paso del recorrido deja datos en el ambiente. Si
se ensaya la demostración completa más de una vez, conviene ensayar sobre una
copia y no sobre el ambiente que se va a mostrar, o al menos saber cuáles son los
registros que se consumen en el ensayo.
