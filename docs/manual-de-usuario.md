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
líneas, transiciona sus estados y registra los pagos. Lleva la cuenta corriente de
los locadores: les paga, genera y emite su estado de cuenta mensual (el saldo inicial
y la anulación de un estado son de Admin y Gerente); las rendiciones por contrato
quedan como histórico de consulta. Emite facturas y notas de
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
los datos fiscales y bancarios, que después alimentan el pago al locador, y los
documentos adjuntos. Admin y Gerente ven además la sección de puntaje del
inquilino.

La ficha se divide en cuatro pestañas: *Datos* (tipo de persona, documento,
domicilio, estado civil, nacionalidad, forma de cobro, datos fiscales, roles,
documentos y puntaje), *Cuentas bancarias*, *Poderes* y *Contratos como locador*.
Todos los datos de la parte son opcionales; vaciar uno al editar lo borra.

**Cuentas bancarias.** Una persona puede tener varias cuentas, en pesos o en
dólares. Con *Agregar cuenta* se carga la moneda, el banco, el CBU (22 dígitos),
el alias y el titular. La primera cuenta de cada moneda queda como
predeterminada, y siempre tiene que haber una por moneda: para dejar otra como
predeterminada se usa *Hacer predeterminada*, y no se puede soltar ni eliminar la
predeterminada mientras haya otras de la misma moneda (el sistema avisa con el
motivo). La moneda de una cuenta no se cambia: se crea otra. Eliminar pide
confirmación.

**Poderes.** En *Poderes* se ven los poderes que la persona otorgó, que se
editan o se revocan, y los que ejerce como apoderada, que son de solo lectura.
*Otorgar poder* pide el apoderado (se busca por nombre o documento), los
alcances (cobrar, firmar, administrar), el modo de firma (indistinta: firma uno;
conjunta: firman todos los que comparten la misma clave de grupo), a qué aplica
(general, un contrato o una propiedad), la vigencia y el enlace al documento del
poder. Una persona no puede darse poder a sí misma. Un poder de cobro que un
locador usa para que cobre su apoderado no se puede revocar mientras esté en uso.

**Contratos como locador.** Lista los contratos en los que la persona alquila y
cobra, con su porcentaje de cobro, quién cobra y la vigencia, con enlace a cada
contrato.

Desde el detalle de una persona con rol de inquilino se genera la invitación al
portal, que es la operación que le habilita el acceso a la autogestión.

### Cargar un contrato

**Contratos** (`/contracts`) → *Nuevo Contrato* (`/contracts/new`). El formulario
resuelve en un solo paso lo que en papel son varias hojas: la propiedad, el tipo
de contrato (alquiler, alquiler temporario o venta), las fechas de inicio y fin,
el monto inicial, las partes con su rol en el contrato, las garantías y el
esquema de ajuste.

El ajuste se define por tipo y por periodicidad. Los tipos disponibles son IPC,
ICL, CCP, porcentaje fijo y personalizado (UVA y escalonado se podrán elegir cuando el cálculo los soporte); la periodicidad va de mensual a anual.
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
- tiene que tener locadores cuyos porcentajes de cobro sumen exactamente 100 % en
  cada fecha del contrato y, salvo que sea de venta, al menos un inquilino (un
  garante no reemplaza a ninguno de los dos);
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
determina qué se le descuenta al locador en su cuenta corriente, así que conviene
cargarla junto con el contrato. En la misma comisión se puede pactar un **honorario
por gestión de reparaciones** (un porcentaje): cada reparación a cargo del locador
que se descuenta en su estado de cuenta suma ese honorario. Sin porcentaje no se
cobra.

El documento del contrato se genera desde el mismo detalle, eligiendo una de las
plantillas disponibles. Las plantillas se administran aparte y son de Admin y
Gerente; para empezar existe una carga de plantillas por defecto.

Rescindir un contrato es de Admin o Gerente, también pide confirmación en la
misma pantalla, y produce el resumen de cierre. Si el contrato rescindido era el
último alquiler activo de la propiedad, la operación de alquiler vuelve a
*Disponible*; si queda otro contrato activo sobre la propiedad, o si alguien ya
había movido la operación a otro estado, no se toca. Lo mismo pasa cuando un
contrato activo se marca como vencido o renovado.

### Ver las reglas vigentes y los acuerdos de un contrato

En el detalle del contrato, *Reglas vigentes* muestra lo que rige hoy: modalidad y
período de ajuste, base del ajuste (sobre el alquiler original o sobre el vigente),
rezago del índice, día de vencimiento, quién cobra (se reparte, todo la inmobiliaria
o todo el locador) y los descuentos o el alquiler acordado, si los hay, con la fecha
desde la que rigen y cuántas versiones tuvo, las cuatro convenciones de liquidación
pactadas y, si el contrato lo pacta, **qué debe el locador cuando cobra él
directamente** (todo lo ajeno, o solo lo de la inmobiliaria si él paga los entes);
sin pactar rige lo que eligió la inmobiliaria en *Caja y cobros*. Se pacta al crear
el contrato o con un convenio de cambio de reglas. Debajo, *Acuerdos* lista los convenios
registrados (renegociación, rebaja, bonificación, cambio de reglas, de reparto o de
cargo) con su vigencia, sus notas y un enlace al documento. Ambas secciones son de
solo lectura: los acuerdos todavía se cargan por la API (`POST
/contracts/:id/agreements`, Admin y Gerente). Un acuerdo no pisa las reglas
anteriores: crea una versión nueva desde su fecha, y el contrato sigue mostrando la
que corresponde a cada día.

Si un contrato venció el día pactado y nadie lo cerró, sigue activo y se sigue
liquidando hasta que se registre su fin real (`actualEndDate`) o se rescinda: una
prórroga de palabra se registra cargando esa fecha en el contrato.

### Reglas de impuestos y servicios de un contrato

En el detalle del contrato, *Impuestos y servicios* dice, servicio por servicio,
quién paga y cómo se reparte:

- **Inquilino**: paga directo al ente; no pasa por la inmobiliaria y no aparece en
  su liquidación.
- **Inmobiliaria**: el inquilino le paga el importe a la inmobiliaria y ésta paga
  al ente. Sale como un renglón *Servicio* o *Impuesto* de la liquidación del
  inquilino, a nombre del ente, y no cuenta para la comisión.
- **Propietario**: el inquilino lo paga junto con el alquiler y todo pasa al
  locador (por cuenta y orden). Sale como renglón a nombre del locador, con la
  leyenda «por cuenta y orden del locador», y tampoco cuenta para la comisión.

El reparto es un **porcentaje** de la boleta (el que le toca al inquilino), **por
consumo** (la parte del consumo de la unidad sobre el total de la boleta, por
ejemplo el agua de un edificio) o un **importe fijo** (nunca más que la boleta). Un
servicio con opción anual (tasa municipal, impuesto inmobiliario) puede cobrarse
**mensual** o **anual**. En el plan anual se elige cómo se recupera la boleta: **en
cuotas** mensuales iguales (lo habitual; de 1 a 12, de fábrica 12) o **de una vez** en
el mes de la boleta. También se elige **a quién va el descuento por pago anual**: al
inquilino (se le cobra lo que efectivamente se pagó), o al locador o a la
inmobiliaria (se le cobra el importe sin descuento y la diferencia sale como un
renglón aparte a nombre de ese beneficiario, sin comisión). Y qué pasa si el contrato
termina antes de la última cuota: **cobrar lo que queda en la liquidación final** (se
suma a la cuota del último mes) o **descartar** las cuotas restantes.

Quien administra la facturación (Admin, Gerente y Liquidaciones) usa *Agregar o
cambiar regla*: elige el servicio, quién paga, el reparto, el plan y desde qué fecha
rige. Las reglas no se pisan: la nueva rige desde su fecha, la anterior queda en el
historial y los meses anteriores se siguen cobrando como se pactó. En un contrato
que ya está en vigor, el cambio necesita un acuerdo escrito: el editor registra el
acuerdo de cambio de cargo (con el enlace al documento y las notas) y crea la regla
con la misma fecha. En un borrador la regla se crea sin acuerdo. Una regla que ya se
usó en una liquidación no se corrige: se crea una versión nueva.

### Cargar las boletas del mes

**Boletas del mes** (`/boletas`, Admin, Gerente y Liquidaciones). Se elige el mes y la
pantalla muestra una fila por servicio activo (o por boleta ya cargada), con la
propiedad, el servicio, **quién paga** según las reglas de los contratos, la cuota
(`MM/AAAA` si no se indica otra), el importe, el vencimiento (propuesto con el día de
vencimiento del servicio) y el consumo.

La carga es como una planilla: se escribe en las celdas, con las flechas y Enter para
moverse, o se **pega desde Excel o Sheets** a partir de la celda activa (importe,
vencimiento y consumo en ese orden, una fila por servicio). El importe admite coma
decimal (hasta 2 decimales), el vencimiento se escribe `AAAA-MM-DD` o `D/M/AAAA`, y
cada celda con error se marca. *Guardar* envía solo las filas con importe que se
tocaron, en una sola carga masiva: se informa cuántas boletas se guardaron, y las
filas rechazadas quedan listadas con el motivo, con lo escrito intacto para
corregirlas. Cargar dos veces lo mismo no duplica nada.

Lo que le toca al inquilino se calcula al guardar y entra como renglón en su
liquidación. Si la liquidación del mes ya se generó, la boleta entra en la próxima
que se genere (también las cuotas de un plan anual de meses anteriores que todavía
no se cobraron). Una boleta ya incluida en una liquidación no se puede cambiar; si
la liquidación sigue en borrador y se borra, o se quita el renglón, la boleta vuelve
a quedar pendiente. Para marcar una boleta como pagada (quién pagó, cuándo y el
comprobante) se usa `PATCH /service-bills/:id`.

### Cargar los gastos del mes (centro de carga)

**Centro de carga** (`/cargos`, Admin, Gerente y Liquidaciones). Acá se cargan los gastos
que aparecen durante el mes: reparaciones, expensas extraordinarias con la unidad
vacía, devoluciones al inquilino y honorarios por la gestión de una reparación. Cada
gasto se imputa **una sola vez**.

- *Cargar un gasto* abre el formulario: a cargo de quién va (inquilino, locador o
  inmobiliaria), la clase, el contrato (o la propiedad, si está vacía), la descripción,
  el importe, la fecha, a favor de quién va el dinero (el locador si pagó al proveedor,
  la inmobiliaria si lo adelantó) y, si hace falta, el mes desde el que se imputa y las
  cuotas (una por mes).
- *Carga por planilla* permite escribir o pegar varias filas desde Excel o Sheets. Las
  filas guardadas salen de la planilla y las que fallan quedan, con el motivo, para
  corregirlas.
- Un gasto **al inquilino** entra como renglón de su próxima liquidación, sin comisión.
  Uno **al locador** se descuenta en su estado, no en la liquidación del inquilino. Uno
  **a la inmobiliaria** solo queda registrado.
- El detalle de cada contrato muestra sus *Cargos pendientes*.

**Anticipo.** Si el gasto al inquilino supera el umbral de anticipo de la inmobiliaria
(por defecto, 2 comisiones mensuales del contrato), queda marcado *Pide anticipo* y no
entra solo en la liquidación. Se pide el pago por adelantado y, cuando el inquilino
paga, se marca *Cobrado por adelantado*; o se decide *Imputar en la liquidación* y
entra en la próxima. El umbral se cambia en la configuración de valores por defecto y se puede pactar distinto por contrato (al crearlo o en un convenio): un umbral propio en comisiones mensuales y la comisión con que se mide (la pactada del contrato o el porcentaje por defecto de la inmobiliaria). Rige el pactado a la fecha del gasto.

**Devoluciones.** Una devolución al inquilino (por ejemplo, un arreglo que pagó él) se
carga con su importe y se resta en su liquidación como un descuento a favor del
inquilino, sin tocar la comisión.

**Correcciones.** Un cargo pendiente se corrige o se *Anula*. Si la liquidación que lo
incluye se borra (en borrador), se anula o se quita su renglón, el cargo vuelve a
pendiente solo, igual que las boletas y las correcciones de ajuste que traía, y
entra en la próxima liquidación; queda una fila de auditoría. Un cargo imputado en
una liquidación vigente no se edita ni se anula.

**Gasto a cargo del locador o de la inmobiliaria.** Para un gasto al locador se elige
un locador (los vigentes del contrato o los titulares de la propiedad) o, sin elegir,
es de todos según su porcentaje. Un gasto a cargo de la inmobiliaria queda
registrado como pendiente hasta que se paga: *Registrar como gasto* pide la cuenta de
la inmobiliaria de la que sale el dinero (y, si hace falta, la fecha) y lo cierra como
un **Gasto** en la caja (ver *Caja de la inmobiliaria*). Se cierra una sola vez y, una
vez cerrado, ya no vuelve a pendiente.

### Cargar los locadores de un contrato y su porcentaje de cobro

El locador es quien alquila y cobra, y es una relación del contrato: una persona
no necesita tener un rol especial para serlo. En *Nuevo contrato*, el paso de
personas pide los **locadores**: se busca a cada persona y se la agrega; el
sistema reparte el 100 % en partes iguales y cada porcentaje se puede corregir
(mientras se editó alguno, agregar o quitar locadores ya no reparte solo). El
aviso debajo de la lista dice si el reparto suma 100 %. Con otra suma se puede
guardar como borrador, pero no activar: *Guardar y activar* queda deshabilitado
hasta que sumen 100 %.

En el detalle del contrato, la sección **Locadores** muestra, para cada uno, la
persona, el carácter (propietario, usufructuario, sublocador, acreedor u otro),
el porcentaje de cobro, quién cobra, la cuenta y la vigencia. Admin, Gerente y
Ventas ven *Editar locadores*, que abre el conjunto completo y lo guarda de una
vez. Mientras se edita, el indicador muestra la suma de los locadores vigentes:
el botón *Guardar locadores* solo se habilita con 100,0000 % exacto en cada fecha
del contrato, y si falta o sobra, el aviso dice cuánto. Para cada locador se elige:

- el **porcentaje de cobro**, con hasta 4 decimales (se acepta coma);
- **quién cobra**: por defecto el propio locador, o un apoderado que tenga un poder
  de cobro vigente de ese locador (la lista solo ofrece a esos);
- la **cuenta** de cobro, entre las cuentas del locador;
- la **vigencia** (desde y hasta). Una cesión se carga cerrando a un locador con
  su fecha de fin y agregando al nuevo con esa misma fecha de inicio.

Si el sistema rechaza el reparto, el aviso lo explica y, cuando las fechas no
cierran, lista los días en que la suma no da 100 %.

**Contratos migrados.** Los contratos que tenían varios propietarios se pasaron a
locadores con partes iguales y quedaron marcados **A revisar**: ese reparto es
una suposición. Hay que confirmar los porcentajes reales en *Editar locadores* y
guardar; al cambiar el porcentaje de un locador la marca se baja. Un contrato
que todavía muestra propietarios sueltos con la etiqueta **A migrar** se carga
desde *Cargar locadores*, que parte de esos propietarios con reparto igual.

La sección **Apoderados** del contrato lista los poderes vigentes que aplican: los
propios del contrato y los generales de cada locador, con sus alcances, el modo
de firma y un enlace a la ficha del poderdante. Se cargan desde la pestaña
*Poderes* de la persona.

### Titulares de una propiedad

En el detalle de la propiedad, la sección **Titulares** registra quién figura
como dueño del inmueble: persona, porcentaje (opcional), título y fechas. Es
informativo: no decide pagos —el reparto del cobro se define en cada contrato— y
no se exige que los porcentajes sumen 100. Si los porcentajes cargados no suman
100 %, aparece un aviso que no impide guardar. Agregar y quitar titulares es de
Admin, Gerente y Ventas; quitar pide confirmación.

### Generar la liquidación del mes

La inmobiliaria no tiene que acordarse de abrir el mes: todos los días a las 6 de
la mañana el sistema revisa cada inmobiliaria y, cuando faltan diez días o menos
para el mes siguiente (los días de anticipación de *Valores por defecto*; de
fábrica, el día 20), genera las liquidaciones de ese mes. Si ya existían no las
repite.

El botón hace lo mismo a pedido: **Liquidaciones** (`/liquidaciones`) → *Generar
Mes*. Elegido el período, crea las liquidaciones de los contratos que rigen ese
mes, informa cuántas generó, cuántas omitió porque ya existían y cuántos
contratos quedaron fuera por no regir (todavía no empezaron o ya terminaron)
y cuántos primeros meses quedaron sin liquidar porque el contrato los cobra al firmar o
con el mes siguiente.
Está disponible para Admin, Gerente y Liquidaciones.

Cada liquidación se arma con las reglas de ese mes y no con las de hoy: el
alquiler es el que regía entonces, vence el día de vencimiento del contrato, y si
el contrato empieza después del día 1 o termina antes del último día del mes (con
fin real cargado), el alquiler de ese mes se prorratea por días y se aclara en la
descripción. Un contrato activo sigue liquidando aunque haya pasado su fin pactado
hasta que se cargue el fin real. Las bonificaciones del contrato aparecen como un
descuento.

Cuatro detalles de ese cálculo se pactan con cada inquilino y propietario, y por eso
son una regla del contrato (con un valor por defecto de la inmobiliaria):

- **Prorrateo de un mes parcial.** *Días reales del mes* (el día de inicio cuenta),
  *Mes comercial de 30 días* (el día 31 cuenta como 30) o *Mes completo, sin
  prorrateo*.
- **Ajuste a mitad de mes.** Si el alquiler nuevo rige un día 15, puede *regir desde
  el período siguiente* (de fábrica), *regir todo el mes* o *dividir el mes por días*:
  la liquidación muestra entonces dos renglones de alquiler, los días al alquiler
  viejo y los días al nuevo, con el conteo de días del prorrateo.
- **Primer mes con inicio tardío.** Si el contrato empieza después del día de
  vencimiento: *vence el día de inicio* (de fábrica), *se cobra con el mes
  siguiente* (el primer mes no se liquida solo: la liquidación del mes siguiente suma
  su alquiler prorrateado como un renglón aparte) o *se cobra al firmar* (el primer
  mes no se liquida; el sistema lo informa como «sin liquidar» al generar).
- **Descuento de monto fijo en un mes parcial.** *Se prorratea* como el alquiler (de
  fábrica) o *se descuenta completo*; nunca supera el alquiler del mes.

Cuando un ajuste de alquiler se calculó con un índice estimado (REM) y después se
publica el oficial, la primera liquidación posterior suma la diferencia de los meses
ya facturados con el alquiler provisorio como un renglón *Ajuste retroactivo*
(comisionable, a favor del locador); si el estimado se pasó, la diferencia sale como
un descuento a favor del inquilino. Cada corrección se factura una sola vez.

Se eligen al crear el contrato (paso *Precio y ajuste*, que arranca con los valores
por defecto de la inmobiliaria), se corrigen mientras el contrato no tenga acuerdos
y, después, cambian por acuerdo con fecha. Las liquidaciones ya generadas no se
tocan.

Cada liquidación nace en Borrador y recorre En Revisión, Aprobada, Enviada y
Pagada; puede quedar Vencida o Anulada. En el detalle (`/liquidaciones/[id]`) se
ven las líneas —alquiler, ajuste, extras, descuentos, multas— y se agregan,
editan o quitan las que hagan falta antes de aprobar. Aprobar y enviar en lote
desde el listado es una acción reservada a Admin y Gerente.

Cada renglón muestra a quién le corresponde (locador, inmobiliaria o ente o
proveedor) y si es comisionable: la comisión solo corre sobre el alquiler, sus
ajustes y los punitorios, nunca sobre reparaciones, impuestos ni servicios. Cuando
el alquiler usa un ajuste provisional, la liquidación se marca *Provisional* y sale
como *Pago a cuenta*.

Al aprobar la liquidación se le asigna un número de recibo, correlativo dentro de
la inmobiliaria; no cambia al enviarla. *Imprimir recibo* descarga el PDF con el
número, el monto en letras, la leyenda «Cobrado por cuenta y orden de» los
locadores del contrato y los renglones agrupados según a quién corresponden.

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

**Quién recibió el cobro.** El mismo formulario pregunta quién recibió el dinero. Sin
elegir, rige el flujo de pago del contrato (*Reglas vigentes*): *Todo al locador* lo
registra como recibido por el locador; *Repartido* y *Todo a la inmobiliaria*, como
recibido por la inmobiliaria. Cómo registrar cada caso:

- **La inmobiliaria cobra todo** (efectivo en la oficina o transferencia): *Recibió:
  la inmobiliaria*. Sin elegir cuenta, el efectivo entra en la caja de la moneda y
  los demás medios en el banco de la moneda (se crean solas la primera vez); también
  se puede elegir una cuenta. La inmobiliaria guarda la parte de cada locador hasta
  pagársela.
- **Efectivo que se guarda para el locador**: además, marcar *Guardar la parte de los
  locadores en custodia*. La parte de cada locador entra en su cuenta de custodia y a
  la caja solo va lo de la inmobiliaria y los entes. Sirve también para la moneda
  extranjera que algunos locadores dejan en la oficina.
- **El locador cobra todo**: *Recibió: el locador*. No entra nada en la caja ni se
  emite recibo de la inmobiliaria; el reparto del cobro deja anotado cuánto le debe
  el locador a la inmobiliaria (comisión, renglones de la inmobiliaria y, por
  defecto, los de entes; el contrato puede pactar otra cosa) y su cuenta corriente
  queda con ese saldo en contra. Cuando el locador paga la comisión, se carga un
  movimiento *Honorario* en la caja.
- **Repartido** (comisión a la inmobiliaria y el resto al locador): se registran dos
  cobros, uno por cada receptor; los saldos de los dos se compensan.
- **El inquilino le transfirió a otro locador** (compensación): se registra el cobro
  como recibido por el locador y después se carga la compensación (ver más abajo).

Cada cobro que recibe la inmobiliaria emite un **recibo de cobro** con número propio
(una serie distinta de la del recibo de la liquidación, que no cambia), y queda el
botón para imprimirlo. El cobro guarda cuánto le tocó a la inmobiliaria, a los entes
y a cada locador según su porcentaje; en los pagos parciales el reparto es
acumulado, así que los cobros que saldan la liquidación suman exactamente su total.
Una referencia externa (del sistema anterior o del banco) no se puede repetir. Cada
cobro con reparto deja además sus asientos en la cuenta corriente de cada locador
(ver *Cuenta corriente del locador*).

**Pagos** (`/pagos`) es la mirada agregada: deuda pendiente, deuda vencida y los
pagos recientes con su medio y su período. Es una pantalla de consulta; el
registro siempre ocurre en la liquidación.

### Caja de la inmobiliaria

**Caja** (`/caja`; la ven Admin, Gerente, Liquidaciones y Lectura) reúne el dinero que
pasa por la inmobiliaria.

- **Cuentas**: cajas (efectivo), bancos y la custodia de cada locador, cada una en una
  sola moneda (pesos, dólares o euros), con su saldo. Los totales por moneda separan lo
  de la inmobiliaria de lo que guarda en custodia; la custodia suma en el total solo si
  la inmobiliaria lo eligió en los valores por defecto. Las cuentas las crean, renombran
  o desactivan Admin y Gerente; una cuenta con saldo no se desactiva.
- **Movimientos**: el libro de la inmobiliaria, con filtros por cuenta, categoría,
  fechas y contrato. Los cobros, la custodia, las compensaciones y las conversiones se
  escriben solos. A mano (Admin, Gerente y Liquidaciones) se cargan los pagos a
  entes y proveedores, los honorarios, los gastos, las comisiones del personal y las
  señas, siempre en una caja o un banco. Los pagos a locadores se registran desde su
  cuenta corriente (*Pagar al locador*), que escribe el egreso y descuenta su saldo
  a la vez.
- **Conversión de moneda**: de una cuenta a otra de distinta moneda, con el tipo de
  cambio escrito a mano. El sistema nunca convierte solo.
- **Recibos**: los recibos de cobro con número, fecha, inquilino, propiedad e importe,
  para reimprimirlos.

**Custodia.** La sección de custodia muestra el efectivo que la inmobiliaria guarda
para cada locador, por moneda. *Entregar* registra que el locador lo buscó o que se
depositó: todo el saldo o una parte, con la fecha. No se puede entregar más de lo que
hay, y queda una fila de auditoría. La custodia es parte del saldo del locador:
la entrega queda en su cuenta corriente como *Entrega de efectivo*.

**Compensaciones.** Cuando el inquilino de un contrato le transfiere a otro locador de
la inmobiliaria (para no mover efectivo), el cobro se registra como recibido por el
locador y, en el detalle de la liquidación, *Registrar compensación* sobre ese cobro
pide quién recibió, a qué locador del contrato le
correspondía y cuánto (sin importe, su parte en ese cobro). Si quien recibió tiene
efectivo en custodia, la compensación se puede pagar con él: sale de su custodia y
entra en la caja, donde queda para el otro locador. La suma de las compensaciones no
supera el cobro y, por defecto, puede cubrir cualquier locador de la inmobiliaria (se
puede limitar a los del mismo contrato).

**Convenciones de la caja.** En `/configuracion/valores-por-defecto` → *Caja y cobros*
se eligen: qué debe el locador que cobra directamente (todo lo ajeno o solo lo de la
inmobiliaria), cómo se reparte un pago parcial (proporcional o primero la
inmobiliaria), si la custodia suma en el total, la serie de los recibos (única, por
moneda o por cuenta), si se emite recibo cuando cobra el locador y entre quiénes se
admiten compensaciones.

Cuando una liquidación pasa su vencimiento sin pago, el cálculo de punitorios
corre por su cuenta según la configuración de la inmobiliaria. **Morosos**
(`/delinquency`) reúne a los inquilinos con liquidaciones vencidas, con la deuda,
la multa acumulada y los días de atraso; desde ahí se condona una multa, que es
una operación de Admin y Gerente. La pantalla es de Admin y Gerente.

#### Punitorios

El punitorio corre cada día sobre el **saldo impago** (no sobre el total) desde
el día siguiente al vencimiento, descontando los días de gracia, y tiene un tope.
La regla se elige en `/configuracion/valores-por-defecto` → *Punitorios* (la cambia
el Admin) y rige en todos los contratos que no fijan la suya. Los cálculos son:
monto fijo por día, porcentaje diario simple, porcentaje diario compuesto y
*la mayor entre la tasa activa del BNA y un porcentaje diario*: cada día se toma
la mayor entre 2 veces la tasa activa del Banco Nación (la TNA cargada en
*Índices*, dividida por 365) y el piso del 0,3 % diario. Sin tasa cargada rige el
piso, y la pantalla lo avisa. Un contrato puede tener su propia regla: en el
detalle, *Reglas vigentes* → *Cambiar la regla* la registra desde una fecha como
un acuerdo, o vuelve a la de la inmobiliaria.

**Opciones de la regla.** Además del cálculo, la regla (de la inmobiliaria o de un
contrato) fija cómo se aplican estas convenciones; el valor por defecto es el primero:
- *Pago parcial con punitorios*: primero el alquiler (el pago que cobra punitorios tiene
  que cubrir el total) o primero el punitorio (un pago parcial cobra la Multa y deja el
  resto a cuenta; el punitorio cobrado no devenga punitorio).
- *Redondeo*: una vez sobre el total, o cada día antes de sumar.
- *Base del tope*: el saldo al empezar la mora, o el total original.
- Con la tasa del BNA: *nominal* (TNA dividida por 365) o *efectiva* (TEA convertida a
  diaria compuesta); *días del año* 365 o 360; y qué hacer en los días sin tasa
  cargada: aplicar el piso diario o no devengar esos días (la pantalla los avisa).

Se mantienen estas reglas: rige la regla vigente en la fecha de devengo para toda la
mora; un pago con fecha anterior a lo ya devengado no revierte las filas registradas; y
condonar no frena el devengo futuro sobre el alquiler que sigue impago.

**Cobro en la liquidación siguiente.** Al generar el período siguiente, los
punitorios devengados que no se cobraron ni se condonaron entran como un renglón
*Multa* (comisionable, para el locador). Cada punitorio se cobra una sola vez; si
se borra el borrador o se anula la liquidación, vuelven a quedar pendientes.

**Calcular el monto a pagar hoy.** En el detalle de una liquidación enviada o
vencida, *Calcular para pagar hoy* da el saldo más los punitorios devengados a la
fecha elegida, sin guardar nada: es el monto exacto para pasarle al inquilino.
*Registrar el pago con punitorios* agrega la Multa a la liquidación y registra el
pago; tiene que cubrir el total. El recibo en PDF ya trae el renglón de punitorios.
Un pago común que salda una liquidación vencida deja fijado el devengo hasta esa
fecha, que pasa a la liquidación siguiente.

**Condonar.** En el detalle del contrato, *Punitorios* lista lo devengado; *Condonar*
(uno) o *Condonar todos* piden un motivo obligatorio y quedan auditados. Un punitorio
condonado no entra en la próxima liquidación ni se vuelve a devengar. Lo pueden hacer
Admin y Gerente; uno ya cobrado en una liquidación no se puede condonar.

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

### Cuenta corriente del locador

**Locadores** (`/locadores`; la ven Admin, Gerente, Liquidaciones y Lectura) lista a
cada locador con su saldo por moneda, cuánto de ese saldo está en custodia, cuánto
falta pagarle y su último estado emitido. Al abrir uno se ve su **cuenta corriente**:
los movimientos de una moneda, del más viejo al más nuevo, con el saldo después de
cada uno. Se filtra por fechas; el saldo anterior a la fecha *Desde* abre la lista.

**Cómo se lee el saldo.** Positivo: la inmobiliaria le debe al locador. Negativo: el
locador le debe a la inmobiliaria. Los movimientos se escriben solos:

- Un cobro que recibe la inmobiliaria suma la parte del locador de cada concepto
  (alquiler, punitorios, impuestos y servicios que le corresponden) y resta la
  comisión y los gastos administrativos. Con dos locadores al 50 %, un alquiler de
  100000 y comisión del 7 %, cada uno queda con +50000 −3500 = **46500 a favor**.
- Si el efectivo queda en **custodia**, es lo mismo: es dinero del locador que
  guarda la oficina, y la pantalla muestra cuánto del saldo está en custodia.
- Si el inquilino le pagó **al locador**, se ven los mismos conceptos y, además,
  *Cobrado directamente* por lo que ya tiene en mano: el saldo queda en lo que le
  debe a la inmobiliaria (en el ejemplo, **−3500**, la comisión).
- Una **compensación** resta a quien cobró y suma al locador al que le correspondía.
- Una boleta que el inquilino paga con el alquiler para el locador y que pagó la
  inmobiliaria resta como *Pago a ente*.
- Los gastos al locador del centro de carga restan al generar su estado de cuenta.

**Saldo inicial.** Cada locador arranca con un saldo inicial por moneda (el del último
acumulador). *Saldo inicial* lo carga o lo corrige: pide la moneda, el importe
(negativo si el locador le debe a la inmobiliaria), la fecha y un **motivo**, y queda
en la auditoría con el antes y el después. Es una operación de Admin y Gerente. Un
saldo inicial que ya está en un estado emitido no se corrige: hay que anular el
estado primero.

**Pagar al locador.** *Pagar al locador* (Admin, Gerente y Liquidaciones) registra
una transferencia o una entrega de efectivo desde una caja o un banco de la
inmobiliaria: sale de la cuenta como *Pago a locador* y resta de su saldo, en una
sola operación. Puede dejar el saldo negativo (un adelanto). El efectivo que está en
custodia no se paga desde acá: se **entrega** desde la caja (*Custodia* →
*Entregar*), y también resta del saldo.

### Estado de cuenta mensual

**Estados de cuenta** (`/estados-de-cuenta`) reemplaza a los acumuladores: un estado
por locador, mes y moneda, con **todas sus unidades** y el saldo que viene del mes
anterior.

- *Generar el mes* (Admin, Gerente y Liquidaciones) arma un **borrador** para cada
  locador con movimientos o con saldo; volver a generar recalcula los borradores. Al
  generar se descuentan los gastos al locador del centro de carga de ese mes (o
  hasta ese mes): cada uno queda *Imputado* en el estado.
- El detalle muestra el **saldo anterior**, el saldo inicial (si lo hay), los
  **créditos**, los **descuentos**, los **pagos** (transferencias, entregas y lo que
  cobró directamente) y el **saldo al cierre**, con los movimientos agrupados por
  unidad.
- *Emitir* cierra el mes: los movimientos quedan fijos en ese estado y el mes
  siguiente arranca de su saldo al cierre. Un estado emitido no se vuelve a generar.
- *Descargar PDF* baja el estado para imprimirlo o mandarlo por WhatsApp o por mail.
  El envío automático desde el sistema llega más adelante.
- *Anular* (Admin y Gerente) pide un motivo y libera los movimientos, que vuelven a
  entrar en el próximo estado que se genere. Solo se anula el último emitido de cada
  locador y moneda. Los gastos que ya se descontaron siguen en la cuenta corriente.

Si un estado no cuadra, lo primero a revisar es la comisión del contrato y el saldo
inicial del locador.

### Rendiciones (histórico)

**Rendiciones** (`/renditions`) quedó como **histórico**: muestra y descarga en PDF
las rendiciones por contrato hechas antes de la cuenta corriente, pero ya no se
generan, no cambian de estado, no se editan ni se envían. Lo que se le liquida a cada
locador está ahora en su cuenta corriente y su estado de cuenta mensual.

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

**Reportes** (`/reports`) genera estado de cuenta del propietario (desde la cuenta
corriente, con las rendiciones históricas marcadas como tales), rentabilidad
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
pantallas de configuración específicas: la fiscal (`/configuracion/fiscal`),
las etapas del embudo (`/configuracion/pipeline`), los pesos del puntaje de
inquilinos (`/configuracion/scoring`) y los índices de ajuste
(`/configuracion/indices`) y los valores por defecto
(`/configuracion/valores-por-defecto`); y, además, la del equipo
(`/configuracion/usuarios`) y la de permisos de lectura (`/configuracion/permisos`).

### Valores por defecto

`/configuracion/valores-por-defecto` (Admin y Gerente) reúne los valores con los que
arranca cada contrato nuevo y cada cálculo de la inmobiliaria: el día de
vencimiento (de fábrica el 10), los días de anticipación con que se genera la
liquidación (10, es decir el día 20), el rezago del IPC (2 meses), la comisión de
administración (7 %), los honorarios por alta, renovación y venta (5 %, 5 %, 3 % si
es construido y 5 % si es lote), la tasación (USD 100), el umbral de anticipo (2
honorarios), la cadencia de cobranza (primer recordatorio a los 5 días y después
cada 5), el semáforo de vencimientos de contratos (rojo a los 0 días, amarillo a
los 60) y las cuatro convenciones de liquidación (prorrateo de un mes parcial, ajuste a
mitad de mes, primer mes con inicio tardío y descuento de monto fijo; de fábrica, días
reales, desde el período siguiente, vence el día de inicio y proporcional). La sección
*Estado de cuenta del locador* fija el **día de cierre** del estado (vacío = fin de
mes; con un día, lo posterior va al estado del mes siguiente) y **cuándo se descuentan
los gastos al locador** (al generar el estado, de fábrica, o recién al emitirlo; en
ese caso el borrador los muestra como previstos). Cada campo muestra debajo el valor de fábrica. Cambiá lo que necesites y
tocá *Guardar valores*; *Volver a los valores de fábrica* los restaura en el
formulario (hay que guardar para aplicarlo).

Cambiar un valor por defecto no toca los contratos que ya existen: rige para los
que se carguen desde ese momento, y cada contrato o acuerdo puede después fijar
el suyo.

### Importaciones desde el sistema anterior

`/configuracion/importaciones` (solo Admin) muestra los lotes que los scripts de migración enviaron a la API: cada uno con su fecha, su origen, el modo (*Ensayo*, *Ejecución* o *Todo o nada*), su estado y la cantidad de filas y de errores. Al abrir un lote se ve el resumen por entidad (personas, propiedades y contratos, con cuántas filas fueron creadas, actualizadas, sin cambios o con error) y el registro de cada fila, con el código y el mensaje de cada error. El selector *Mostrar filas* deja solo las que tuvieron error y *Descargar errores (CSV)* baja ese listado para corregir el origen. Un ensayo no escribe nada; un lote *Todo o nada* que quedó *Fallido* tampoco: no se cargó ninguna fila. El procedimiento completo está en `docs/tesis/32-migracion.md`.

### Calidad de datos

`/calidad-de-datos` lo ven Admin y Gerente. Junta lo que conviene revisar después de una migración o de una carga manual, agrupado por tipo de problema. Arriba hay una tarjeta por control con la cantidad de hallazgos (en verde si es cero); al tocar una se listan sus hallazgos debajo, con el dato involucrado y un enlace *Abrir* a la ficha donde se corrige. *Corregir* marca lo que rompe una liquidación o un cobro; *Revisar* marca lo que puede ser legítimo (por ejemplo, una familia que comparte teléfono).

Los controles son:

- *Personas repetidas*: mismo CUIT o CUIL, DNI (también el que lleva el CUIL), CBU, teléfono, correo o nombre. Se comparan sin importar guiones, puntos, mayúsculas, tildes, el +54, el 9, el 0 ni el 15 del teléfono. Dos personas con el mismo nombre pero documentos distintos no se marcan.
- *Locadores que no suman 100 %*: contratos activos cuyos locadores vigentes no reparten el cobro completo. Se corrige en la pestaña de locadores del contrato.
- *Titulares que no suman 100 %*, *Propiedades sin titular*, *Cobran por transferencia sin cuenta* y *Locadores sin CUIT ni DNI*: titularidades incompletas.
- *Vencidos sin decisión*: contratos vencidos cuyo fin (el real, si hay prórroga, o el pactado) ya pasó y que no tienen renovación ni cierre. Se resuelven renovando o cerrando el contrato.
- *Contratos activos incompletos*: sin inquilino, sin alquiler o sin el porcentaje de ajuste que su tipo pide. El contrato no guarda un día de vencimiento propio (lo definen las reglas de cargos), así que no se controla acá.

El panel no cambia nada por sí solo. Los hallazgos desaparecen cuando se corrige el dato: no hay que marcarlos como resueltos. No hay una opción de ignorar un hallazgo; un caso legítimo (una familia con un teléfono compartido) queda en la lista y se distingue por el tipo de control.

#### Unir personas repetidas

En un hallazgo de personas repetidas, el Admin tiene el botón *Unir*. Se elige a la persona que se conserva y la pantalla pide a la API la vista previa: lista, por tipo de dato, lo que va a pasar a la persona que se conserva (contratos, locadores, titularidades, cuentas, roles, poderes, reclamos, rendiciones...) y lo que se descarta porque ya existe en ella (un rol repetido, una cuenta con el mismo CBU). Al confirmar:

- todo lo que apuntaba a las otras personas pasa a la conservada, en una sola operación: o se hace todo o no se hace nada;
- los datos que la conservada tenía vacíos (correo, teléfonos, CUIT, DNI, domicilio, forma de cobro...) se completan con los de las otras;
- las otras quedan dadas de baja, sin CUIT, con una nota que dice con quién se unieron; no se borran, y siguen consultables entre las personas inactivas;
- queda una fila de auditoría con el antes y el después de cada persona.

La unión se rechaza con un aviso, sin cambiar nada, si hay datos que no se pueden combinar: las dos personas tienen perfil de proveedor, acceso al portal, puntaje de inquilino, una rendición del mismo contrato y período, un movimiento de cuenta corriente del mismo origen (por ejemplo, las dos tienen saldo inicial en la misma moneda), un estado de cuenta del mismo mes y moneda o una custodia en la misma moneda, o hay un poder entre ellas. Hay que resolver eso primero (por ejemplo, dar de baja el perfil que sobra). La unión no se deshace sola: si hubo un error, se corrige a mano con la auditoría a la vista.

### Permisos de lectura

`/configuracion/permisos` (solo Admin) decide qué roles pueden leer los datos sensibles: cuentas bancarias, documento (DNI y CUIT), comisión de los contratos, rendiciones, reportes financieros, facturas y auditoría. La tabla tiene un recurso por fila y un rol por columna; la casilla del Admin está fija porque siempre lee todo. Marcá o desmarcá, tocá *Guardar cambios* y confirmá: rige desde el próximo pedido de cada persona del equipo. *Abrir todo* vuelve a dar lectura a todos los roles (y hay que guardar para aplicarlo). Mientras no se cambie nada, todos los roles leen todo. Un rol sin acceso ve un aviso de *Sin acceso* en esas pantallas, los documentos y cuentas ocultos en las fichas, y no ve esas opciones en el menú.

### Usuarios: alta del equipo y contraseñas

`/configuracion/usuarios` lista a las personas de la inmobiliaria con su estado:
*Invitado* (todavía no aceptó), *Activo* o *Desactivado*. El Admin gestiona el
equipo; el Gerente lo ve en solo lectura y los demás roles no tienen la pantalla.
Se llega desde *Usuarios* en el menú o desde la tarjeta en `/configuracion`.

**Invitar a alguien.** *Invitar usuario*, correo y rol. Al crear la invitación se
abre una ventana con el **enlace para compartir**. Mientras la plataforma no
envíe correos, es el Admin quien lo manda a mano —por WhatsApp o el medio que
prefiera— con *Copiar enlace*. El enlace sirve **una sola vez**, vence a los
7 días y se muestra en esa ventana una única vez: no queda guardado en claro, así
que si se pierde hay que usar *Reenviar invitación* en la fila, que genera uno
nuevo e invalida el anterior. La persona abre el enlace, escribe nombre, apellido
y una contraseña de al menos 8 caracteres, y entra directamente con el rol que se
le asignó.

**Cambiar el rol, desactivar y reactivar.** Cada fila tiene *Cambiar rol*,
*Desactivar* o *Activar*. Desactivar pide confirmación y corta las sesiones
abiertas de esa persona de inmediato; se puede revertir con *Activar*. La
plataforma no deja desactivar la propia cuenta ni dejar a la inmobiliaria sin un
Admin activo: en ese caso avisa el motivo.

**Recuperar una contraseña.** Quien la olvidó entra a *¿Olvidaste tu contraseña?*
en la pantalla de ingreso, escribe su correo y recibe siempre el mismo mensaje,
tenga o no cuenta. Mientras no haya correo configurado no le va a llegar nada: en
ese caso el Admin usa *Enlace para cambiar contraseña* en la fila de la persona,
copia el enlace y se lo comparte. Ese enlace sirve **una sola vez** y vence a la
hora; al usarlo, la persona elige una contraseña nueva y se cierran todas sus
sesiones.

**Cambiar la propia contraseña.** En `/perfil`, *Contraseña*: se escribe la
actual y la nueva dos veces. Las sesiones abiertas en otros dispositivos se
cierran; la actual sigue.

### Ajustes del mes

`/ajustes` junta los ajustes de alquiler que vencen en un mes, para aplicarlos
todos de una vez en lugar de cargarlos contrato por contrato. La ven Admin,
Gerente y Liquidaciones.

Se elige el mes y la pantalla calcula, para cada contrato activo con un ajuste
pendiente hasta fin de ese mes, el alquiler actual, el nuevo, la variación y los
meses de índice que usó. Un ajuste que venía atrasado de un mes anterior aparece
marcado como *Atrasado*. Los índices que entran no son los del mes del ajuste sino
los de dos meses antes (el rezago de la inmobiliaria, que cada contrato puede
cambiar): el ajuste de abril usa el IPC publicado hasta febrero.

Cada fila tiene un estado:

- **Listo**: se calculó con valores oficiales.
- **A cuenta**: el INDEC todavía no publicó algún mes y se usó el valor estimado
  (por ejemplo el del REM). Se aplica igual, y cuando se publique el oficial el
  sistema lo corrige solo. La fila lo avisa.
- **Sin cambio (meses fijos)**: el contrato está dentro de sus meses iniciales sin
  ajuste.
- **Faltan datos**: falta el índice de uno o más meses y no hay estimado (o el
  pago a cuenta está apagado). La fila dice qué índice y qué meses faltan, no se
  puede elegir y enlaza a la carga de índices. Cargados los valores, *Actualizar*.
- **No se puede calcular**: falta el porcentaje o los escalones del contrato.

Se marcan las filas que se quieren aplicar (*Elegir todos* toma las aplicables),
*Aplicar* pide confirmación y muestra cuántas van a cuenta, y al terminar cada fila
muestra su resultado. Lo que no se pudo aplicar queda pendiente. Cada ajuste queda
en el registro de auditoría con la persona que lo aplicó.

**Pago a cuenta y corrección.** Cuando un ajuste se aplicó con un valor estimado y
el INDEC publica el oficial, el sistema recalcula el ajuste, deja el alquiler en el
valor oficial y guarda la diferencia de los meses ya facturados para incluirla en
una liquidación. Si el estimado se pasó, la diferencia es a favor del inquilino. Un
Admin o Gerente puede apagar el pago a cuenta en *Valores por defecto*: entonces un
ajuste sin índice oficial queda pendiente hasta que se publique. El proceso que
aplica los ajustes vencidos corre solo todos los días a las 7, después de la lectura
de índices de las 6; esta pantalla es para hacerlo a mano y a la vista.

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
