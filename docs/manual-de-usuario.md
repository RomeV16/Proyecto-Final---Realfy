# Manual de usuario

Este manual describe cómo se opera Realfy desde la interfaz web. Está organizado
en dos partes: primero qué ve y qué puede hacer cada rol, después los recorridos
completos que una inmobiliaria repite todos los meses. El portal del inquilino y
el sitio público de la inmobiliaria se tratan al final, porque son ámbitos con
acceso propio y no forman parte de la aplicación interna.

Todo lo que se describe acá corresponde a las pantallas que hoy existen en
`apps/web/src/app`. Las rutas se escriben sin el prefijo de idioma: la
aplicación lo agrega siempre, de modo que `/dashboard` se ve en el navegador como
`/es/dashboard`.

## Los dos ámbitos de acceso

Realfy tiene dos sistemas de credenciales que no se cruzan. Los usuarios de la
inmobiliaria (el personal) entran por `/auth/login` y trabajan sobre toda la
cartera. Los inquilinos entran por `/portal/auth/login` y solo ven lo suyo. Un
token emitido para un ámbito es rechazado en el otro, así que no hay forma de
usar la sesión del portal para entrar a la aplicación interna ni al revés.

La primera cuenta de una inmobiliaria se crea en `/auth/register`. Ese formulario
da de alta simultáneamente la inmobiliaria y su primer usuario, que queda con rol
Admin. A partir de ahí las cuentas siguientes no se registran: se invitan desde
la aplicación, y quien recibe la invitación define su contraseña al aceptarla.

## Roles

El sistema tiene siete roles internos, definidos en un único enum
(`packages/shared/src/enums.ts` y el enum `UserRole` del esquema de Prisma). Un
usuario tiene exactamente un rol. Al crearse sin especificar rol, un usuario
queda en Lectura, que es el más restringido.

| Rol | Para quién es |
|---|---|
| Admin | Dueño o socio de la inmobiliaria. Único rol que configura facturación, índices y roles de otros usuarios. |
| Gerente | Responsable operativo. Alcance casi idéntico al de Admin sobre el trabajo diario. |
| Ventas | Agente comercial. Cartera, personas, contratos y embudo de leads. |
| Liquidaciones | Administración y cobranzas. Liquidaciones, pagos, rendiciones, comprobantes y reportes. |
| Soporte | Mesa de reclamos. Tickets y proveedores. |
| Marketing | Plantillas de correo y envíos a leads. |
| Lectura | Consulta. No modifica nada. |

Hay dos cosas que conviene entender antes de leer el detalle por rol.

La primera es que la barra de navegación es la misma para todos: las dieciséis
secciones aparecen siempre, sin filtrar por rol. El control de acceso está en
cada pantalla y en cada endpoint, no en el menú. Un usuario de Soporte que entre
a Morosos va a ver el aviso de que no tiene permiso, no una sección ausente.

La segunda es que el permiso se aplica sobre las operaciones que modifican datos.
Las consultas de la mayoría de los módulos —listar propiedades, ver un contrato,
abrir una liquidación— están abiertas a cualquier usuario con sesión válida,
independientemente de su rol. Lo que está restringido por rol es crear, editar,
borrar, transicionar estados y configurar.

### Admin

Ve y puede todo. Es el único rol que llega a la configuración fiscal (certificado
de ARCA, emisores, puntos de venta), a la carga y borrado de valores de índices,
a la configuración de punitorios de la inmobiliaria, a la condonación de una
multa, al cambio de rol de otro usuario y a su desactivación. También es el único
que puede disparar a mano las corridas de notificaciones y de punitorios.

### Gerente

Trabaja como el Admin sobre todo el circuito operativo: propiedades, personas,
contratos, plantillas, liquidaciones, pagos, rendiciones, comprobantes, tickets,
proveedores, leads, embudos, reportes, importación y auditoría. Puede invitar
usuarios, pero no cambiarles el rol ni desactivarlos. No accede a los endpoints
administrativos de índices, punitorios ni certificados fiscales.

Sobre el panel, Admin y Gerente son los únicos que ven los bloques de
priorización diaria y de analítica de cartera, junto con la tendencia de
ocupación y la rentabilidad por propiedad.

### Ventas

Su terreno es la cartera y el embudo. Da de alta y edita propiedades —incluidas
las fotos, las operaciones de venta o alquiler y sus transiciones de estado—,
personas con sus roles y documentos, tasaciones, proveedores y servicios. Crea,
edita y activa contratos, puede calcular un ajuste y generar el documento del
contrato a partir de una plantilla, pero no aplica el ajuste ni rescinde el
contrato: esas dos operaciones quedan en Admin y Gerente.

Es uno de los tres roles que entran al tablero del embudo (`/pipeline`), junto
con Admin y Gerente. Sobre leads carga, edita, mueve de etapa, asigna, registra
interacciones y visitas, convierte y descarta. Sobre facturación tiene acceso de
lectura y puede exportar propiedades y personas a CSV y a Excel.

### Liquidaciones

Es el rol de la administración. Genera las liquidaciones del mes, edita sus
líneas, transiciona sus estados y registra los pagos. Genera, edita y transiciona
las rendiciones al propietario, y las envía por correo. Emite facturas y notas de
crédito, administra emisores y puntos de venta. Accede a los reportes financieros
y a los indicadores de flujo de caja y morosidad del panel. No aprueba ni envía
liquidaciones en lote —eso es de Admin y Gerente— ni borra una liquidación.

### Soporte

Abre, edita y cierra tickets, comenta, adjunta archivos, transiciona estados,
asigna un proveedor y carga el costo del trabajo. Consulta el listado de
proveedores habilitados para un ticket. Tiene lectura sobre facturación. En las
pantallas de liquidaciones aparece en modo consulta.

### Marketing

Administra las plantillas de correo: las crea, las edita, las borra, las
previsualiza y envía un correo a un lead a partir de una plantilla. Fuera de eso
tiene el acceso de lectura general.

### Lectura

Consulta. Sobre pagos y facturación tiene lectura explícita, y en el resto de los
módulos ve los listados y los detalles sin ninguna acción disponible. Las
pantallas de liquidaciones lo tratan como solo lectura.

## El panel

`/dashboard` es la pantalla de entrada. Arriba muestra la masa de alquileres de
la cartera y la tendencia de facturación; debajo, las fichas de ocupación,
cobranzas, morosidad y tickets. La sección que más se usa en el día a día es la
de lo que requiere atención: contratos por vencer, cobranzas pendientes y tickets
prioritarios, cada uno con acceso directo al registro. Admin y Gerente ven además
la priorización diaria y la composición de la cartera.

## Recorridos habituales

### Dar de alta una propiedad

Desde **Propiedades** (`/properties`), el botón *Nueva propiedad* lleva al
formulario de alta (`/properties/new`). Se cargan el título y la descripción, el
tipo de propiedad, la dirección completa con provincia y código postal, y las
características —superficie total y cubierta, ambientes, y el resto de los
atributos del inmueble—.

Guardado el inmueble, el detalle (`/properties/[id]`) es donde se completa el
resto. Ahí se suben las fotos, que el servidor redimensiona a un original de
1920 píxeles de ancho y una miniatura de 400, y se reordenan arrastrándolas. En
el mismo detalle se agregan las operaciones —alquiler, alquiler temporario o
venta— con su precio, y cada operación tiene su propia máquina de estados: el
cambio de estado se hace sobre la operación, no sobre la propiedad. También se
vinculan las personas relacionadas, se consulta el historial de precios y se
cargan las tasaciones, que ofrecen comparables de la propia cartera por ciudad,
tipo y ambientes.

Borrar una propiedad es una operación de Admin o Gerente; editarla, también de
Ventas.

### Cargar una persona

**Personas** (`/persons`) es el directorio único: propietarios, inquilinos,
garantes, proveedores, compradores y leads convertidos son todos registros de
persona. El alta (`/persons/new`) pide los datos base, y el detalle
(`/persons/[id]`) es donde se hace el trabajo importante: asignar roles.

Una misma persona puede tener varios roles a la vez, y cada asignación puede
apuntar a una propiedad o a un contrato concreto —el mismo registro puede ser
propietario de un inmueble e inquilino de otro—. En el detalle se cargan también
los datos fiscales y bancarios, que después alimentan la rendición, y los
documentos adjuntos. Admin y Gerente ven además la sección de puntaje del
inquilino.

Desde el detalle de una persona con rol de inquilino se genera la invitación al
portal, que es la operación que le habilita el acceso a la autogestión.

### Cargar un contrato

**Contratos** (`/contracts`) → *Nuevo Contrato* (`/contracts/new`). El formulario
resuelve en un solo paso lo que en papel son varias hojas: la propiedad, el tipo
de contrato (alquiler, alquiler temporario o venta), las fechas de inicio y fin,
el monto inicial, las partes con su rol en el contrato, las garantías y el
esquema de ajuste.

El ajuste se define por tipo y por periodicidad. Los tipos disponibles son IPC,
ICL, CCP, porcentaje fijo y personalizado; la periodicidad va de mensual a anual.
Con eso el sistema arma el cronograma de ajustes del contrato.

El último paso del formulario ofrece dos salidas. *Guardar como borrador* deja el
contrato cargado pero sin efecto: un borrador no genera liquidaciones, no se le
calculan ajustes y no cambia el estado de la propiedad. *Guardar y activar* lo
crea directamente activo. Si al activarlo algo no está en regla, el sistema no
guarda nada y muestra en el mismo formulario, en una lista, qué hay que corregir;
se puede corregir y volver a intentar, o guardarlo como borrador y activarlo
después.

Un contrato en borrador se activa desde su detalle con *Activar contrato*, que
pide confirmación antes de hacer el cambio. Activar es una operación de Admin,
Gerente y Ventas —los mismos roles que pueden cargar un contrato—. Para que un
contrato se pueda activar:

- la propiedad tiene que existir y no estar dada de baja;
- tiene que tener al menos un propietario y, salvo que sea de venta, al menos un
  inquilino (un garante no reemplaza a ninguno de los dos);
- la fecha de fin tiene que ser posterior a la de inicio;
- si es un alquiler, la propiedad no puede tener otro contrato de alquiler activo
  cuyas fechas se superpongan con las de este. Que uno termine el mismo día en que
  empieza el otro no cuenta como superposición. El aviso indica las fechas del
  contrato que choca y lleva a su ficha;
- si es un alquiler y la operación de alquiler de la propiedad está archivada, hay
  que reactivarla antes.

Si falla más de una condición, el aviso las lista todas juntas. Activar un
contrato de alquiler deja la operación de alquiler de la propiedad en
*Alquilado*, en el mismo paso: si la propiedad no tenía operación de alquiler, la
crea; si estaba disponible, reservada o suspendida, la lleva a alquilada
recorriendo los estados permitidos. No hace falta cambiar el estado de la
propiedad a mano. Una vez activo, el contrato entra en la generación mensual de
liquidaciones y en el cálculo de ajustes.

El estado de un contrato no se cambia a *Activo* editándolo: se activa con la
acción de activar, que es la que hace las verificaciones.

En el detalle (`/contracts/[id]`) se ven las partes, las garantías, la línea de
tiempo de ajustes y la comisión pactada. Desde ahí se calcula el próximo ajuste
—cualquiera de los tres roles operativos puede hacerlo— y se lo aplica, que es
una operación de Admin o Gerente. La comisión del contrato es la que después
determina qué se le descuenta al propietario en la rendición, así que conviene
cargarla junto con el contrato y no cuando llega el momento de rendir.

El documento del contrato se genera desde el mismo detalle, eligiendo una de las
plantillas disponibles. Las plantillas se administran aparte y son de Admin y
Gerente; para empezar existe una carga de plantillas por defecto.

Rescindir un contrato es de Admin o Gerente, también pide confirmación en la
misma pantalla, y produce el resumen de cierre. Si el contrato rescindido era el
último alquiler activo de la propiedad, la operación de alquiler vuelve a
*Disponible*; si queda otro contrato activo sobre la propiedad, o si alguien ya
había movido la operación a otro estado, no se toca. Lo mismo pasa cuando un
contrato activo se marca como vencido o renovado.

### Generar la liquidación del mes

**Liquidaciones** (`/liquidaciones`) → *Generar Mes*. La acción no trabaja
contrato por contrato: elegido el período, crea las liquidaciones de todos los
contratos activos de ese mes, informa cuántas generó y cuántas omitió porque ya
existían. Es la operación que abre el mes. Está disponible para Admin, Gerente y
Liquidaciones.

Cada liquidación nace en Borrador y recorre En Revisión, Aprobada, Enviada y
Pagada; puede quedar Vencida o Anulada. En el detalle (`/liquidaciones/[id]`) se
ven las líneas —alquiler, ajuste, extras, descuentos, multas— y se agregan,
editan o quitan las que hagan falta antes de aprobar. Aprobar y enviar en lote
desde el listado es una acción reservada a Admin y Gerente.

La liquidación tiene su comprobante en PDF, descargable desde el listado y desde
el detalle. Es el documento que el inquilino ve en su portal. El archivo se baja
con la sesión abierta; si la descarga falla, la pantalla muestra un aviso en lugar
de quedarse callada. Los vencimientos y las fechas de contrato se ven tal como se
cargaron, sin correrse un día.

### Registrar un pago

El pago se registra contra la liquidación, no como un movimiento suelto. En el
detalle de la liquidación, *Registrar Pago* pide la fecha, el monto, el medio
—transferencia, efectivo, MercadoPago o cheque—, una referencia y observaciones.
El sistema imputa el monto y recalcula el saldo pendiente; si el pago es parcial,
la liquidación queda con su saldo a la vista y la tarjeta lo indica.

**Pagos** (`/pagos`) es la mirada agregada: deuda pendiente, deuda vencida y los
pagos recientes con su medio y su período. Es una pantalla de consulta; el
registro siempre ocurre en la liquidación.

Cuando una liquidación pasa su vencimiento sin pago, el cálculo de punitorios
corre por su cuenta según la configuración de la inmobiliaria. **Morosos**
(`/delinquency`) reúne a los inquilinos con liquidaciones vencidas, con la deuda,
la multa acumulada y los días de atraso; desde ahí se condona una multa, que es
una operación de Admin. La pantalla es de Admin y Gerente.

### Emitir un comprobante

Antes del primer comprobante hay que dejar la facturación configurada, y eso es
trabajo de Admin: en `/configuracion/fiscal` se carga el certificado de ARCA, se
dan de alta los emisores —propios o delegados— y se sincronizan sus puntos de
venta.

Con eso listo, **Facturación** (`/invoices`) → *Emitir Factura* abre el
asistente (`/invoices/new`), que va por pasos: emisor, receptor, ítems y opciones
avanzadas. Antes de confirmar se puede pedir una vista previa. El sistema emite
facturas A, B y C, y devuelve el CAE con su vencimiento; hasta que ARCA lo
asigna, el comprobante figura con el CAE pendiente. El PDF se descarga desde el
listado o desde el detalle.

La anulación se hace por nota de crédito, no borrando el comprobante: desde el
detalle de un comprobante, `/invoices/[id]/nc` abre el formulario de la nota de
crédito contra el original. Emitir y anular son operaciones de Admin, Gerente y
Liquidaciones; el resto de los roles tiene lectura.

La consulta de padrón por CUIT está disponible dentro del asistente y sirve para
verificar la condición fiscal del receptor antes de emitir.

### Rendir al propietario

**Rendiciones** (`/renditions`) → *Generar Rendición*, indicando el contrato y el
período. La rendición toma lo efectivamente cobrado en el período y le descuenta
la comisión pactada en el contrato más los conceptos que correspondan, para
llegar al depósito neto que recibe el propietario.

En el detalle (`/renditions/[id]`) se ven los conceptos discriminados y se pueden
agregar o quitar líneas y dejar notas. Los estados son Borrador, Aprobada,
Enviada y Depositada. El PDF se descarga, con la sesión abierta, desde el listado
o el detalle, y desde
el detalle se lo envía por correo al propietario. Todo el circuito es de Admin,
Gerente y Liquidaciones.

Si la rendición no cuadra con lo esperado, lo primero a revisar es la comisión
del contrato: es el parámetro que la determina.

### Atender un reclamo

Un reclamo puede entrar por dos vías: lo abre el inquilino desde su portal, o lo
carga la inmobiliaria desde **Tickets** (`/tickets`) → *Nuevo ticket*, indicando
título, descripción, propiedad, categoría, prioridad y, si corresponde, el
usuario responsable. Las categorías las administran Admin y Gerente.

El detalle (`/tickets/[id]`) es donde vive el circuito. El ticket recorre
Abierto, Asignado, En progreso, Proveedor asignado, Proveedor en camino, Trabajo
realizado, Resuelto y Cerrado, con Cancelado y Reabierto como salidas; el cambio
de estado se hace desde el propio detalle y solo ofrece las transiciones válidas
para el estado actual. Se puede reasignar a otro usuario, comentar, adjuntar
archivos, asignar un proveedor de la lista de habilitados para ese ticket y
cargar el costo del trabajo. La pantalla muestra el vencimiento del acuerdo de
nivel de servicio y cuánto queda.

Gestionar tickets es de Admin, Gerente y Soporte. Los demás roles los ven.

### Importar datos y sacar reportes

**Importar** (`/import`) sube un CSV de hasta 10 MB de propiedades o de personas
y lo procesa en cuatro pasos: subir el archivo, mapear las columnas del CSV a los
campos del sistema, validar fila por fila y confirmar. La validación informa
cuántas filas son válidas y detalla el error de cada fila rechazada, así que
conviene corregir el archivo y volver a subirlo antes de confirmar. Es una
operación de Admin y Gerente. La exportación de propiedades y personas a CSV y
Excel está además disponible para Ventas.

**Reportes** (`/reports`) genera estado de cuenta del propietario, rentabilidad
por propiedad, flujo de caja mensual, resumen de comisiones, analítica del embudo
y morosidad, y los descarga en Excel o PDF. La pantalla es de Admin, Gerente y
Liquidaciones; programar un envío periódico es de Admin y Gerente.

## El portal del inquilino

El portal es una aplicación aparte dentro de la misma web, con su propia
navegación de tres secciones y su propio acceso.

El inquilino no se registra. La inmobiliaria genera la invitación desde el
detalle de la persona, el inquilino recibe un enlace con un token y en
`/portal/auth/set-password` define su contraseña. El enlace es de un solo uso y
tiene vencimiento: si expiró o ya se usó, la pantalla lo dice y hay que pedir uno
nuevo. Desde ahí en adelante entra por `/portal/auth/login` con su correo y su
contraseña.

**Inicio** (`/portal`) muestra el estado de su cuenta, el próximo vencimiento y
la cantidad de reclamos abiertos, las últimas facturas, los últimos reclamos y el
resumen de su contrato. Desde acá también puede abrir un reclamo nuevo.

**Facturas** (`/portal/liquidaciones`) lista todas sus liquidaciones con su
estado —a pagar, pagada, vencida, en preparación o anulada—, el aviso del saldo
pendiente si lo hay, y el PDF de cada una.

**Reclamos** (`/portal/tickets`) lista sus reclamos abiertos y cerrados, y
permite abrir uno nuevo con un archivo adjunto y comentar los existentes. El
reclamo que abre desde acá entra directamente al listado de tickets de la
inmobiliaria.

El inquilino no tiene rol: su acceso no pasa por el sistema de permisos de los
usuarios internos. Lo que ve está delimitado por su propia identidad —las
consultas del portal se acotan a la persona autenticada—, de modo que solo llega
a sus contratos, sus liquidaciones y sus reclamos.

## El sitio público de la inmobiliaria

Cada inmobiliaria tiene un micrositio público en `/p/[slug]`, sin necesidad de
ninguna sesión. Muestra el nombre y la provincia de la inmobiliaria con sus
colores y su logo, y una grilla filtrable por operación, tipo y ciudad de las
propiedades publicadas. Cada propiedad tiene su ficha en
`/p/[slug]/propiedades/[id]` con la galería, el precio, las características, las
amenidades y la ficha técnica.

Tanto la portada como la ficha tienen un formulario de consulta. Una consulta
enviada desde ahí entra como lead al embudo comercial de la inmobiliaria, y es la
puerta de entrada del circuito de CRM.

## Configuración

`/configuracion` reúne los datos de la inmobiliaria: nombre, CUIT, provincia,
colores de marca y logo —los mismos que usa el micrositio público—. Editar es de
Admin y Gerente; los demás la ven en modo lectura. Desde ahí se llega a las
cuatro pantallas de configuración específicas: la fiscal (`/configuracion/fiscal`),
las etapas del embudo (`/configuracion/pipeline`), los pesos del puntaje de
inquilinos (`/configuracion/scoring`) y los índices de ajuste
(`/configuracion/indices`).

### Índices de ajuste

`/configuracion/indices` muestra el último valor de cada índice —IPC, ICL, UVA,
CVS y CER— con su período y de dónde salió: INDEC, BCRA o carga manual. Si el
último dato es más viejo de lo normal (un índice mensual sin el mes de hace dos
meses, o uno diario con más de una semana), la tarjeta lo marca como
desactualizado. Debajo está el historial de cada índice, de a 24 valores por
página. La pantalla la ven Admin y Gerente; cargar, corregir y borrar es solo
del Admin.

El sistema trae solo, todos los días a las 6, el IPC, el ICL y la UVA. El IPC
sale del archivo que publica el INDEC en datos.gob.ar; en los días entre que el
INDEC anuncia el dato y actualiza ese archivo, se completa con la inflación
mensual que publica el BCRA, redondeada a un decimal, y se reemplaza por el
valor completo del INDEC en cuanto aparece. *Actualizar ahora* fuerza esa
descarga sin esperar a la mañana siguiente. El CVS y el CER no se descargan: se
cargan a mano.

Para cargar o corregir un valor, *Cargar valor* (o el lápiz en una fila del
historial). El IPC, el CVS y el CER se cargan como **variación mensual en
porcentaje** —1,9 para una suba de 1,9 % en el mes—, por mes; el ICL y la UVA,
como el **valor del índice** publicado ese día. Para cargar varios meses de una
vez, *Pegar varios*: una línea por período, con el período, una coma, punto y
coma o tabulación, y el valor (`2026-09, 1,9`). Se puede copiar directo de una
planilla. La pantalla marca las líneas que no entiende y no guarda nada hasta
que todas estén bien.

Un valor cargado a mano tiene prioridad sobre el del sistema para el mismo
índice y período, y vale solo para la inmobiliaria que lo cargó. Si después se
lo borra, el ajuste vuelve a usar el valor del sistema.

`/perfil` es la pantalla propia de cada usuario, donde edita su nombre y apellido
y consulta su rol.
