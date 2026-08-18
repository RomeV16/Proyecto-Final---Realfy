# Guion de la demostración

Recorrido para la defensa, en el orden en que conviene mostrarlo. La secuencia
sigue el circuito real de una inmobiliaria —de la consulta de un interesado a la
rendición al propietario— y deja para el final las dos cosas que no se ven en una
pantalla pero sí se pueden mostrar: el aislamiento entre inmobiliarias y el
control de acceso por rol.

## Antes de empezar

### Accesos

Los usuarios y las contraseñas del ambiente de demostración **no están en este
repositorio** y no deben estarlo: es público. Se preparan aparte, en una hoja que
se lleva a la defensa.

Lo que sí conviene fijar de antemano es con qué roles hay que entrar. El
recorrido necesita cinco accesos:

| Acceso | Para qué parte |
|---|---|
| Admin | Casi todo el recorrido. Es el único rol que llega a la configuración fiscal. |
| Liquidaciones | Mostrar que el circuito de cobranzas funciona con un rol acotado, no solo con el administrador. |
| Soporte | La atención del reclamo. |
| Lectura | El cierre sobre control de acceso: la misma pantalla sin acciones disponibles. |
| Dos inquilinos del portal | Uno al día y otro con deuda, para mostrar el portal en las dos situaciones. |

Además, un acceso de Admin de una **segunda inmobiliaria**, con datos propios,
para la parte de aislamiento.

### Estado del ambiente

El repositorio no incluye una carga inicial de datos: el ambiente se arma desde
la propia aplicación, y eso lleva tiempo, así que hay que tenerlo listo antes.
Para que el recorrido no se trabe, la inmobiliaria de ejemplo tiene que llegar a
la defensa con:

- Una decena de propiedades cargadas, varias con fotos, en distintos estados de
  operación, y al menos una publicada en el micrositio.
- Propietarios, inquilinos y garantes, y al menos una persona con dos roles a la
  vez, para mostrar el modelo de personas.
- Tres o cuatro contratos vigentes con distintos tipos de ajuste, con sus
  garantías y su comisión cargada. Uno de ellos con un ajuste programado que caiga
  en el período que se va a mostrar.
- Liquidaciones de meses anteriores ya cerradas y pagadas, para que los reportes y
  el panel tengan de dónde calcular.
- Una liquidación vencida sin pagar, con su punitorio acumulado, para la pantalla
  de morosos.
- Un reclamo abierto y otro en curso con proveedor asignado.
- Un par de leads en distintas etapas del embudo.
- La configuración fiscal cargada, con `ARCA_MOCK` activo, salvo que se demuestre
  contra el ambiente de homologación del organismo.
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

### 3. Propiedades y personas

En Propiedades, mostrar el listado y entrar a una propiedad con fotos: la galería,
las operaciones con su precio y su estado, el historial de precios y las
tasaciones con sus comparables de la propia cartera.

Dar de alta una propiedad nueva en vivo, con lo mínimo, y subir una foto. Alcanza
para mostrar que el procesamiento de imágenes es del servidor —original y
miniatura— y que no hay una carpeta de archivos escondida en el servidor de la
aplicación.

En Personas, entrar a la persona que tiene dos roles y mostrar que el mismo
registro es propietario de un inmueble e inquilino de otro. Es el punto donde el
modelo de datos se justifica solo.

### 4. Contrato

Abrir un contrato vigente y recorrer el detalle: las partes con su rol, las
garantías, el cronograma de ajustes y la comisión pactada.

Generar el documento del contrato a partir de una plantilla. Mostrar que las
variables se resuelven con los datos reales del contrato.

### 5. Ajuste por índice

Sobre el contrato que tiene el ajuste programado en el período, calcular el ajuste
y aplicarlo. Vale detenerse un momento en que el índice se consume como variación
del período y no como nivel absoluto: es la decisión de dominio más delicada del
módulo y confundirla produce factores sin sentido.

### 6. Liquidación del mes

En Liquidaciones, *Generar Mes*. La acción no trabaja contrato por contrato:
produce las liquidaciones de todos los contratos activos del período e informa
cuántas generó y cuántas omitió porque ya existían. Es la operación que abre el
mes.

Entrar a una liquidación, mostrar sus líneas —alquiler, ajuste, extras—, agregar
una línea manual, aprobarla y descargar el comprobante en PDF.

Acá conviene cambiar de sesión y entrar con el acceso de **Liquidaciones** para
mostrar el mismo circuito con un rol acotado: puede generar, editar líneas,
transicionar y registrar pagos, pero la aprobación en lote no le aparece.

### 7. Registrar un pago

Sobre la liquidación aprobada, registrar el pago con su medio y su referencia.
Mostrar cómo se imputa y cómo queda el saldo; si se registra un pago parcial, la
liquidación queda con su saldo a la vista.

Pasar a Pagos para ver la mirada agregada: deuda pendiente, deuda vencida y los
pagos recientes.

### 8. Morosidad y punitorios

En Morosos está el contrato con la liquidación vencida, con su deuda, su multa
acumulada y sus días de atraso. Mostrar el punitorio y condonarlo con motivo, que
es una operación exclusiva de Admin.

Vale aclarar que el cálculo lo hace una tarea programada según los parámetros de
la inmobiliaria, no la pantalla.

### 9. Comprobante electrónico

Mostrar primero la configuración fiscal: el certificado cargado, los emisores
—propios y delegados— y sus puntos de venta sincronizados. Aclarar que la clave
privada del certificado se guarda cifrada y que la clave maestra se valida recién
cuando se la necesita, de modo que una inmobiliaria que no factura
electrónicamente no depende de una configuración que no le corresponde.

Emitir una factura desde el asistente: emisor, receptor —con la consulta de padrón
por CUIT—, ítems, vista previa y confirmación. Mostrar el CAE que devuelve el
organismo y descargar el PDF.

Después, emitir la nota de crédito contra ese comprobante, para mostrar que la
anulación es fiscal y no un borrado.

Si la demostración corre contra el simulador, decirlo explícitamente: es más
sólido aclararlo que dejar que lo pregunten.

### 10. Rendición al propietario

Generar la rendición del contrato y el período. Mostrar el detalle: lo cobrado,
la comisión pactada descontada, los conceptos deducidos discriminados y el
depósito neto que recibe el propietario. Descargar el PDF y enviarlo por correo.

Es el módulo que cierra el circuito del dinero, y el que muestra mejor la
integración: la rendición no se carga a mano, se alimenta de los pagos registrados
y de la comisión del contrato.

### 11. El reclamo, de punta a punta

Esta parte se hace en dos ventanas, porque se cruzan dos ámbitos.

Entrar al portal con el acceso del inquilino **con deuda** y abrir un reclamo con
un adjunto. Mostrar de paso el resto del portal: su contrato, sus facturas con el
aviso de saldo pendiente y el PDF de cada una.

Volver a la aplicación interna con el acceso de **Soporte**: el reclamo está en el
listado de tickets. Asignarle un proveedor de la lista de habilitados por rubro y
zona, transicionar el estado y cargar el costo del trabajo. Mostrar el vencimiento
del acuerdo de nivel de servicio.

Cerrar el círculo volviendo al portal, donde el inquilino ve el estado nuevo de su
reclamo.

### 12. El portal en la otra situación

Entrar con el acceso del inquilino **al día**. Es la misma pantalla y se lee
distinto: sin aviso de deuda, con el próximo vencimiento en lugar del atraso. La
comparación entre los dos accesos es lo que muestra que el portal informa y no
solo lista.

### 13. Reportes e indicadores

En Reportes, generar el estado de cuenta del propietario y la rentabilidad por
propiedad, y descargar uno en Excel y otro en PDF. Mostrar el envío programado.

En el panel, la tendencia de ocupación de los últimos doce meses y la composición
de la cartera. Y de paso, la importación desde planilla: subir un archivo con una
fila inválida a propósito, para mostrar que la validación es previa y fila por
fila, y que el error se informa antes de escribir nada.

### 14. Aislamiento entre inmobiliarias

Entrar con el Admin de la **segunda inmobiliaria**. Las mismas pantallas, datos
completamente distintos.

Es el momento de explicar la decisión: una sola base, una columna de inmobiliaria
en cada tabla, el identificador que sale siempre del token y nunca del pedido, y
una extensión del cliente de base de datos que inyecta el filtro en cada consulta.
Y sobre todo, que esa extensión **falla cerrado**: si por un guard olvidado una
consulta llegara sin inmobiliaria en el contexto, se rechaza en lugar de correr
sin filtro. Antes fallaba abierto, y una consulta sin contexto devolvía las filas
de todas las inmobiliarias sin que nada lo indicara. Está documentado en el
ADR-0006.

### 15. Control de acceso por rol

Entrar con el acceso de **Lectura**. La navegación es la misma —eso es a
propósito, y conviene decirlo— pero las pantallas no ofrecen acciones, y las que
están restringidas informan que no hay permiso. Mostrar dos o tres casos:
Morosos, que es de Admin y Gerente, y una liquidación, que se ve en modo consulta.

El punto a transmitir es que el permiso se aplica en el servidor, endpoint por
endpoint, y que la interfaz refleja esa decisión en lugar de ser ella misma el
control.

### 16. Cierre técnico

Para terminar, tres cosas rápidas que dan contexto de ingeniería sin abrir el
editor:

- El punto de salud de la API (`/api/health`), que responde el estado del servicio
  y de la base.
- La respuesta uniforme de error: forzar un error de validación y mostrar el
  cuerpo con su código y su identificador de traza, aclarando que un error
  inesperado nunca devuelve detalles internos (ADR-0005).
- La integración continua: los cinco trabajos, y en particular el que aplica todas
  las migraciones sobre una base vacía en cada cambio.

## Contingencias

Conviene tener previsto qué hacer si algo falla en vivo.

- **La emisión del comprobante no responde.** Es la parte que depende de un
  servicio externo. Tener a mano un comprobante ya emitido con su CAE y su PDF
  para mostrar el resultado, y explicar el circuito sobre eso.
- **La obtención de índices no trae el valor del período.** El ajuste se puede
  mostrar sobre un contrato con ajuste de porcentaje fijo, que no depende de una
  fuente externa.
- **El envío de correo no sale.** El sistema no se cae si no hay credencial de
  correo configurada: la operación se completa y el envío queda sin hacer. Mostrar
  el PDF descargado en lugar del correo recibido.
- **El ambiente desplegado no responde.** Tener el sistema corriendo también en
  local, con su base propia, como respaldo.

Y una recomendación general: cada paso del recorrido deja datos en el ambiente. Si
se ensaya la demostración completa más de una vez, conviene ensayar sobre una
copia y no sobre el ambiente que se va a mostrar, o al menos saber cuáles son los
registros que se consumen en el ensayo.
