# Informe final

Este documento cierra el trabajo final de carrera. Reúne qué se propuso el
proyecto, qué quedó entregado, cómo está construido, cómo se verifica, en qué se
desvió de lo planificado, qué se aprendió en el camino y qué queda pendiente.

No repite los documentos que ya están en el repositorio: los referencia. La
planificación vive en `docs/tesis/01-` a `04-`; el estado del sistema en cada
etapa, en los documentos de hito; las decisiones técnicas, en los registros de
`docs/adr/` (índice en `docs/adr/README.md`); y la documentación de uso y
operación, en `docs/api.md`, `docs/pruebas.md`, `docs/manual-de-usuario.md`,
`docs/despliegue.md` y `docs/demo.md`.

El informe tiene dos partes, en correspondencia con el Hito 4 reabierto
(`hito-04.md`). Las secciones 1 a 8 son la primera versión, cerrada como versión
beta el 18/08/2026 y completada con la revisión de calidad hasta el 28/10/2026:
describen el sistema antes del piloto y sus cifras son las de esas mediciones, que
se conservan sin reescribir para que se pueda ver de dónde partió el trabajo. La
sección 9 es la validación en uso real en una inmobiliaria, que empezó el
30/10/2026, e incluye la **tabla única de cifras del sistema** con su fecha y su
fuente de medición (sección 9.10). Donde una cifra de las secciones 1 a 8 difiere de
esa tabla, vale la de la tabla; los resultados de campo que todavía no existen
figuran como «a completar» con la fecha del ciclo que los produce.

---

## 1. Objetivo y alcance cumplido

El objetivo general declarado en `01-alcance-y-objetivos.md` fue diseñar e
implementar una plataforma multi-inmobiliaria que cubriera el ciclo completo de
gestión de alquileres, desde la captación del interesado hasta la rendición al
propietario, sobre una arquitectura de monorepo TypeScript y con foco explícito
en el contexto regulatorio argentino.

Ese objetivo se cumplió. El sistema entregado recorre el circuito entero sin
intervención manual sobre la base de datos: una consulta del micrositio público
genera un interesado, el interesado se convierte en contrato, el contrato se
ajusta por índice, produce liquidaciones, las liquidaciones se cobran, el cobro
se factura electrónicamente y se rinde al propietario descontando la comisión
pactada. Cada uno de esos pasos es una pantalla del sistema y tiene su prueba de
integración.

De los objetivos específicos, seis se entregaron completos: el modelado del
dominio, el cálculo de actualizaciones con tabla histórica de índices, las
liquidaciones mensuales con líneas configurables y su comprobante electrónico, el
portal de autogestión del inquilino, el módulo comercial con embudo configurable,
y el esquema de auditoría, registro y permisos por rol operando en modo
multi-inmobiliaria. El séptimo —documentar la solución y validarla con pruebas
integrales y revisión de seguridad— se cumplió parcialmente: la documentación
está, la revisión de seguridad sobre el aislamiento se hizo y dejó su registro en
el ADR-0006, y la validación automatizada existe a nivel de API, pero las pruebas
de navegador que el objetivo mencionaba no se entregaron. La sección 5 lo trata
en detalle.

Del alcance funcional comprometido, los quince puntos enumerados en el documento
de alcance están presentes en el sistema, con una salvedad sobre las modalidades
de ajuste que la sección 5 detalla: las entregadas no son exactamente las que ese
documento enumeraba. Las exclusiones se respetaron: no hay contabilidad completa,
tampoco captura de dinero por pasarela
de pago —se registra el pago, no se cobra—, no hay aplicación móvil nativa, no
hay firma digital con certificación oficial, no hay integración con portales
externos de publicación más allá de la exportación, no hay liquidación tributaria
y no hay operaciones de venta con escrituración. Con el piloto, cuatro de esas
fronteras se movieron —contabilidad, cobros, portales y ventas— sin levantar las
exclusiones; la sección 9.2 lo detalla.

En números, al cierre de este informe el sistema son treinta y un módulos en la
API sobre un modelo de cincuenta y cinco entidades y treinta y nueve
enumeraciones, con veintiuna migraciones versionadas; treinta y cuatro
controladores que declaran doscientas veintiséis rutas; y una aplicación web con
dieciocho secciones internas más el portal del inquilino y el micrositio público
de cada inmobiliaria. Son unos treinta mil quinientos renglones de TypeScript
en la API, treinta y dos mil novecientos en la web y cuatro mil cien en el
paquete de tipos compartidos, sin contar las pruebas, que suman otros treinta mil
ochocientos.

El historial acumula doscientos ochenta y dos commits de trabajo repartidos
entre los tres integrantes, incorporados a la rama principal a través de
setenta pedidos de incorporación, sesenta y uno de ellos con revisión
de otro integrante; los nueve restantes se incorporaron sin esa revisión. El cronograma tuvo veintinueve ítems y cuatro hitos.

---

## 2. El sistema entregado

Lo que sigue es un recorrido por dominio. Para el orden en que conviene mostrarlo
frente al tribunal, `docs/demo.md`; para el detalle de cada pantalla,
`docs/manual-de-usuario.md`; para el catálogo de rutas, `docs/api.md`.

### Propiedades y personas

Las propiedades se cargan con su dirección, sus características y sus fotos, y
llevan una o más operaciones —alquiler, venta— cada una con su precio, su moneda
y su estado. El procesamiento de las imágenes es del servidor, que produce
original y miniatura y las guarda en almacenamiento externo con enlaces firmados
por petición. Resuelve el problema de que la ficha de la propiedad y su precio
publicado dejen de vivir en una planilla y una carpeta compartida.

Las personas son un único registro con varios roles simultáneos: la misma persona
puede ser propietaria de un inmueble e inquilina de otro. Es una decisión de
modelo, no una comodidad de pantalla, y evita el problema clásico de tener a la
misma persona duplicada en tres listados con datos que se desincronizan.

### Contratos, garantías y plantillas

El contrato vincula una propiedad, un inquilino y sus garantías —propietarias,
salariales o de caución—, y guarda la comisión pactada de la inmobiliaria, que es
el parámetro que después determina lo que recibe el propietario. El documento del
contrato se genera a partir de plantillas con variables que se resuelven contra
los datos reales, de modo que el texto que se firma no se copia y pega de un
archivo anterior.

### Actualización por índices

Cada contrato declara su modalidad de ajuste y su periodicidad, y el sistema
mantiene un cronograma de ajustes que se calcula y se aplica en la fecha pactada.
Los valores de los índices se cargan en una tabla histórica, con obtención
automática y carga manual como camino alternativo. La decisión de dominio más
delicada del módulo es que los índices se consumen como variación del período y
no como nivel absoluto; confundir las dos cosas produce factores de ajuste sin
sentido, y es el tipo de error que ninguna prueba detecta si la prueba asume el
mismo malentendido. Resuelve el cálculo que hoy la inmobiliaria hace a mano cada
vez que un contrato entra en su ventana de actualización, que es donde se
concentra el riesgo de error.

### Liquidaciones

La liquidación del mes se genera para todos los contratos activos del período en
una sola operación, que informa cuántas produjo y cuántas omitió porque ya
existían. Cada liquidación tiene líneas —alquiler, ajuste, expensas, servicios,
impuestos, honorarios, punitorios y líneas manuales—, una máquina de estados con
transiciones válidas declaradas, y su comprobante en PDF. Es la operación que abre
el mes, y la que reemplaza la planilla que se rearma cada treinta días.

### Pagos y morosidad

Los pagos se imputan contra la liquidación, admiten pago parcial y dejan el saldo
a la vista. Sobre eso se apoya la mirada agregada de deuda pendiente y deuda
vencida, y el cálculo de punitorios, que corre como tarea programada según los
parámetros configurados por cada inmobiliaria y no desde la pantalla. Los
punitorios se pueden condonar con motivo, y esa es una operación restringida.
Resuelve el problema de que la conciliación dependa del criterio de cada agente y
no quede registrada.

### Rendición al propietario

La rendición consolida lo efectivamente cobrado en el período, descuenta la
comisión pactada en el contrato y los conceptos deducidos discriminados, y
produce el depósito neto que recibe el propietario, con su comprobante en PDF y
su envío por correo. Es el módulo que cierra el circuito del dinero: sin él el
sistema sabía cuánto había cobrado pero no cuánto le correspondía a cada
propietario, que es exactamente el número por el que el propietario llama por
teléfono.

### Facturación electrónica

Cada inmobiliaria carga su certificado, con la clave privada cifrada, y puede
operar con más de un emisor: los propios y los delegados por terceros. El sistema
sincroniza los puntos de venta, lleva la numeración por punto de venta, emite
facturas A, B y C, consulta el padrón por identificación fiscal para completar los
datos del receptor, produce notas de crédito contra un comprobante emitido y
exporta el libro de IVA ventas. La anulación es fiscal —una nota de crédito— y no
un borrado, que es la única forma en que puede ser.

### Reclamos y proveedores

El reclamo de mantenimiento tiene categoría, prioridad, responsable interno,
proveedor asignado, costo del trabajo y vencimiento de acuerdo de nivel de
servicio, con una máquina de estados y un hilo de comentarios que cruza el ámbito
interno y el del inquilino. Los proveedores se habilitan por rubro y por zona, así
que la asignación ofrece los que corresponden en lugar de una lista completa.
Reemplaza la conversación de mensajería donde el reclamo se pierde y nadie sabe a
quién se le había pedido el presupuesto.

### Portal del inquilino

El inquilino entra con credenciales propias —un ámbito de sesión distinto del
personal, con su propio circuito de invitación, definición de contraseña y
rotación del token de refresco— y ve su contrato, sus liquidaciones con el aviso
de saldo pendiente y el PDF de cada una, y puede abrir un reclamo con adjunto y
seguirlo. Resuelve la falta de un canal autogestionado: la consulta de saldo y la
descarga del comprobante dejan de ser un pedido por teléfono.

### Micrositio público

Cada inmobiliaria tiene su catálogo público con sus colores y su logo, filtrable
por operación y ciudad, con ficha por propiedad y formulario de consulta que
genera un interesado dentro del sistema. Es la única parte que se sirve sin
sesión, y cierra el círculo entre la publicación y el seguimiento comercial.

### Gestión comercial

Los interesados se cargan con su origen, se ubican en una etapa de un embudo
configurable por inmobiliaria, acumulan interacciones y visitas, y se convierten
en contrato o se descartan con motivo. Sobre eso se apoya la analítica del embudo.
Resuelve la pérdida del seguimiento comercial al no existir un registro
integrado al ciclo del contrato.

A eso se suman el puntaje interno del inquilino —cinco componentes ponderables por
inmobiliaria, con el total calculado siempre en el servidor— y las tasaciones, con
historial por propiedad y comparables de la propia cartera por ciudad, tipo y
cantidad de ambientes.

### Reportes e indicadores

Hay seis reportes —estado de cuenta del propietario, rentabilidad por propiedad,
flujo de caja, resumen de comisiones, analítica del embudo comercial y
morosidad—, cada uno descargable en Excel y en PDF, con envío programado por
correo. El panel agrega la tendencia de ocupación de los últimos doce meses, la
composición de la cartera y las fichas de cobranzas, morosidad y reclamos, sobre
un caché de métricas por inmobiliaria. El criterio de diseño del panel es que sea
una lista de tareas y no un tablero: cada ficha lleva al listado que la explica, y
la sección de lo que requiere atención enlaza al registro concreto.

Se suman la importación desde planilla con validación previa fila por fila —el
error se informa antes de escribir nada—, la exportación de los listados, las
plantillas de correo con previsualización, y los avisos por vencimientos, deudas y
cambios de estado.

### Las dos funciones con modelo de lenguaje

La primera ordena los pendientes del día. El sistema arma el contexto —cobranzas
vencidas, reclamos con acuerdo de nivel de servicio pasado, interesados sin
contacto reciente—, lo seudonimiza dejando una referencia opaca y los datos
objetivos de cada pendiente, y le pide al modelo el orden y una explicación de una
línea por caso. La respuesta se valida contra un esquema y los datos locales se
reponen contra el contexto: una referencia que no salió de ahí se descarta. Si no
hay modelo configurado, si la llamada no vuelve a tiempo o si la respuesta no
cumple el esquema, el orden lo resuelven reglas propias, y la respuesta declara
cuál de los dos caminos corrió.

El panel además **nunca espera al modelo**: responde con el orden por reglas y pide
el del modelo en segundo plano, que queda disponible unos segundos después. Es una
decisión que se tomó después de medir: pedirlo en línea agregaba once segundos a la
primera carga del día, sobre una pantalla que es la primera que alguien abre. El
efecto lateral es que la pantalla muestra en vivo las dos capas, porque la leyenda
al pie cambia sola cuando llega el orden del modelo.

La segunda redacta el resumen de gestión al cierre de un contrato. Acá la regla
que ordena todo el módulo es que las cifras las calcula el servidor y el modelo
sólo las redacta: las métricas del contrato —puntualidad de pago, atraso
promedio, punitorios, reclamos, ajustes aplicados, variación del alquiler,
rendiciones— se computan de forma determinista contra los registros reales, se
proyectan a una vista sin un solo campo de datos personales, y se le manda esa
grilla ya cerrada pidiéndole únicamente prosa. La estructura de respuesta que se
espera no tiene ningún campo numérico, así que no hay lugar donde pueda aparecer
un número inventado; y por si el texto libre trae uno, una verificación recorre
cada número del resumen y lo compara contra las cifras de la grilla, con sus
redondeos razonables. Si aparece una cifra ajena, el resumen se descarta y lo
redactan las plantillas deterministas.

---

## 3. Arquitectura y decisiones

La arquitectura general está en `03-arquitectura.md` y las decisiones, con su
contexto, sus alternativas y sus consecuencias, en los registros de
`docs/adr/`: seis al cierre de la primera versión, a los que el piloto sumó once
(sección 9.4). El monorepo con Turborepo sobre espacios de trabajo de pnpm es el
ADR-0001; la elección de NestJS, Next.js y Prisma sobre PostgreSQL, el ADR-0002;
el aislamiento por fila, el ADR-0003; el sistema de tarjetas para las pantallas
con registros repetidos, el ADR-0004; la respuesta uniforme de error, el ADR-0005;
y el endurecimiento del aislamiento, el ADR-0006. No tiene sentido reescribirlos
acá. Vale detenerse en las tres decisiones que un tribunal va a querer discutir.

### El aislamiento entre inmobiliarias, y por qué se lo hizo fallar cerrado

La decisión original (ADR-0003) fue aislamiento por fila: una sola base, una
columna de inmobiliaria en cada tabla del dominio, y el identificador saliendo
siempre del token verificado y nunca del cuerpo ni de la consulta. Se descartaron
esquema por inmobiliaria y base por inmobiliaria por el costo operativo de aplicar
las migraciones a tantos destinos como clientes, y porque el volumen esperado no
lo justificaba.

El riesgo asumido al elegirlo está escrito en ese mismo ADR: el aislamiento pasa a
depender de que el filtro se aplique en cada consulta. La implementación lo mitigó
con contexto de petición propagado por almacenamiento asíncrono y una extensión
del cliente de base de datos que inyecta el filtro en las lecturas, en las
mutaciones y en las creaciones.

El problema, que la revisión previa a la etapa de pruebas encontró, era qué hacía
esa extensión cuando **no** había inmobiliaria en el contexto: nada. La consulta
pasaba sin filtro. Eso es fallar abierto, y se combina mal con el resto del
diseño: un endpoint sin guard, un servicio invocado desde una tarea programada
—donde no hay petición y por lo tanto no hay contexto—, una llamada que perdió el
contexto asíncrono. En todos esos casos la consulta no fallaba: devolvía las filas
de todas las inmobiliarias, y el código que la había llamado las trataba como
propias.

Lo que vuelve grave ese defecto es que no se parece a un error. Un listado que
devuelve más registros de los que corresponde se ve como un listado. En un
ambiente con una sola inmobiliaria cargada es indistinguible del comportamiento
correcto, y sólo se manifiesta cuando hay una segunda con datos: en producción. La
revisión encontró dos consultas que ya lo estaban haciendo —la de los emisores
fiscales en el resumen del panel y la de valores de índice en el servicio de
aplicación de ajustes vencidos—, ninguna de las dos había fallado nunca, y las dos habían pasado
revisión por pares.

La decisión del ADR-0006 fue invertir el comportamiento por omisión: sin
inmobiliaria en el contexto y sin exención explícita, la operación lanza un error
nombrado en lugar de ejecutarse. Se contemplaron los dos accesos legítimos sin
sesión con mecanismos distintos y visibles: el trabajo de sistema que abarca
varias inmobiliarias —las tareas programadas, la resolución del micrositio— lee
por el cliente sin extensión y escribe su filtro a mano al lado, y los flujos
donde la inmobiliaria todavía no se conoce —ingreso, registro, refresco de
sesión— usan una exención acotada dentro de un bloque que la apaga al terminar.
La ganancia no es sólo la corrección de los dos casos: es que la superficie a
auditar quedó reducida a un conjunto enumerable, y que el mismo defecto que antes
era invisible ahora es ruidoso.

Se evaluó y se descartó la seguridad a nivel de fila del propio motor, que es la
solución más fuerte. Las razones están en el ADR: exige propagar la identidad a la
sesión de base en cada transacción, lo que con un fondo común de conexiones no es
directo, y partiría el aislamiento en dos lugares —las migraciones y la
aplicación— en vez de uno. Queda como el camino natural si el proyecto crece más
allá de este alcance.

### Multi-emisor en facturación electrónica

La forma simple de modelar la facturación era una configuración fiscal por
inmobiliaria: un certificado, una identificación fiscal, un conjunto de puntos de
venta. Se eligió lo contrario: el certificado pertenece a la inmobiliaria, pero
los emisores son entidades propias, y una inmobiliaria puede tener varios.

La razón es del negocio y no del código. Una inmobiliaria factura sus honorarios
con su propia identificación fiscal, pero además factura por cuenta y orden de
propietarios que le delegaron la emisión, cada uno con su identificación, sus
puntos de venta y su numeración independiente. Con una configuración única, esos
casos se resuelven cargando y descargando certificados a mano o abriendo una
inmobiliaria por propietario, que es peor. El costo de la decisión es un modelo
más grande y un asistente de emisión con un paso más —elegir el emisor—; el
beneficio es que la numeración por punto de venta y por emisor queda consistente
sin trabajo manual.

Ese modelo se extendió para facturar por cuenta del locador (ADR-0017): un emisor
delegado es un emisor con la persona del locador, y la inmobiliaria factura el
alquiler con su delegación en ARCA, nunca a nombre propio. Qué se factura, cuándo
y con qué IVA es configuración con valores conservadores, y la emisión pasa por una
cola idempotente por origen y locador, de modo que un fallo de ARCA no rompe el
cobro y repetir una emisión no factura dos veces.

La clave privada del certificado no se guarda en claro. Se cifra con un esquema de
sobre: cada certificado se cifra con una clave de datos propia, generada al azar
en el momento, y esa clave se envuelve con una clave maestra que vive en la
configuración del ambiente y nunca en la base. La clave de datos no sale del
servicio que la usa, y el esquema admite rotar la clave maestra reenvolviendo las
claves de datos sin volver a cifrar los certificados. La clave maestra se valida
en el primer uso y no en el arranque, para que una inmobiliaria que no factura
electrónicamente no dependa de una configuración que no le corresponde.

### Cómo se usó el modelo de lenguaje

La decisión de fondo es que el modelo no calcula y no ve datos personales, y que
el sistema funciona igual si el modelo no está.

Al modelo se le manda una vista construida a propósito: en la priorización, una
referencia opaca por pendiente y sus datos objetivos; en el resumen de cierre, una
grilla de métricas con los nombres de campo en castellano y sin un solo campo para
nombre, documento, correo, teléfono, domicilio, propiedad ni identificador
interno. Las dos vistas se arman copiando campo por campo y no descartando los que
sobran, de modo que una métrica nueva queda afuera hasta que alguien la agregue a
propósito: el comportamiento por omisión es no compartir.

La salida se valida antes de usarse. En la priorización, contra un esquema
declarado, y después se reponen los datos locales contra el contexto: el orden
puede venir de afuera, los datos nunca. En el resumen de cierre, la respuesta
esperada no tiene campos numéricos y además se verifica que ningún número del
texto sea ajeno a la grilla que se envió.

Y hay respaldo determinista en las dos funciones. Sin credencial configurada, con
la llamada cortada por tiempo, con un error del proveedor o con una respuesta que
no valida, el sistema entrega el mismo resultado calculado por reglas y
plantillas propias, y declara en la respuesta qué camino corrió. El cliente del
modelo no lanza nunca: cualquier falla se registra y se devuelve como ausencia de
respuesta.

---

## 4. Verificación y calidad

El detalle completo está en `docs/pruebas.md`. Acá el resumen y lo que quedó
afuera.

### Qué se prueba

Hay dos suites con propósitos distintos. Las **unitarias** prueban servicios,
controladores, guards y utilidades con sus dependencias sustituidas, corren en
memoria y no necesitan nada instalado: son sesenta y seis archivos —sesenta y
dos al lado del código y cuatro en el directorio de piezas transversales— con
setecientas diecinueve pruebas, a las que se suman las treinta del motor de
comprobantes del paquete compartido. Las **de integración** levantan la
aplicación completa, con sus guards, su filtro de errores, su extensión de
aislamiento y su cliente de base de datos, y le pegan por HTTP: son treinta y dos
archivos con cuatrocientas ochenta y cinco pruebas, que corren contra una base
PostgreSQL creada desde cero y se limpian entre casos en orden de dependencia.

La suite de facturación se agregó en la revisión final, cuando la facturación era
el único módulo central sin prueba de integración. Corre con el simulador de ARCA
activo y, al escribirla, encontró dos defectos del propio simulador que ninguna
prueba unitaria podía ver: la emisión seguía pidiendo el ticket de acceso real al
organismo, que exige un certificado cargado, y el módulo simulado no cargaba
fuera del ejecutor de pruebas. Es decir, el modo simulado que la guía de
demostración indicaba usar nunca había podido emitir un comprobante.

Tres de esas suites verifican decisiones de arquitectura y no lógica de dominio, y
son las que conviene mirar primero: la del aislamiento, que recorre los endpoints
sensibles con dos inmobiliarias y comprueba que ninguna llegue a los datos de la
otra; la de control de acceso, que verifica que cada rol alcance lo que le
corresponde y reciba 403 en lo que no; y la de traza de auditoría, que verifica
que las operaciones sensibles dejen registro con el usuario y la entidad afectada.
A nivel unitario, la prueba de la extensión de aislamiento la recorre operación
por operación y verifica que sin inmobiliaria en el contexto la consulta se
rechace en lugar de ejecutarse.

### Qué corre en integración continua

Cinco trabajos, en cada empuje a la rama principal y en cada pedido de
incorporación: estilo, compilación de los tres paquetes, unitarias con cobertura,
aplicación de todas las migraciones sobre una base vacía, e integración de la API
contra un PostgreSQL levantado como servicio. El de integración depende del de
unitarias, así que sólo corre si esas pasaron, y los cinco tienen tiempo máximo
declarado.

El trabajo de migraciones desde cero merece una mención porque no es un trabajo
obvio y existe por un incidente concreto. Los demás trabajos compilan pero nunca
ejecutan una migración, así que una migración con SQL inválido pasa la integración
continua entera y falla recién contra la base real; y al quedar registrada como
fallida, bloquea también todas las siguientes y traba el despliegue completo.
Aplicarlas desde cero en cada cambio, y terminar comparando el esquema contra las
migraciones, es lo que detecta eso antes de producción.

### Cobertura

La cobertura de líneas de la API es de **42,44 %**, con 43,52 % de funciones y
32,28 % de ramas. El piso exigido en integración continua es más bajo a propósito
—38 % de líneas, funciones y sentencias, y 27 % de ramas—, unos puntos por debajo
de lo que las suites cubren hoy, de modo que la integración continua se pone en
rojo cuando la cobertura baja y no cuando alguien no llega a una meta aspiracional.

Ese número no es un logro: es un objetivo a subir. Cuarenta y dos por ciento de
líneas significa que más de la mitad del código de la API no está cubierto por
pruebas unitarias. La distribución tampoco es uniforme: hay servicios centrales
—el de reclamos, el de usuarios, el de servicios de la propiedad— con cobertura
unitaria baja o nula, y los controladores de varios módulos no tienen prueba
unitaria propia. Lo que compensa parcialmente ese hueco son las pruebas de
integración, que atraviesan esos mismos servicios por HTTP y no cuentan para la
medición de cobertura porque corren en una suite aparte; pero compensar
parcialmente no es lo mismo que cubrir. Subir la cobertura, y en particular la de
ramas, es la primera tarea de mantenimiento que el proyecto tiene pendiente.

### Qué quedó afuera

**No hay pruebas de navegador.** Lo que este trabajo llama pruebas de integración
son pruebas de nivel HTTP contra la API real, no recorridos de interfaz. La
consecuencia es concreta y ya se pagó una vez: un error de contrato entre la
pantalla y el servidor no lo detecta ninguna de las dos suites. La sección
siguiente lo trata como desvío, que es lo que es.

**No hay pruebas de carga.** El ítem 27 del cronograma las contemplaba, acotadas,
sobre liquidaciones y reportes. No se hicieron. Los puntos donde el rendimiento
podría doler están identificados —la generación del mes recorre todos los
contratos activos, los reportes agregan sobre varias tablas— y sobre lo segundo se
puso un caché, pero no hay medición que sostenga ninguna afirmación sobre
capacidad, y por eso este informe no hace ninguna.

**Las tareas programadas no están cubiertas.** Corren por fuera del ciclo de una
petición, así que ninguna de las dos suites las ejercita como tales, y su lógica
sólo está probada a través de los servicios que invocan. Es un hueco reconocido:
una tarea programada que falla es invisible desde la interfaz, y ya pasó una vez
—faltaba registrar el planificador y durante un tiempo no corrieron ni los avisos,
ni el cálculo de punitorios, ni la obtención de índices, sin que nada lo
indicara—.

---

## 5. Desvíos respecto de la planificación

Un informe donde el plan coincide con el resultado sería sospechoso. Estos son los
desvíos, con su razón.

### La rendición al propietario se construyó fuera del backlog

El backlog priorizado (`04-backlog.md`) enumera los ítems 05 a 29 del cronograma,
y ninguno de ellos es la rendición al propietario. El caso de uso estaba declarado
desde la etapa de planificación —es el CU-13 en `02-roles-y-casos-uso.md`—, pero no
tenía ítem propio, y por lo tanto no tenía ventana en el cronograma ni sprint
asignado.

El desvío se detectó al cerrar el Hito 2: el sistema sabía cuánto había cobrado de
cada contrato, pero no cuánto le correspondía a cada propietario después de la
comisión y los conceptos deducidos, así que ese número se seguía calculando por
fuera. El documento del Hito 2 lo deja anotado como próximo paso en esos términos.
Se construyó durante el Hito 3, con su modelo, su comisión configurable por
contrato, su comprobante y su envío.

La lectura honesta es que el backlog tenía un agujero: enumeraba los módulos por
donde entra el dinero y no el que lo reparte. Se detectó tarde, aunque no
demasiado, porque el criterio de cierre del hito obligaba a recorrer el circuito
completo y ahí el faltante se ve.

### Las pruebas de navegador se planificaron y no se entregaron

El objetivo específico de `01-alcance-y-objetivos.md` mencionaba explícitamente
validar la solución con pruebas integrales de navegador, el ítem 27 del cronograma
las tenía como entregable principal, y el Hito 1 proponía además una primera suite
temprana, antes del sprint dedicado. Nada de eso está en el repositorio: no hay
configuración de navegador ni un solo recorrido de interfaz automatizado.

Lo que se hizo en su lugar fue construir la suite de integración de nivel HTTP
—treinta y dos archivos, cuatrocientas ochenta y cinco pruebas— y llevarla a integración
continua junto con la cobertura y las migraciones desde cero. Fue una decisión de
asignación de esfuerzo tomada en la última etapa: con el tiempo que quedaba,
cubrir la API completa por HTTP daba más señal por hora invertida que cubrir tres
o cuatro recorridos de pantalla.

No fue gratis, y el costo se puede señalar con un caso concreto: la transición de
estado de la rendición nunca había funcionado desde la interfaz porque la pantalla
enviaba un nombre de campo distinto al que esperaba el servidor. Las pruebas del
servicio pasaban, porque no atraviesan la pantalla; las de integración también,
porque le pegan a la API con el nombre correcto. Un recorrido de navegador lo
habría encontrado el primer día. Es exactamente la clase de defecto que la
decisión dejó descubierta, y hoy la única red que lo atrapa es la prueba manual.

### Las dos funciones con modelo de lenguaje se verificaron contra el proveedor recién al cierre

Los ítems 25 y 26 se entregaron con sus pantallas, sus endpoints y sus pruebas,
pero durante toda su construcción el camino del modelo corrió únicamente contra
dobles de prueba: el ambiente no tenía credencial del proveedor configurada y el
respaldo determinista cubría el resto. Recién al cierre se configuró la credencial
y se ejercitó el camino real.

Ese ejercicio encontró cuatro defectos, ninguno visible con dobles de prueba:

1. **La respuesta llegaba cortada.** El pedido reclamaba una entrada por cada
   pendiente del día —hasta treinta y dos— y el servicio se quedaba con las diez
   primeras. Se pide lo que se usa, lo que además reduce el costo por consulta a un
   tercio.
2. **El razonamiento del modelo consumía el presupuesto de la respuesta.** Medido
   contra el proveedor, dos mil un tokens antes de escribir la primera palabra. Se
   pide la respuesta sin razonamiento, porque las dos tareas son ordenar hechos ya
   calculados y redactarlos.
3. **Una sola entrada mal formada descartaba la respuesta completa** y el panel
   volvía al orden por reglas. Se valida entrada por entrada.
4. **Lo mismo en el resumen de cierre**, que había quedado sin la corrección
   anterior por descuido.

Después de eso, las dos funciones corren con el modelo en el ambiente de
demostración, y la interfaz sigue declarando en cada caso quién ordenó o redactó.
El respaldo determinista se conserva y no es decorativo: es lo que sostiene la
funcionalidad cuando el proveedor no está.

El desvío que se declara, entonces, no es de alcance sino de método: **una
integración con un servicio externo no está verificada hasta que se ejercita contra
el servicio externo**, y eso se dejó para el final.

### La documentación de las etapas anteriores estaba desalineada del sistema

Al llegar a la etapa de documentación, varios documentos de planificación
describían un sistema que no era el entregado. No eran matices:

- El modelo de datos documentado enumeraba entidades de facturación que el modelo
  entregado no tiene, y describía la configuración del ajuste en una tabla aparte
  cuando en el sistema vive en el propio contrato.
- Las modalidades de ajuste documentadas eran IPC, UVA y manual. Las entregadas son
  IPC, ICL, CCP, porcentaje fijo y personalizado, y la tabla histórica de índices
  admite IPC, ICL, CVS, CER y UVA. El cambio no fue arbitrario: el índice que la
  normativa vigente usa para los alquileres es el ICL, y la modalidad de ajuste que
  la planificación llamaba UVA quedó cubierta por el porcentaje fijo y el
  personalizado.
- Los roles documentados eran tres —administrador, agente, inquilino—. Los
  entregados son siete roles internos más el ámbito del portal.
- El catálogo de endpoints estaba desactualizado respecto de las rutas realmente
  expuestas.
- El documento del Hito 3 tenía recuentos de módulos y secciones que ya no
  coincidían con el sistema.

Todo eso se corrigió en la última etapa, con la documentación de planificación
puesta al día contra el sistema real. Pero corregirlo al final es peor que no
haberlo desalineado: durante meses hubo documentos que un lector habría tomado
como especificación y que describían otra cosa. La lección está en la sección
siguiente.

### Otros desvíos menores

El cronograma preveía el Hito 3 para el 30/10/2026 y el Hito 4 para el 30/11/2026;
el Hito 3 se cerró el 17/08/2026 y la versión beta de este informe, el 18/08/2026.
Esa fecha figuró durante dos meses como cierre del Hito 4, cuando en realidad fue
el cierre de la versión beta del informe; el hito se reabrió con la fecha del
cronograma, como se explica en la sección 9.8. La construcción
fue más rápida que lo planificado, lo cual explica en parte por qué la etapa de
pruebas y documentación quedó comprimida al final en lugar de haber acompañado al
desarrollo.

El plan de sprints contemplaba explícitamente recortar los ítems 25 y 26 —los de
menor prioridad— si los sprints finales necesitaban más tiempo para pruebas y
documentación. No se recortaron: se entregaron los dos, y el tiempo salió de otra
parte. Con lo que se sabe hoy, recortar uno de los dos y entregar los recorridos
de navegador habría sido la mejor decisión.

---

## 6. Lecciones aprendidas

Las lecciones de cada etapa están en sus documentos de hito. Las que siguen son
las que resistieron el proyecto entero y que se sostendrían frente a un tribunal.

**Compilar no prueba que una migración se pueda aplicar.** Es la lección más
barata de enunciar y la que costó un despliegue. La integración continua compilaba
los tres paquetes en cada cambio y no ejecutaba una sola migración; una que quedó
con una línea que no era SQL pasó todos los controles y falló contra la base real,
y al quedar registrada como fallida bloqueó las siguientes. El aprendizaje general
no es sobre migraciones: es que un artefacto que no se ejecuta en ningún control no
está verificado, por más que el proyecto entero compile. Lo que resolvió el
problema fue un trabajo que las aplica desde cero contra una base vacía en cada
cambio, que es lo más parecido a lo que hace el despliegue.

**Un aislamiento que depende de que ningún camino llegue sin sesión es una
convención, no una garantía.** El diseño era correcto y la implementación
inyectaba el filtro; lo que estaba mal era el comportamiento por omisión cuando
faltaba el contexto. Al invertirlo aparecieron dos consultas que ya leían datos de
otras inmobiliarias, en código que había pasado revisión por pares. La lección no
es "revisar mejor": es que la revisión no puede ver el filtro que falta, porque no
hay nada en la línea que lo delate. Un mecanismo de seguridad tiene que fallar
ruidoso cuando su precondición no se cumple, y si además se lo puede reducir a un
conjunto enumerable de excepciones declaradas, la auditoría deja de ser una lectura
del código entero.

**Las pruebas del servicio no ven los errores de contrato con la pantalla.** Hubo
transiciones de estado que nunca funcionaron desde la interfaz porque el nombre del
campo que enviaba la pantalla no coincidía con el que esperaba el servidor, con las
pruebas del servicio en verde. Generalizando: cada capa de prueba tiene un techo
que no es evidente desde adentro, y la pregunta útil no es "cuánto cubre esta
suite" sino "qué clase de error no puede detectar por construcción". La respuesta,
en este proyecto, define exactamente el hueco que dejaron las pruebas de navegador
que no se hicieron.

**Documentar en paralelo al desarrollo evita que la documentación describa un
sistema que no es.** Se aprendió por la vía cara, en la última etapa: había
documentos de planificación que describían entidades inexistentes, modalidades de
ajuste que no se implementaron y tres roles donde hay siete. Corregirlo fue posible
porque el sistema era la fuente de verdad y estaba a mano, pero el desfase existió
durante meses y esa clase de contradicción es justamente lo que se detecta en una
defensa. La regla operativa que queda es que un cambio de dominio y la
actualización del documento que lo describe pertenecen al mismo cambio, no a una
etapa posterior.

**Con un modelo de lenguaje sobre datos financieros, la única forma de sostener el
resultado es que el modelo no calcule.** No alcanza con pedirle que no invente:
hay que quitarle la oportunidad. Los números se calculan de forma determinista, la
estructura que se le pide no tiene campos numéricos, y lo que vuelve se verifica
contra las cifras conocidas. La versión general de la lección es que la integración
con un componente no determinista se diseña por lo que se le deja hacer y no por lo
que se le pide, y que la salida tiene que poder rechazarse: sin un camino
determinista al que caer, no hay validación posible, porque rechazar implicaría no
responder.

**El acoplamiento entre módulos es más fuerte de lo que sugiere el diagrama.**
Liquidaciones depende de contratos, de ajustes y de servicios; los reclamos, de
propiedades y de proveedores; la rendición, de los pagos y de la comisión.
Construir en el orden del backlog fue lo que evitó reescribir, y la contracara es
que el backlog es una decisión de arquitectura disfrazada de planificación: el
orden en que se enumeran los ítems determina cuánto trabajo se rehace.

**Los datos realistas encuentran más errores que el desarrollo.** Cargar el
ambiente de demostración con propiedades, contratos, liquidaciones y reclamos en
distintos estados descubrió pantallas que leían claves que la API nunca devolvía, y
formularios que ante un error mostraban un valor por omisión plausible —el
formulario de emisión, ante una falla al pedir el próximo número, mostraba el
número uno, y un usuario podía confirmar una emisión contra un número que el
organismo nunca asignó—. Un registro de prueba no muestra ninguna de las dos cosas.
De acá sale además una regla sobre valores por omisión: en un campo que va a un
tercero, el valor sensato por omisión es ninguno.

**Los defectos que quedaron para el final no se encontraron leyendo código.** Es la
lección que ordena todas las anteriores, y conviene enunciarla con el detalle de lo
que la respalda. Los cinco últimos defectos del proyecto aparecieron cada uno por
una vía distinta, y ninguno era alcanzable por inspección ni por la suite de
pruebas tal como estaba:

- **Ejercitar el proveedor real.** La respuesta del modelo llegaba cortada y su
  razonamiento consumía el presupuesto de la respuesta. Contra dobles de prueba la
  respuesta siempre entraba completa, así que el defecto no existía.
- **Mirar datos reales con desconfianza.** El resumen de un contrato informaba cero
  por ciento de puntualidad sobre seis cobranzas pagadas en fecha. La causa no
  estaba en los datos sino en el sistema: la liquidación se saldaba con la fecha en
  que se registraba el pago y no con la fecha del pago, así que le atribuía al
  inquilino la demora administrativa de la inmobiliaria, y ese dato alimenta su
  puntaje.
- **Abrir las pantallas en un navegador.** El panel mostraba una tendencia de
  ocupación plana en cero durante diez meses. El indicador contaba el estado actual
  de cada operación proyectado hacia atrás: no describía el pasado, y su título
  prometía exactamente eso.
- **Medir en lugar de suponer.** La primera carga del panel tardaba once segundos
  porque esperaba al modelo en línea. Nadie lo había notado porque en desarrollo el
  caché estaba siempre caliente.

Hay un quinto caso que merece mención aparte porque va en el sentido contrario al
esperado: **una de las correcciones fue refutada por su propia prueba**. Al
reescribir el indicador de ocupación se hizo histórico el numerador y se dejó el
denominador anterior, y la prueba que se había escrito para verificar la corrección
falló en integración continua con el mes pasado en cero. La corrección estaba a
medias y el autor no lo había visto. Una prueba que solamente confirma lo que su
autor ya cree no agrega nada; esta sirvió porque podía fallar, y falló.

La conclusión práctica, para este trabajo y para cualquier otro parecido: **un
número que se muestra con confianza merece la misma desconfianza que un número que
se sospecha**. Los tres defectos más serios de esta etapa —la puntualidad, la fecha
de saldado y la tendencia de ocupación— eran cifras que el sistema mostraba sin
titubear y que no medían lo que su rótulo decía medir.

---

## 7. Limitaciones conocidas y trabajo futuro

Están declaradas en los ADR y en las revisiones de los cambios que las
introdujeron. Son las que hay que nombrar antes de que las pregunten.

**El caché de métricas no se invalida por evento.** Las agregaciones del panel
—tendencia de ocupación, rentabilidad, flujo de caja, morosidad, resumen fiscal—
se guardan en memoria por inmobiliaria con vencimiento por tiempo de quince
minutos. Registrar un pago o cerrar una liquidación no descarta lo cacheado, así
que el panel puede mostrar un número viejo hasta un cuarto de hora. El diseño
para arreglarlo está escrito al lado del código: emitir eventos de dominio en las
operaciones que mueven las métricas y descartar el caché de esa inmobiliaria al
recibirlos. Es trabajo acotado y no se hizo por prioridad.

**Ese caché es de proceso.** Con más de una instancia de la API, cada una tiene su
propia copia, así que dos peticiones consecutivas pueden ver números distintos
dentro de la misma ventana. Para escalar horizontalmente hay que moverlo a un
almacén compartido.

**La lista de modelos alcanzados por el filtro de inmobiliaria está escrita a
mano.** Son cincuenta y tres nombres en la extensión del cliente de base de
datos. Un modelo nuevo con columna de inmobiliaria que no se agregue a esa lista
quedaría sin filtrar, porque la extensión lo deja pasar por no reconocerlo. El
riesgo está acotado por una prueba que compara la lista contra el esquema y falla
si alguno queda afuera —se escribió después de encontrar, justamente, un modelo
afuera—, pero la duplicación sigue ahí: la fuente de verdad debería ser el esquema.
Es la deuda que el ADR-0006 declara.

Que la deuda era real y no teórica quedó demostrado al comparar la lista contra el
esquema durante esta última etapa. La comparación dio dos discrepancias. Por un
lado, la lista nombraba tres modelos de inventario de propiedad que el esquema no
tiene: entradas sin efecto, que la extensión nunca iba a usar. Por el otro, y esto
es lo que importaba, había un modelo con columna de inmobiliaria que **no** estaba
en la lista: el registro de exportaciones del libro de IVA ventas. No hubo fuga por
ese lado, y la razón era accidental y no de diseño: su único acceso en todo el
sistema es una escritura de la tarea programada de facturación, que va por el
cliente sin extensión y con la inmobiliaria puesta a mano, es decir, exactamente el
camino que el ADR-0006 declara legítimo. Pero nada había impedido que el modelo se
agregara sin sumarlo a la lista, y el día que alguien lo leyera desde un servicio
con sesión, la lectura habría salido sin filtro.

Las dos discrepancias se corrigieron, y para que la clase de error no se repita se
agregó una prueba que compara la lista contra el esquema: exige que todo modelo con
columna de inmobiliaria esté alcanzado y que ningún nombre de la lista corresponda a
un modelo inexistente. Se verificó que la prueba efectivamente falla al quitar un
modelo de la lista, para que no sea una prueba que acompaña sin comprobar. Con eso,
un modelo nuevo que quede afuera rompe la suite en lugar de pasar inadvertido.

Queda pendiente la mejora estructural, que es la que sacaría la lista del medio:
derivarla del propio esquema —de modo que un modelo con columna de inmobiliaria
quede alcanzado por construcción y la única lista a mano sea la de las excepciones—
o mover el filtro al motor con seguridad a nivel de fila. La prueba acota el riesgo;
no elimina la duplicación.

**La tendencia de ocupación vale lo que valga la historia de contratos cargada.**
El sistema no versiona el estado de ocupación de una propiedad, así que la serie
mensual se deriva de los contratos vigentes en cada mes. Es una reconstrucción
honesta y explicable, pero una propiedad que estuvo ocupada sin contrato registrado
no aparece, y los meses anteriores a la carga de la cartera quedan en cero. La
salida de fondo es registrar los cambios de estado con su fecha.

**La atribución de reclamos a un contrato es por propiedad y sin ventana de
vigencia.** El reclamo se registra contra la propiedad, y cuando hay que atribuirlo
a un contrato —en las métricas del resumen de cierre, por ejemplo— la atribución se
hace por la propiedad y no por la fecha. Con dos contratos sucesivos sobre el mismo
inmueble, un reclamo del inquilino anterior puede contarse en el resumen del
siguiente. Se arregla acotando la atribución a la ventana de vigencia del contrato.

**Los avisos de reclamos no se persisten.** El servicio de notificación de tickets
deja una línea en el registro del servidor y no crea un aviso ni envía un correo.
El sistema de avisos existe y funciona para vencimientos, deudas y cambios de
estado; los del circuito de reclamos quedaron sin conectar. Es el hueco más
visible para un usuario, porque un reclamo abierto desde el portal no le avisa a
nadie.

**No hay pruebas de navegador ni de carga**, con las consecuencias que la sección
4 detalla.

**La cobertura es de 42,44 % de líneas y 32,28 % de ramas**, y el objetivo es
subirla empezando por los servicios centrales que hoy no tienen prueba unitaria
propia. El piso de integración continua debería subir detrás de la cobertura real
y nunca antes.

**La emisión pide la autorización antes de guardar el comprobante.** El
comprobante se registra en la base después de que ARCA otorgó el número de
autorización. Si esa escritura falla, el comprobante queda válido ante el
organismo y sin registro en el sistema. El caso más probable de esa falla —dos
emisores de la misma inmobiliaria con el mismo punto de venta, tipo y número—
quedó corregido al cierre (ver abajo), pero la ventana sigue existiendo para
cualquier otra falla de escritura. Se cierra registrando el comprobante como
pendiente antes de pedir la autorización y completándolo al recibirla.

**Dos limitaciones se corrigieron en la última revisión del informe.** Al
verificar cada afirmación del informe contra el código aparecieron dos defectos
que figuraban como limitaciones y se corrigieron antes de la entrega. El primero:
el secreto de firma de los tokens tenía un valor de reserva escrito en el código,
que es público, y una instalación sin la variable arrancaba firmando sesiones con
él; ahora, en producción, la falta de la variable impide el arranque. El segundo:
la restricción de unicidad de la numeración de comprobantes no incluía al emisor,
así que con varios emisores en una misma inmobiliaria el segundo comprobante con
el mismo punto de venta, tipo y número era rechazado por la base con el número de
autorización ya otorgado; ahora la numeración es única por emisor. La prueba de
integración que reproduce ese caso falla con la restricción anterior.

**La convención de códigos de error no está centralizada.** El filtro global valida
la forma del código, no el vocabulario, así que un código mal escrito pasa igual
(ADR-0005).

**Un olvido en el sentido contrario rompe una tarea programada.** Usar el cliente
con extensión desde una tarea programada ahora falla en lugar de correr sin
filtro. Es el intercambio buscado, pero significa que las tareas programadas hay
que probarlas, y hoy no están cubiertas.

Más allá de esa lista, el trabajo futuro con más sentido es en tres direcciones:
mover el aislamiento al motor de base de datos, que convierte una garantía de
aplicación en una del almacenamiento; cerrar el circuito de cobro —hoy se registra
el pago pero no se captura el dinero, que era una exclusión explícita del
alcance—; y completar la automatización de la verificación con recorridos de
interfaz y medición de capacidad sobre las dos operaciones más caras, la
generación del mes y los reportes.

---

## 8. Conclusiones

El trabajo entregó una plataforma de gestión inmobiliaria multi-inmobiliaria que
cubre el ciclo completo, desde la consulta de un interesado en el micrositio
público hasta la rendición al propietario, con la especificidad del contexto
argentino resuelta y no simulada: el ajuste por índices con su tabla histórica, la
emisión de comprobantes electrónicos con certificados por inmobiliaria y varios
emisores, y el circuito de morosidad con punitorios configurables. Los objetivos
generales se cumplieron y el alcance funcional comprometido está presente.

La contribución técnica que el equipo considera más sólida no es un módulo sino
una decisión: haber revisado el aislamiento entre inmobiliarias con criterio de
seguridad antes de la etapa de pruebas, haber encontrado que fallaba abierto, y
haberlo invertido documentando el razonamiento, las alternativas descartadas y las
consecuencias negativas de la elección. Encontró dos fugas reales en código ya
revisado y convirtió una clase entera de defecto silencioso en un error ruidoso.

La segunda es el tratamiento de las dos funciones con modelo de lenguaje. En un
dominio financiero, la parte difícil no es obtener texto del modelo: es poder
sostener el resultado. La respuesta fue quitarle al modelo la posibilidad de
calcular, mandarle datos sin información personal, validar lo que vuelve contra
las cifras conocidas y tener siempre un camino determinista al que caer. Es una
respuesta reproducible en otros dominios y no una particularidad de este.

Lo que el trabajo no logró está declarado y no es menor: no hay pruebas de
navegador ni medición de capacidad, la cobertura unitaria está en el orden del
cuarenta por ciento y hay que subirla, quedan las limitaciones de la sección 7, y
la documentación de planificación describió durante meses un sistema que no era el
que se estaba construyendo. Ese último punto es el que más se llevaría a un
proyecto siguiente: la documentación no es una etapa, es una parte de cada cambio,
y el costo de tratarla como etapa se paga entero al final.

El estado del sistema al cierre es demostrable de punta a punta sobre un ambiente
desplegado, con la salvedad declarada sobre las dos funciones con modelo de
lenguaje, y con la integración continua verificando en cada cambio el estilo, la
compilación de los tres paquetes, setecientas cuarenta y nueve pruebas unitarias
con su piso de cobertura, la aplicación de las veintiuna migraciones sobre una
base vacía y cuatrocientas ochenta y cinco pruebas de integración contra una base
real. El recorrido de la demostración está en `docs/demo.md` y el material de
preparación de la defensa, en `29-preparacion-defensa.md`.

---

## 9. Validación en uso real: el piloto

Esta sección es la segunda parte de la entrega final. Describe la puesta de Realfy
en manos de una inmobiliaria real que administra alquileres: por qué se hizo, qué
se construyó para que fuera posible, cómo se verifica y qué falta. Su estado es el
del 4 de noviembre de 2026. Lo que depende de los ciclos mensuales de la
inmobiliaria —la línea base y los ciclos C1 a C3— queda marcado como «a completar»
con la fecha del ciclo que lo produce, y se incorpora al anexo de validación en
campo sin reescribir lo entregado.

El capítulo completo del piloto está en `30-piloto.md`; el registro de hallazgos,
en `31-registro-de-feedback.md`; el procedimiento de migración, en
`32-migracion.md`; la trazabilidad de hallazgo a prueba, en
`33-matriz-de-trazabilidad.md`; el plan de aceptación en campo, en
`../calidad/12-piloto.md`, y el tratamiento de datos personales, en
`../privacidad-datos.md`. Esta sección no repite esos documentos: resume lo que
un lector del informe necesita para evaluar el trabajo.

### 9.1. Contexto

La inmobiliaria piloto es una empresa familiar de administración de alquileres.
Su nombre, su ubicación, su personal, sus clientes y sus importes no figuran en
este informe ni en ningún documento del repositorio, que es público. La operan
tres personas con funciones distintas —dirección, atención y publicación, y
muestras e inventarios— y lleva el ciclo mensual completo con una base de datos de
escritorio y planillas: ajustes, impuestos y servicios, recibos, cobros, rendición
a cada locador y un estado de cuenta por locador que se arma a mano.

La validación en uso real corrige la limitación más evidente de la primera versión:
hasta el 30/10/2026 el sistema se había probado con datos sintéticos y en un
ambiente de demostración, sin usuarios que dependieran de él. La sección 5 de este
informe declaraba los desvíos respecto de la planificación; el piloto es la primera
ocasión de contrastar el sistema con una operación que no se diseñó para él.

### 9.2. Objetivo y alcance

Se agregó un objetivo específico, identificado como OE-9 en el informe de la tesis:
validar el sistema en uso real con una inmobiliaria piloto, reproducir su ciclo
mensual completo con las reglas pactadas en cada contrato, reconciliar los
resultados contra su sistema actual hasta que no queden diferencias sin explicar y
registrar cada fricción del uso hasta una corrección verificada.

Las metas se fijaron antes de medir (`30-piloto.md`, «Objetivos y métricas»):
cero diferencias sin explicar en la reconciliación por contrato y por locador,
reducción del 50 % del tiempo del ciclo mensual respecto de la línea base, una
valoración de uso de 8 o más sobre 10 y un atraso del estado de cuenta al locador
de 5 días o menos. Los valores de partida se toman en la línea base y quedan a
completar tras el ciclo C1 (≈ 20/11/2026).

El relevamiento movió cuatro fronteras del alcance sin levantar las exclusiones
originales. La contabilidad completa sigue fuera, pero entran una caja operativa y
una cuenta corriente por locador. La captura del cobro por pasarela o recaudadora
sigue fuera, pero se registra el cobro por los tres caminos por los que llega el
dinero, incluido el efectivo en la oficina. La integración con portales sigue fuera
salvo que el portal ofrezca una interfaz, pero entra la publicación asistida. La
escrituración sigue fuera, pero entran la reserva, la seña, el boleto y los
honorarios de venta. El detalle está en `30-piloto.md`, «Relación con las
exclusiones del alcance original».

### 9.3. Método

El piloto siguió cuatro pasos, en este orden.

**Relevamiento.** Se leyeron los archivos que la inmobiliaria entregó de su
operación —la base de escritorio, las planillas de ajustes y de estados de cuenta,
los recibos y los modelos de contrato—, verificando que ninguno quedara sin
revisar, y la dirección respondió un cuestionario escrito el 30/10/2026. De ahí
salieron veintiocho hallazgos, FB-01 a FB-28, cada uno con su decisión, el ítem que
lo resuelve y los casos de prueba que lo verifican. Los tres que más pesaron en el
diseño son que el locador no es necesariamente el propietario y un contrato puede
tener varios, cada uno con su porcentaje de cobro; que casi todas las reglas son
pactables por contrato y cambian por acuerdos fechados, y que el dinero llega por
tres caminos distintos. Según el registro, al 3/11/2026 veintiséis hallazgos están
implementados por pedidos integrados —cada uno con su número en el estado—, uno sigue
planificado (FB-16, los pagarés como documento adjunto del contrato) y uno quedó
fuera de alcance (FB-27, el inventario estructurado). Todos provienen del
relevamiento: el registro todavía no tiene hallazgos de uso real, y no se presentan
como tales.

**Plan.** El trabajo se organizó en diecisiete ítems nuevos del cronograma, del 30
al 46, cada uno con su issue (#88 a #104), criterios de aceptación, la etiqueta
`piloto`, la etiqueta de origen (`origen:relevamiento` u `origen:uso-real`), un
integrante responsable y los casos de prueba asignados antes de implementar. Los
ítems se agruparon en seis oleadas ordenadas por el camino crítico hacia el primer
ciclo. Tres principios atraviesan todos los cambios: toda regla se resuelve en el
orden valor de la inmobiliaria, reglas del contrato vigentes a la fecha y acuerdos
fechados, sin pisar historia; el dinero se calcula con motores puros y exactos en
el paquete compartido y cada movimiento deja asiento, y cada dato tiene una sola
fuente de verdad, de modo que el cambio que mueve un dato cambia todos sus lectores.

**Oleadas.** Cada pedido de incorporación cumplió la misma definición de hecho:
issue enlazado con su origen; pruebas unitarias de la lógica y de integración por
ruta con casos de permisos y de aislamiento; prueba de regresión en rojo antes de
corregir un defecto; migración probada sobre una base vacía y sobre datos
sintéticos con la forma real; textos en los dos idiomas; documentación en el mismo
pedido, e integración continua en verde con la revisión de otro integrante.

**Ciclos.** El calendario no lo fija el equipo sino el ciclo de la inmobiliaria,
que prepara la liquidación alrededor del día 20 del mes anterior.

| Ciclo | Fecha de liquidación | Modo | Estado al 4/11/2026 |
|---|---|---|---|
| Línea base | ≈ 20/11/2026 | La inmobiliaria opera con su sistema actual y se mide por tarea | A completar tras el ciclo C1 (≈ 20/11/2026) |
| C1 | ≈ 20/11/2026 | En sombra: el equipo replica el ciclo en el ambiente `piloto` y reconcilia los recibos | A completar (≈ 20/11/2026); dos ensayos generales previos sobre una copia, en 9.6 |
| C2 | ≈ 20/12/2026 | En paralelo: la inmobiliaria mira y compara; se suman los estados de cuenta | A completar (≈ 20/12/2026) |
| C3 | ≈ 20/01/2027 | La inmobiliaria opera en Realfy con su sistema actual de respaldo | A completar (≈ 20/01/2027) |
| C4 | ≈ 20/02/2027 | Realfy es el sistema principal | Posterior a la entrega; se informa si cae antes de la defensa |

### 9.4. Lo entregado por oleada

Entre el 30/10 y el 3/11/2026 se integraron cincuenta pedidos de incorporación
(#105 a #183), todos con la revisión de otro integrante y con la rama principal
protegida. Con ellos quedaron entregadas las seis oleadas de desarrollo. Hasta el
4/11/2026 la rama principal suma 67 pedidos del piloto (#105 a #237): los diecisiete
posteriores son la oleada 6, de migración y boletas, y documentación. La tabla los
agrupa por oleada.

| Oleada | Contenido | Ítems | Pedidos | Estado |
|---|---|---|---|---|
| 0. Arranque | Base de proceso (protección de la rama principal, plantillas, pruebas de la web, control de tipos de las pruebas, controles de código muerto y duplicación, ensayo de migraciones sobre datos), índice de precios desde el archivo del INDEC con el BCRA de respaldo, activación del contrato, correcciones de fechas, dinero y deuda, fundación de la web, copias de la base, limpieza de código muerto y duplicado | 30, 31 | #105, #106, #108 a #110, #112 a #117, #125, #133 a #135, #137, #138, #143, #145, #148, #149, #154 | Integrada |
| 1. Acceso y partes | Usuarios con invitación y recupero de contraseña, política de lectura por rol, datos de persona y cuentas bancarias, locadores con porcentaje de cobro, apoderados y titularidad | 32, 33 | #136, #139 a #142 | Integrada |
| 2. Reglas y liquidación | Reglas versionadas, acuerdos y valores por defecto; motor de ajuste con rezago; generador de liquidaciones; boletas y reglas de traslado; centro de carga; punitorios dentro de la liquidación | 34, 35 | #150, #151, #153, #156, #158, #159 | Integrada |
| 3. Dinero y datos reales | Importación idempotente, panel de calidad de datos, caja con tres flujos de cobro, custodia y compensaciones, cuenta corriente y estado de cuenta del locador, suite de reconciliación | 36, 37, 39, 45 | #155, #160, #161, #165, #177 | Integrada |
| 4. Ciclo de vida del contrato | Vencimientos con semáforo y seguimientos, prórroga de palabra y renovación como período, incidencias con preautorización y presupuesto, honorarios, depósitos y liquidación de egreso, facturación por cuenta del locador | 38, 40, 41, 42 | #166 a #170 | Integrada |
| 5. Mensajería y comercial | Bandeja de salida con correo y WhatsApp, modos de envío y consentimiento; publicación asistida y micrositio con dominio propio; ventas y llaves; cobranza escalonada; bandeja de consultas unificada con responsable, plazo de primera respuesta y autorrespuesta | 43, 44 | #172, #178, #180, #181, #183 | Integrada |
| 6. Migración completa y boletas automáticas | Servicios y reglas de traslado por el importador (M8), proveedor y cuenta normalizada, formulario web de servicios, obtención automática de boletas con catálogo de proveedores, lectura de PDF, ingreso por archivo y por mail y pantalla de revisión, consumo por unidad; correcciones que salieron de los ensayos generales (DEF-115 a DEF-143, DEF-170 y DEF-171) | Complementa 35 y 39 | #187, #193, #198, #220 a #225, #227, #229, #231, #236, #237 | Integrada; tres pedidos abiertos al 4/11 (plantillas, recepción de mails y prórroga sin historial); el saldo inicial de custodia (#197) se integró ese día |
| Documentación | Capítulo del piloto, registro de hallazgos, migración, trazabilidad, privacidad, diagramas, plan de aceptación en campo | 46 | #107, #162, #186 | Continua |

Las decisiones de arquitectura nuevas son doce, del ADR-0007 al ADR-0018
(`../adr/README.md`): locadores, apoderados y titularidad (0007); impuestos y
servicios trasladables (0008); cuenta corriente y estado de cuenta del locador, que
deja la rendición por contrato como histórico (0009); reglas versionadas y valores
por defecto (0010); ajuste con rezago, estimación y corrección (0011); flujos de
cobro, caja y custodia (0012); mensajería saliente con bandeja de salida y cobranza
escalonada (0013); ambiente piloto con datos reales (0014); importación idempotente
(0015); diagramas como código (0016); facturación por cuenta del locador con
emisor delegado (0017), y obtención automática de boletas de servicios e impuestos
(0018).

**Obtención automática de boletas (oleada 6).** Cada mes alguien de la inmobiliaria
entra a los sitios de la Municipalidad, de Rentas, de Aguas Cordobesas, de EPEC y de
Ecogas, baja la boleta de cada propiedad y la carga a mano. Es el trabajo repetitivo
que más pesa en el ciclo, y de él depende el importe de impuestos y servicios del
recibo. La investigación previa mostró que ningún proveedor ofrece una interfaz
pública de consulta por cliente, que algunos sitios no se pueden inspeccionar desde
fuera del país y que el sitio de Rentas excluye expresamente la consulta
automatizada. Un diseño que apostara a un solo canal se rompería con el primer
cambio de un portal, de modo que la decisión (ADR-0018) es que **toda boleta, venga
de donde venga, pasa por el mismo circuito y termina en la misma entidad**, la que ya
alimenta el traslado al inquilino, y que los canales y los proveedores son piezas
intercambiables:

- **Proveedores.** Un catálogo en código con un archivo por proveedor: su
  identificador de cuenta con su normalización, las firmas que reconocen un documento
  suyo y su lector. Hay lectores para los proveedores de Córdoba que la inmobiliaria
  usa: la Municipalidad (cedulón actual y anterior), Rentas (cedulón actual y anterior)
  y Aguas Cordobesas (factura y resumen de cuenta), validados con muestras reales solo
  en la máquina del desarrollo; los de electricidad (EPEC) y gas (Ecogas) leen por las
  etiquetas del formato público, con la confianza topada, y no dan de alta solos hasta
  ajustarlos con una boleta real. Un lector genérico de respaldo cubre el resto.
- **Circuito único.** Idempotente por el hash del contenido: valida el importe, que el
  período esté a no más de tres meses de hoy y que el vencimiento sea coherente;
  busca el servicio por proveedor y cuenta normalizada, y da de alta la boleta con la
  misma función que la carga manual, todo en una transacción. Lo dudoso queda en
  **revisión**, con el motivo y el servicio sugerido; una boleta que ya existe con otro
  importe nunca se pisa. El proveedor y la cuenta se guardan normalizados en el
  servicio y se normalizan también al buscar, para que una cuenta escrita con guiones
  o con ceros de menos encuentre su servicio.
- **Canales.** El **archivo** (PDF subido a la pantalla *Boletas recibidas*, con la
  cola de revisión que muestra el PDF junto a lo leído, aceptar con correcciones o
  rechazar con motivo), el **mail** (el reenvío de la factura digital que mandan los
  proveedores, incluidos los remitentes automáticos) y la **consulta** (la interfaz de
  un conector y un proceso diario, apagado de fábrica y sin conectores). Un canal de
  portal con las credenciales de la inmobiliaria figura solo como dirección futura.
- **Recepción de mails y envío.** El dominio de la aplicación (`realfy.app`) está en
  Cloudflare, de modo que los mails entrantes se reciben con Email Routing y un Worker
  que los lee, decide por destinatario —boletas o consultas, con la inmobiliaria
  indicada en la dirección de destino— y los reenvía firmados a los endpoints de la
  API que ya existían. Es un componente propio, con su prueba, en el pedido #234,
  abierto al 4/11. El envío usa Resend, con el dominio verificado y los registros de
  autenticación del remitente en el DNS; la mensajería sigue en modo apagado.
- **Decisiones pendientes.** Quedan tres que no son del equipo: autorizar un conector
  de consulta de la Municipalidad, que es el único con consulta pública sin sesión
  (a tasa baja, desactivable e idealmente con un convenio); cómo obtener las boletas de
  Rentas, entre un convenio con el organismo o el mail y el PDF, porque automatizar su
  portal no es una opción; y la adhesión de la inmobiliaria a la factura digital por
  mail de cada proveedor. Además hacen falta boletas reales de electricidad y de gas
  para ajustar sus lectores, y el reconocimiento de caracteres de los PDF escaneados,
  que no se hizo.

El primer ensayo general del ciclo (9.6) confirmó el peso de este circuito: la falta
de las boletas de impuestos y servicios explicó casi todas las diferencias de un mes
entero.

Tres rasgos de lo entregado conviene destacarlos porque responden a lo que el
relevamiento mostró y no a una preferencia de diseño:

- **Nada se fija en el código.** Prorrateo, vencimiento, punitorio, reparto de
  impuestos, anticipo, flujo de cobro, honorarios y depósitos tienen un valor por
  defecto de la inmobiliaria que cada contrato puede pisar. Las preguntas que la
  inmobiliaria todavía no respondió no bloquean el desarrollo: quedan como
  opciones con un valor de fábrica documentado.
- **El dinero de terceros no se mezcla.** El cobro registra quién recibió el dinero
  y lo reparte en el momento entre la inmobiliaria, los entes y cada locador por
  mayor resto; el efectivo de un locador queda en su custodia, que por defecto no
  suma al total de la inmobiliaria.
- **Lo que sale hacia afuera es reversible y apagable.** La mensajería pasa por una
  bandeja de salida idempotente con tres modos de envío (apagado, lista de prueba y
  activo), el consentimiento por canal se registra y la cobranza escalonada viene
  apagada de fábrica: prepara la carta documento pero no la envía, y la derivación
  al abogado la decide una persona.

### 9.5. Evidencia de calidad

Las pruebas crecieron con el piloto en los tres niveles —unitarias de la API y del
paquete compartido, pruebas de la aplicación web, que antes no existían, e
integración de la API contra PostgreSQL— y la cobertura de líneas de la API pasó
del 44,48 % al 80,97 % (sección 9.10). El piso de la integración continua se
mantuvo en 38 % a propósito: es una alarma contra regresiones, no una meta.

La integración continua sumó controles que la primera versión no tenía: control de
tipos que incluye las pruebas; zona horaria fija, con una corrida adicional en la
zona de Buenos Aires para los módulos de fechas; paridad de claves de los dos
idiomas y de los enumerados entre la base y el paquete compartido; código muerto
(knip) y duplicación por paquete (jscpd) con umbral bloqueante; un ensayo que
aplica las migraciones nuevas sobre una semilla de datos sintéticos con la forma
real y verifica su transformación, y la cobertura de la suite de integración sumada
al análisis estático. Son nueve trabajos, ocho de ellos obligatorios para integrar
a la rama principal, que está protegida desde el 30/10/2026.

**Defectos.** El registro de la rama principal tiene cincuenta y cuatro defectos del
piloto (DEF-09 a DEF-171; la numeración reserva rangos por área y por eso no es
correlativa), además de los ocho anteriores (DEF-01 a DEF-08). Todos se cerraron con
el mismo circuito: prueba de regresión que falla contra el código anterior,
corrección en un pedido revisado y la misma prueba en verde
(`../calidad/06-registro-de-defectos.md`). Los veinticinco que se sumaron entre el
3/11 y el 4/11 salen casi todos de los ensayos generales del ciclo (9.6).

| Severidad | Defectos del piloto en la rama principal |
|---|---|
| Bloqueante | 1 |
| Alta | 25 |
| Media | 21 |
| Baja | 7 |
| Total | 54 |

| Origen (uno por defecto, el principal) | Defectos | Identificadores |
|---|---|---|
| Revisión de código, incluida la del módulo vecino al construir uno nuevo y la de la integración de dos ramas | 18 | DEF-09 a 11, 15 a 18, 20 a 24, 29, 30, 80, 95, 170 y 171 |
| Pruebas de caracterización de los motores antes de modificarlos | 3 | DEF-12 a 14 |
| Análisis de duplicación | 3 | DEF-19, 25 y 26 |
| Diseño o extracción de un motor compartido | 2 | DEF-27 y 28 |
| Integración con un proveedor externo | 1 | DEF-65 |
| Reconciliación del ciclo mensual con casos sintéticos | 4 | DEF-70 a 73 |
| Verificación de punta a punta del reparto por consumo | 3 | DEF-105 a 107 |
| Primer ensayo general del ciclo sobre una copia de la cartera (D1 a D11) | 20 | DEF-115, 120, 121, 125 a 137 y 140 a 143 |
| Uso real | 0 | — |

Los dos de DEF-170 y DEF-171 se encontraron al preparar la recepción de mails
(proveedores que mandan la factura desde direcciones automáticas) y se cuentan como
revisión. El segundo ensayo general sumó dos defectos más, E1 y E2 (DEF-173 a
DEF-176), en un pedido abierto al 4/11 que todavía no está en el registro de la rama
principal; con ese pedido el origen «ensayo general» pasa de 20 a 24.

Ningún defecto se detectó todavía por uso real, porque ninguna persona de la
inmobiliaria operó el sistema; la severidad «bloquea el cierre del mes», prevista
para lo que encuentre la reconciliación en campo, no se usó. Los ensayos generales
trabajaron con una copia restaurada de la base real, pero los corrió el equipo con
procesos programados apagados: es una repetición del ciclo, no uso, y por eso no se
cuenta como tal. Aun así su producto fue el mayor de la serie: veinte defectos en un
solo día, uno de ellos bloqueante, y ninguno lo había visto la suite sintética. Los
dos orígenes más productivos fueron el ensayo con datos de forma real y la revisión
de código previa a cada cambio, y las pruebas que fijan el comportamiento antes de
tocarlo (caracterización y reconciliación) encontraron lo que las pruebas de cada
módulo no veían: en todos los casos el defecto aparece al mirar el sistema desde un
lugar distinto del que lo construyó.

### 9.6. Reconciliación

El criterio de aceptación del piloto no es que cada función ande, sino que el mes
cierre: que Realfy produzca, para el mes que se liquida, los mismos importes que la
inmobiliaria obtiene con su sistema actual, por contrato (total del recibo, comisión
y neto al locador) y por locador (total del estado de cuenta). Como los datos reales
no pueden estar en el repositorio y la prueba tiene que poder repetirse sin ellos,
la reconciliación tiene dos niveles.

**Reconciliación sintética.** Un caso de caracterización reproduce un mes con la
forma de la cartera real y sin ningún dato de ella: once contratos y nueve
locadores, con ajustes de distintas modalidades y un alquiler en dólares; locadores
cuyo porcentaje de cobro difiere de su titularidad; boletas de los tres pagadores,
un impuesto anual en cuotas y un servicio repartido por consumo; cargos con y sin
anticipo; un punitorio; un cobro parcial, un cobro directo al locador, efectivo en
custodia y una compensación. Los resultados esperados se calcularon a mano, con
aritmética decimal exacta, antes de ejecutar. El caso corre en la integración
continua en dos niveles —encadenando los motores en el paquete compartido y cargando
el mismo mes por la API— con un comparador de tolerancia cero (CP-660 a CP-668).

La suite encontró cuatro defectos que las pruebas de cada módulo no habían visto,
porque aparecen sólo al encadenar el ciclo: un descuento que sumaba en el reparto
del cobro (DEF-70), una compensación sin importe que dejaba corto al locador
compensado (DEF-71), una compensación que se asentaba el día de la carga y no el del
cobro (DEF-72) y el primer mes de un contrato iniciado a mitad de mes, cuyo cobro no
se repartía entre sus locadores (DEF-73). Los cuatro se corrigieron antes de la
fecha del primer ciclo.

**Reconciliación en campo.** La versión con datos reales vive fuera del
repositorio. Antes de generar nada se guardan, con su huella, los totales del sistema
actual para el mes; se generan las liquidaciones en el ambiente piloto, se restaura
una copia de la base en un entorno de sólo lectura y un comparador con la misma
regla produce un informe de diferencias por contrato y por concepto. Cada diferencia
se clasifica —error de Realfy, regla que el sistema actual aplica sin explicitar,
dato importado incorrecto o error del sistema actual— y se registra como defecto o
como hallazgo dentro de las 24 horas. Tres reglas pueden diferir de lo que hace la
inmobiliaria y se verifican en el C1: el primer ajuste con rezago de un contrato
trimestral, el rezago de los contratos por ICL y la boleta del locador pagada por la
inmobiliaria con traslado parcial al inquilino.

**Ensayos generales del primer ciclo.** El C1 no admite repetirse, y el 20/11 el
sistema tiene que producir la liquidación de diciembre sobre una cartera cargada con
datos del sistema anterior. Por eso, antes de generar nada en el ambiente piloto, se
ensayó dos veces el ciclo sobre una copia restaurada de la base de piloto, el 3 y el
4/11/2026, con el procedimiento y la herramienta del C1 (`../calidad/12-piloto.md`,
sección 10): API local con los procesos programados y la mensajería apagados, la
planilla de octubre como resultado esperado, con su huella, tolerancia cero, y
diciembre simulado con los supuestos declarados (el IPC de octubre, que el INDEC
publica alrededor del 12/11, se supuso igual al de septiembre, y las boletas de
diciembre, iguales a la ficha de cada servicio). Los resultados son agregados; los
reportes por contrato, la planilla y las respuestas de la API quedan fuera del
repositorio.

- **Octubre.** Contratos comparados, coincidencias al centavo y sin contar impuestos y
  diferencias: **a completar tras el consentimiento de la inmobiliaria**. En cuanto al tipo de diferencia, el alquiler, la comisión, los
  cargos y los punitorios reproducen la planilla en todos los contratos comparados, y
  el desvío es la falta de las boletas de impuestos y servicios, que todavía no estaban
  cargadas (paso M9 de la migración). No hubo diferencias por regla distinta ni por
  error del sistema.
- **Diciembre, primer ensayo.** Con el sistema tal como estaba, ningún ajuste podía
  aplicarse (D1, bloqueante) y la coincidencia al centavo proyectada era muy baja. El
  ensayo encontró once problemas, D1 a D11, registrados como veinte defectos (DEF-115
  a DEF-143): los índices de sistema no se veían al aplicar un ajuste, las series de
  ICL y UVA se calculaban incompletas sin aviso, el importador desalineaba el
  cronograma de ajustes de los contratos cargados, la generación del mes no incluía el
  ajuste que rige desde el día 1, la prórroga de palabra rompía el lote o
  sobreajustaba, y cuatro silencios sin aviso (boleta en otra moneda, alquiler cero,
  consumo faltante y ajuste sin porcentaje). Se corrigieron en seis pedidos paralelos
  con su regresión en rojo, y se desplegaron juntos el 3/11 (con copia previa y ensayo
  de migraciones sobre una copia restaurada).
- **Segundo ensayo.** Sobre la copia posterior al despliegue: octubre sin
  regresiones y los ajustes se aplican solos como lo haría el proceso diario. El mes
  de ajuste de los contratos que la práctica de la inmobiliaria ajusta en noviembre o
  diciembre se reproduce en una parte sin hacer nada y en la gran mayoría con la
  prórroga de palabra registrada por API; en el primer ensayo no se reproducía
  ninguno sin hacer nada (cifras: a completar tras el consentimiento de la inmobiliaria). Aparecieron dos problemas nuevos, E1 y E2
  (cuatro defectos, DEF-173 a DEF-176): un doble ajuste en un contrato importado sin
  historial y un ajuste que baja el alquiler sin aviso.
- **Coincidencia estimada del C1 por escenario.** Se estimó para cuatro escenarios
  (sin hacer nada o con las prórrogas registradas, cada uno sin boletas y con las
  boletas de diciembre cargadas); los porcentajes y rangos son **a completar tras el consentimiento de la inmobiliaria**. No es un
  resultado del C1 sino una estimación sobre supuestos. Lo que más la mueve ya no es
  el sistema sino las boletas de impuestos y servicios, las prórrogas de los contratos
  con fin pactado vencido y la regla de redondeo del alquiler ajustado.

Antes del 4/11 se hicieron, además, tres cosas: se cargó el histórico del ICL y de la
UVA en la serie de sistema, se reenvió el lote de contratos con las correcciones de
los documentos de contrato (`32-migracion.md`) y se retuvieron algunos ajustes, unos de
un contrato cuyo historial no coincide con su tipo de índice y otros de un contrato
cuyo documento y cuyo lote difieren en la periodicidad, que el proceso de ajustes del
4/11 habría aplicado y que la práctica de la inmobiliaria no aplicó; quedan marcados
como salteados hasta confirmar con la dirección qué corresponde. Los ensayos dejaron
además reglas de dinero sin decidir (redondeo del alquiler ajustado, qué hacer con el
ajuste del mes si la liquidación ya se generó y con los ajustes salteados al
importar, rezago del primer ajuste y del ICL, impuestos en pesos en contratos en
dólares). Todas tienen un valor por defecto configurable y se deciden antes de
aprobar diciembre. La publicación de estas cifras agregadas está sujeta al
consentimiento de la inmobiliaria, que sigue pendiente (9.7).

**Resultado del ciclo C1.** A completar tras el ciclo C1 (≈ 20/11/2026): contratos
comparados, diferencias por categoría y diferencias abiertas, en forma agregada y
sujeto al consentimiento de la inmobiliaria para publicar cifras de su operación.

### 9.7. Gobernanza de datos

- **Ambiente separado.** El piloto corre en un ambiente `piloto` con su base y su
  almacenamiento propios, sin nada compartido con el de demostración (ADR-0014). La
  base con datos reales no se reinicia ni se recrea.
- **Dominio y ambientes.** Desde el 3/11/2026 el producto tiene dominio propio,
  `realfy.app`, con el DNS en Cloudflare y el registro del dominio en otro
  proveedor. El ambiente `piloto` es el producto: la aplicación sirve en
  `app.realfy.app` y su API en `api.realfy.app`; la demostración, con datos
  sintéticos, en `demo.realfy.app` y `api.demo.realfy.app`. Los sitios públicos de
  las inmobiliarias salen de un subdominio por cliente bajo `sitios.realfy.app`, en la
  web de `piloto`, y la raíz y `www` redirigen a la aplicación. Las direcciones
  anteriores siguen respondiendo mientras dura la transición. El dominio del remitente
  de los correos está verificado en Resend.
- **Nada real en el repositorio.** Ni datos, ni capturas, ni cifras derivadas de la
  cartera. Las pruebas, los ejemplos y la demostración usan datos inventados; las
  fuentes del relevamiento, la lista de revisión de la carga y la versión real de la
  reconciliación se guardan fuera del repositorio, con acceso restringido al equipo.
- **Carga repetible.** La cartera se cargó el 2/11/2026 con el importador
  idempotente, después de un ensayo sin escritura que dio el mismo resultado y sin
  filas con error. El 3/11 se sumaron los servicios y las reglas de traslado (M8) y las
  filas de corrección que salieron de comparar los contratos con sus documentos
  (cantidades: a completar tras el consentimiento de la inmobiliaria), y el
  reenvío de cada lote dio todo sin cambios. Las inconsistencias del origen que el
  importador no puede resolver solo quedaron en una lista de revisión para la
  dirección de la inmobiliaria y se corrigen reenviando el lote. El estado de cada
  paso de la migración está en `32-migracion.md`.
- **Copias y restauración.** Copias nativas diarias y semanales del proveedor y una
  copia lógica fuera de él, semanal y antes de cada despliegue. Entre el 31/10 y el
  3/11/2026 el ambiente recibió siete despliegues, cada uno precedido por su copia y,
  cuando traía migraciones, por su ensayo sobre una copia restaurada; el 3 y el 4/11
  hubo tres más (de 64 a 69 migraciones). La restauración se probó el 31/10/2026 sobre la base vacía y el 2/11/2026 con los
  datos reales cargados: restaurar la base tardó unos 3 segundos en local, que es el
  RTO de la base medido. El RTO total del servicio, con meta de 2 horas, no se midió
  de punta a punta (`../despliegue.md`).
- **Mensajería apagada.** El envío de mensajes está en modo apagado en el ambiente
  piloto hasta que la inmobiliaria apruebe los envíos a su cartera. El dominio de
  correo ya está verificado y el envío de prueba llegó; falta la cuenta de WhatsApp y
  la aprobación de la inmobiliaria. El modo de envío no se cambia sin la autorización
  del responsable del piloto.
- **Cifras en la tesis.** Los resultados se reportan agregados, con fecha de
  medición, y sólo con el consentimiento de la inmobiliaria, que está pendiente. Las
  cantidades de los ensayos generales de 9.6 son agregadas, sin nombres ni importes,
  y se retiran del repositorio si el consentimiento no llega.

### 9.8. Desvíos

Los desvíos del piloto se declaran con la misma regla que los de la sección 5. En
el informe de la tesis figuran como D-15 a D-18; el quinto de esta lista se
desprende de ellos, y los tres últimos (la migración, las boletas automáticas y los
límites de la reconciliación sintética) se agregaron el 4/11/2026 y todavía no
figuran allí.

**El Hito 4 se reabrió.** El cronograma fijaba el Hito 4 el 30/11/2026, pero su
documento lo daba por cerrado el 18/08/2026, cuando terminó la versión beta de este
informe. La contradicción existía antes del piloto y el piloto la volvió
insostenible. Se evaluó abrir un hito nuevo y se eligió reabrir el cuarto con la
fecha que el cronograma siempre tuvo, para que la entrega y la defensa cuenten una
sola historia: lo cerrado el 18/08 es su primera versión y la entrega del 30/11
incluye el piloto hasta el primer ciclo.

**El alcance se amplió con diecisiete ítems.** La ampliación no nace de una
reestimación del equipo sino del relevamiento de una operación real, y cada ítem
tiene su hallazgo de origen. Las exclusiones originales se mantienen; lo que cambió
es dónde pasa la frontera en cuatro de ellas (sección 9.2).

**El modelo cambió antes de cargar datos.** La distinción entre locador, titular y
apoderado, las reglas pactables por contrato y los tres caminos del dinero no
estaban en ningún documento de la planificación. Resolverlos antes de importar la
cartera evitó migrar datos reales sobre un modelo equivocado; el costo fue
reescribir la rendición, que pasó a histórico.

**La validación en campo no llega completa a la entrega.** La entrega del 30/11
incluye la línea base y el primer ciclo en sombra; los ciclos C2 y C3 se informan en
el anexo de validación hasta la defensa.

**El desarrollo se adelantó al calendario por ciclos.** El plan ubicaba las oleadas
4 y 5 entre diciembre de 2026 y febrero de 2027, antes de los ciclos que las
necesitaban; se integraron antes del primer ciclo. La consecuencia no es sólo
favorable: buena parte de lo entregado todavía no fue operado por nadie de la
inmobiliaria, y su validación depende de los ciclos C2 a C4. Es el mismo patrón que
la sección 5 señaló para la primera versión —construir rápido y verificar al
final—, mitigado esta vez por la reconciliación sintética y la definición de hecho
de cada pedido, pero no eliminado.

**La migración se creyó completa antes de estarlo.** El 2/11/2026 estaban cargados
los pasos M0 a M7 (personas, propiedades, contratos y sus ajustes) y se dio la
migración por hecha. El 3/11 se verificó que faltaban los servicios y reglas de
traslado, las boletas, los saldos iniciales, las plantillas y las ventas: justo lo
que define el importe de impuestos y servicios del recibo. Se corrigió el mismo día
(M8 cargado, M9 por el circuito automático, M10 a M12 con sus brechas), pero la
causa es la misma de otros desvíos: dar por cerrado un paso por lo que se construyó y
no por lo que se contrastó con la operación real.

**La obtención automática de boletas no estaba en el plan.** Se agregó el 3/11, por
decisión del equipo, después de comprobar que ningún proveedor ofrece
una interfaz de consulta y que cargar las boletas a mano no escala con los servicios
de la cartera. Es la ampliación de alcance más grande desde la apertura del piloto y
se declara como tal: es la oleada 6, que no tiene un ítem propio del cronograma sino
que se cuenta dentro de los ítems 35 y 39.

**La reconciliación sintética no alcanzó.** Los cuatro defectos que encontró estaban
en cómo se encadenan los motores; los veinte que encontró el primer ensayo general
estaban en cómo llegan los datos reales al motor (el cronograma de ajustes que deja
el importador, los índices de sistema, la prórroga de palabra). Ninguno apareció con
datos sintéticos, que se construyen con el cronograma ya bien armado. El ensayo con
una copia de la cartera pasa a ser un paso fijo antes de cada ciclo.

Dos desvíos de la primera versión se revirtieron en parte: la mensajería por
WhatsApp que el anteproyecto incluía existe ahora detrás de la bandeja de salida,
apagada en el piloto, y la derivación de la mora a un abogado, que no se había
implementado, queda preparada por la cobranza escalonada, que la sugiere sin
ejecutarla.

### 9.9. Lecciones

- **El relevamiento cambió el modelo antes de que lo cambiara el uso.** Ningún
  documento de la planificación distinguía al locador del propietario. Leer cómo
  trabaja una inmobiliaria real lo mostró antes de que un usuario tuviera que
  sufrirlo.
- **Una regla fija en el código es una deuda con fecha.** Cada regla «de la
  inmobiliaria» que mostró el relevamiento apareció pactada distinto en algún
  contrato. La respuesta fue siempre la misma —valor por defecto, regla del contrato
  y acuerdo fechado— y por eso las preguntas abiertas al contador y al abogado no
  frenaron el desarrollo.
- **El ciclo encadenado encuentra lo que el módulo no ve.** Los cuatro defectos de
  la reconciliación sintética estaban en módulos con buena cobertura y pruebas en
  verde. Aparecieron al pasar el resultado de un motor al siguiente, que es lo que
  hace la inmobiliaria cada mes.
- **La carga se pudo hacer antes de tener los datos perfectos porque es repetible.**
  Un importador idempotente permitió cargar la cartera y corregirla después, en
  lugar de esperar a que cada dato estuviera revisado.
- **Ensayar sobre una copia de los datos reales encuentra lo que lo sintético no.**
  El primer ensayo general encontró en un día veinte defectos, uno bloqueante, que la
  suite sintética no podía ver porque sus datos nacen bien formados. No tocó el
  ambiente real; sin él, el primer proceso diario de ajustes habría
  aplicado sobre datos reales ajustes con ventanas y fechas equivocadas.
- **Un arreglo parcial puede ser peor que ninguno.** Corregir solo el defecto que
  impedía aplicar los ajustes habría hecho que el proceso diario empezara a aplicar
  sobre cronogramas todavía incorrectos. Los arreglos de ajustes se desplegaron
  juntos y no por separado, y se retuvieron los ajustes que el segundo ensayo mostró
  incorrectos.
- **Las cifras repetidas en varios documentos se contradicen.** La primera versión
  citaba recuentos distintos de pruebas y migraciones en el hito, el informe y el
  manual de pruebas. Desde el piloto las cifras del sistema se consignan una sola
  vez, con su fecha y su fuente (sección 9.10), y los demás documentos remiten a esa
  tabla.
- **No se presenta el relevamiento como uso.** El registro separa los hallazgos del
  relevamiento de los del uso real. A la fecha todos son del relevamiento, y la
  validación de uso se informará como tal desde el C2.

### 9.10. Cifras del sistema

Tabla única de cifras. Medición del **4 de noviembre de 2026** sobre la rama principal
en el commit `c7b3eac` (pantalla de boletas recibidas, #229), con las seis oleadas de
desarrollo y la oleada 6 de migración y boletas entregadas. Se conserva la medición
anterior, del 3 de noviembre sobre `a2ea7d9`, para ver la evolución; la columna «Antes
del piloto» corresponde al commit `ac07cdf` del 28/10/2026. Los pedidos abiertos al
medir (#197, #199, #234 y #242) no están incluidos; el #197 se integró mientras se
medía.

| Dimensión | Antes del piloto | 3/11/2026 (`a2ea7d9`) | 4/11/2026 (`c7b3eac`) | Fuente |
|---|---|---|---|---|
| Módulos de la API | 31 | 44 | 45 | Carpetas de `apps/api/src/modules` |
| Entidades y enumeraciones del modelo | 55 y 39 | 101 y 112 | 103 y 118 | `model` y `enum` en `apps/api/prisma/schema.prisma` |
| Migraciones versionadas | 21 | 64 | 69 | Carpetas de `apps/api/prisma/migrations` |
| Controladores y rutas | 34 y 226 | 53 y 426 | 55 y 436 | Archivos con `@Controller` y decoradores `@Get`, `@Post`, `@Put`, `@Patch` y `@Delete` en `apps/api/src` |
| Registros de arquitectura | 6 | 17 | 18 | `docs/adr/` |
| Casos de uso | 24 (CU-01 a CU-24) | 49 (CU-01 a CU-49) | 50 (CU-01 a CU-50) | Identificadores en `02-roles-y-casos-uso.md` |
| Casos de prueba del catálogo | 48 | 530, del CP-01 al CP-816 | 710, del CP-01 al CP-1435, sin identificadores repetidos | Renglones de `../calidad/05-casos-de-prueba.md` |
| Defectos registrados | 8 (DEF-01 a DEF-08) | 37: los 8 anteriores y 29 del piloto (DEF-09 a DEF-95) | 62: los 8 anteriores y 54 del piloto (DEF-09 a DEF-171) | `../calidad/06-registro-de-defectos.md` |
| Pruebas unitarias de la API | 807 | 2.419 en 186 archivos | 2.721 en 203 archivos | Integración continua, trabajo «Unit Tests & Coverage» (ver la nota sobre la fuente) |
| Pruebas unitarias del paquete compartido | 48 | 1.040 en 45 archivos | 1.087 en 47 archivos | Ídem |
| Pruebas de la aplicación web | No había | 1.611 en 141 archivos | 1.688 en 148 archivos | Ídem (vitest) |
| Pruebas de integración de la API | 491 | 829 en 60 archivos | 916 en 65 archivos | Ídem, trabajo «API E2E Tests» |
| Cobertura de la API (líneas, sentencias, funciones, ramas) | 44,48 %, 44,36 %, 45,77 %, 34,50 % | 80,30 %, 80,35 %, 81,56 %, 71,79 % | 80,97 %, 81,03 %, 82,05 %, 73,07 % | Ídem; piso de la integración continua: 38 %, y 27 % de ramas |
| Cobertura de líneas de la web y del paquete compartido | — | 78,52 % y 73,37 % | 79,12 % y 74,08 % | Ídem |
| Duplicación por paquete (api, web, shared) | — | 1,01 %, 1,74 % y 0,54 % | 0,98 %, 1,69 % y 0,56 % | Ídem, trabajo de código muerto y duplicación (jscpd) |
| Cobertura combinada de unitarias e integración, y duplicación del repositorio | — | 82,9 % y 1,2 % | 83,4 % y 1,2 % | Último análisis de SonarCloud sobre `main`: `ba78a78` el 3/11 y `6b16803` el 4/11 (ver la nota sobre la fuente) |
| Pedidos de incorporación desde el inicio del piloto | — | 50 (#105 a #183), todos con revisión de otro integrante | 67 (#105 a #237), todos con revisión de otro integrante | Historial de la rama principal |

**Fuente de las pruebas y la cobertura.** La medición del 4/11 sale de la ejecución
41762887734 de la integración continua sobre `main` en `c7b3eac`, cancelada al final por el empuje de un pedido posterior (#197): los ocho trabajos que alcanzaron a correr terminaron en verde y solo SonarCloud no llegó a correr; la cobertura
combinada es la del análisis de SonarCloud de `6b16803`, el último de `main` (el de
`c7b3eac` no llegó a correr y el pedido #229 solo cambia la web), consultado a su API
pública el 4/11. La medición del 3/11 sale de la ejecución 41591721662 del pedido #183, sobre
`5c6ca93`, cuyo árbol es idéntico al de `a2ea7d9`: la ejecución sobre `main` en
`a2ea7d9` (41595020268) había fallado en una prueba de pantalla de la web
(`contract-parties.test.tsx`), que pasó en el pedido sobre el mismo árbol, y por esa
falla no corrieron la integración ni SonarCloud de ese commit. Dos pruebas
inestables de la web se identificaron como tales: la de ese commit y la del
formulario de valores por defecto, que falló dos veces el 3 y el 4/11 y se corrigió
en #237.

Tres aclaraciones sobre la tabla. La primera: el catálogo de casos de prueba llegó
a tener dos rangos asignados dos veces —CP-470 a CP-480, a la cuenta corriente y a
los vencimientos, y CP-720 a CP-725, a la publicación y a las ventas—. El pedido
#185 los renumeró (vencimientos a CP-806 a CP-816; ventas y llaves a CP-800 a
CP-805) y agregó una prueba de integridad de la documentación que falla si un
identificador se repite; desde entonces cada pedido toma un rango propio de
casos, defectos y casos de uso. La segunda: la versión del informe de la tesis fechada
el 3/11 usa la medición de esa fecha; la siguiente usa esta columna del 4/11, y se
remide en su pasada final. La tercera: la columna del 4/11 incluye la oleada 6
(obtención automática de boletas, migración de servicios y correcciones del ensayo
general) y no incluye lo que estaba en pedidos abiertos al medir: el saldo inicial de
custodia (#197, integrado después), las plantillas de contrato completas, la
recepción de mails y la prórroga de contratos importados sin historial.

Las cifras de la operación de la inmobiliaria —cartera, tiempos, diferencias de
reconciliación— no están en esta tabla y no se publican sin su consentimiento; las
cantidades agregadas de los ensayos generales están en 9.6, con la misma salvedad. Los
valores medidos de la línea base y de los ciclos quedan a completar tras el ciclo C1
(≈ 20/11/2026), el C2 (≈ 20/12/2026) y el C3 (≈ 20/01/2027).

### 9.11. Estado a la fecha y lo que falta

El objetivo general se cumplió en su parte de diseño e implementación, y su
validación en uso real está en curso. Al 4/11/2026 están integradas las seis
oleadas de desarrollo y la oleada 6 de migración y boletas; la cartera de la
inmobiliaria está cargada en el ambiente piloto con sus servicios y reglas de
traslado, y las correcciones de los documentos de contrato; la reconciliación
sintética corre en cada cambio sin diferencias; se hicieron dos ensayos generales del
primer ciclo y lo integrado hasta el 4/11 está desplegado en los dos ambientes, que
desde el 3/11 sirven en el dominio propio del producto. Quedan tres pedidos
abiertos (plantillas de contrato, recepción de mails y la corrección de la prórroga
sin historial), y el saldo inicial de custodia, integrado el 4/11, falta desplegarlo.

Falta lo que no depende del equipo sino del calendario de la inmobiliaria y de
terceros:

- **Línea base y C1** (≈ 20/11/2026): medir el ciclo actual por tarea y reconciliar
  los recibos del primer mes en sombra, con las boletas de diciembre cargadas, el
  índice de octubre en la serie y las reglas de dinero de los ensayos decididas.
  A completar.
- **Migración**: confirmar con la inmobiliaria los saldos iniciales propuestos, las
  respuestas sobre los contratos con ajuste retenido o con historial inválido y las
  plantillas y ventas (`32-migracion.md`).
- **C2 y C3** (≈ 20/12/2026 y ≈ 20/01/2027): estados de cuenta, primeros hallazgos
  de uso real y métricas antes y después. A completar en el anexo de validación.
- **Validaciones externas**: los parámetros fiscales y legales (facturación por
  cuenta del locador, punitorios, sellos, carta documento y señas) con el contador,
  el abogado y el colegio profesional; hasta entonces rigen como valores
  configurables con su valor por defecto.
- **Habilitaciones**: la cuenta de WhatsApp, el despliegue de la recepción de mails
  y la aprobación de la inmobiliaria para encender la mensajería y la cobranza
  escalonada; y las tres decisiones de boletas de 9.4 (conector de la Municipalidad,
  Rentas, adhesión a la factura digital).
- **Consentimiento** de la inmobiliaria para publicar cifras agregadas.

Las limitaciones propias del piloto a esta fecha son seis: la reconciliación con
datos reales todavía no se ejecutó; nadie de la inmobiliaria operó el sistema, así
que todos los hallazgos son del relevamiento; los parámetros fiscales y legales no
están confirmados; la mensajería está implementada pero apagada; el ingreso busca al
usuario sólo por su correo, que podría repetirse entre inmobiliarias, y el
consentimiento para publicar cifras está pendiente. En el informe de la tesis
figuran como L-13 a L-18.
