# Informe final

Este documento cierra el trabajo final de carrera. Reúne qué se propuso el
proyecto, qué quedó entregado, cómo está construido, cómo se verifica, en qué se
desvió de lo planificado, qué se aprendió en el camino y qué queda pendiente.

No repite los documentos que ya están en el repositorio: los referencia. La
planificación vive en `docs/tesis/01-` a `04-`; el estado del sistema en cada
etapa, en los tres documentos de hito; las decisiones técnicas, en los seis
registros de `docs/adr/`; y la documentación de uso y operación, en `docs/api.md`,
`docs/pruebas.md`, `docs/manual-de-usuario.md`, `docs/despliegue.md` y
`docs/demo.md`. Todas las cifras de este informe se midieron sobre el repositorio
al momento de escribirlo, y en cada caso se indica dónde se pueden volver a
medir.

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
y no hay operaciones de venta con escrituración.

En números, al cierre de este informe el sistema son treinta y un módulos en la
API sobre un modelo de cincuenta y cinco entidades y treinta y nueve
enumeraciones, con dieciocho migraciones versionadas; treinta y cuatro
controladores que declaran doscientas veintiséis rutas; y una aplicación web con
dieciocho secciones internas más el portal del inquilino y el micrositio público
de cada inmobiliaria. Son unos cuarenta y tres mil quinientos renglones de código
en la API, cuarenta y dos mil trescientos en la web y cuatro mil trescientos en
el paquete de tipos compartidos.

El historial acumula doscientos cincuenta y cinco commits de trabajo repartidos
entre los tres integrantes, incorporados a la rama principal a través de
cincuenta y una revisiones. El cronograma tuvo veintinueve ítems y cuatro hitos.

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
contexto, sus alternativas y sus consecuencias, en los seis registros de
`docs/adr/`. El monorepo con Turborepo sobre espacios de trabajo de pnpm es el
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
fiscales en el resumen del panel y la de valores de índice dentro del barrido de
ajustes—, ninguna de las dos había fallado nunca, y las dos habían pasado
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
memoria y no necesitan nada instalado: son sesenta y cuatro archivos —sesenta y
dos al lado del código y dos en el directorio de piezas transversales— con
seiscientas noventa y cuatro pruebas. Las **de integración** levantan la
aplicación completa, con sus guards, su filtro de errores, su extensión de
aislamiento y su cliente de base de datos, y le pegan por HTTP: son treinta
archivos con cuatrocientas sesenta y cinco pruebas, que corren contra una base
PostgreSQL creada desde cero y se limpian entre casos en orden de dependencia.

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

La cobertura de líneas de la API es de **42,07 %**, con 43,22 % de funciones y
31,69 % de ramas. El piso exigido en integración continua es más bajo a propósito
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
—treinta archivos, cuatrocientas sesenta y cinco pruebas— y llevarla a integración
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

### Las dos funciones con modelo de lenguaje operan en modo determinista

Los ítems 25 y 26 del cronograma están entregados: el panel de priorización
diaria y el resumen de gestión al cierre del contrato existen, con sus pantallas,
sus endpoints y sus pruebas. Lo que hay que declarar es cómo se van a comportar el
día de la defensa.

El ambiente de demostración no tiene credencial del proveedor del modelo
configurada. Sin credencial, el cliente del modelo queda deshabilitado y las dos
funciones caen a su camino determinista: la priorización la ordenan las reglas
propias y el resumen lo redactan las plantillas. El resultado es completo y
correcto —esa es toda la razón de tener respaldo determinista—, pero no es el
camino con modelo, y la respuesta lo declara: el campo que dice de dónde salió el
orden va a decir que lo resolvieron las reglas.

Se decidió mostrarlo así y decirlo, en lugar de configurar una credencial en un
repositorio y un ambiente públicos. Cambiar de proveedor o habilitarlo es
configuración y no código: el cliente habla el protocolo común de completado por
chat, así que alcanza con la raíz de la API, el identificador del modelo y la
credencial.

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
el Hito 3 se cerró el 17/08/2026 y este informe es del 18/08/2026. La construcción
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
mano.** Son cincuenta y cinco nombres en la extensión del cliente de base de
datos. Un modelo nuevo con columna de inmobiliaria que no se agregue a esa lista
queda sin filtrar y sin protección, porque la extensión lo deja pasar por no
reconocerlo. Es la principal deuda que deja el ADR-0006, y el punto a revisar en
cada migración que agregue una tabla.

Que la deuda es real y no teórica se puede comprobar comparando la lista contra el
esquema, y conviene declararlo antes de que lo encuentre el tribunal. La
comparación da dos discrepancias. Por un lado, la lista nombra tres modelos de
inventario de propiedad que el esquema no tiene: entradas que quedaron sin efecto y
que la extensión nunca va a usar. Por el otro, y esto es lo que importa, hay un
modelo con columna de inmobiliaria que **no** está en la lista: el registro de
exportaciones del libro de IVA ventas. Hoy no hay fuga por ese lado, y la razón es
accidental y no de diseño: su único acceso en todo el sistema es una escritura de
la tarea programada de facturación, que va por el cliente sin extensión y con la
inmobiliaria puesta a mano, es decir, exactamente el camino que el ADR-0006
declara legítimo. Pero nada impidió que el modelo se agregara sin sumarlo a la
lista, y el día que alguien lo lea desde un servicio con sesión, la lectura sale
sin filtro. Es la demostración más clara de por qué esta deuda es la primera de la
lista.

El camino de salida está identificado: derivar la lista del propio esquema en lugar
de mantenerla —de modo que un modelo con columna de inmobiliaria quede alcanzado
por construcción y la única lista a mano sea la de las excepciones—, o mover el
filtro al motor con seguridad a nivel de fila.

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

**La cobertura es de 42,07 % de líneas y 31,69 % de ramas**, y el objetivo es
subirla empezando por los servicios centrales que hoy no tienen prueba unitaria
propia. El piso de integración continua debería subir detrás de la cobertura real
y nunca antes.

**El secreto de firma de los tokens tiene valor por omisión en el código.** Si la
variable de ambiente no está definida, la aplicación arranca igual usando un valor
de reserva escrito en fuente, que es público. Un despliegue mal configurado queda
firmando sesiones con un secreto conocido y no lo anuncia. La corrección es que la
falta de ese valor impida el arranque, como pasa con las variables que la guía de
despliegue marca como obligatorias, y es de las cosas que hay que hacer antes de
cualquier uso real.

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
compilación de los tres paquetes, seiscientas noventa y cuatro pruebas unitarias
con su piso de cobertura, la aplicación de las dieciocho migraciones sobre una
base vacía y cuatrocientas sesenta y cinco pruebas de integración contra una base
real. El recorrido de la demostración está en `docs/demo.md` y el material de
preparación de la defensa, en `29-preparacion-defensa.md`.
