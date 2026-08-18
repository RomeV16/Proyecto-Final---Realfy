# Preparación de la defensa

Material de trabajo para la defensa. No es un guion de la exposición: el recorrido
del sistema está en `docs/demo.md` y no se repite acá. Lo que hay acá son las
preguntas que el tribunal va a hacer con su respuesta y su evidencia, los puntos
fuertes que conviene poner adelante, los flancos débiles con qué contestar en cada
uno, y el reparto de la exposición entre los tres integrantes.

Tres reglas de conducta para la defensa, acordadas de antemano:

1. **Lo que no está, se dice antes de que lo pregunten.** Todo lo que falta está
   declarado en la sección 5 y en la 7 del informe final. Adelantarlo cuesta menos
   que defenderlo cuando lo encuentran.
2. **Ninguna cifra se dice de memoria si no está medida.** Las que están en el
   informe se pueden volver a medir en el momento; las que no están en el informe
   no se dicen.
3. **Ante una pregunta cuya respuesta no se sabe, se dice que no se sabe** y se
   dice dónde se buscaría. Es más sólido que improvisar y quedar contradicho por el
   propio repositorio.

---

## 1. Preguntas del tribunal

Ordenadas de la más incómoda a la más general. Cada una con la respuesta corta,
lo que conviene agregar si insisten, y dónde está la evidencia.

### 1.1. ¿Por qué el aislamiento entre inmobiliarias fallaba abierto? ¿Cuánto tiempo estuvo así?

**Corto.** Porque la extensión que inyecta el filtro estaba escrita para el caso en
que hay inmobiliaria en el contexto, y para el caso en que no la hay no hacía
nada: dejaba pasar la consulta sin filtro. Estuvo así desde que se implementó el
aislamiento hasta la revisión de seguridad previa a la etapa de pruebas, que es
cuando se corrigió.

**Si insisten.** Lo que hay que sostener no es que no pasó, sino que se lo buscó y
se lo encontró antes de que hiciera daño, y que la corrección fue estructural y no
puntual. La revisión encontró dos consultas que ya estaban leyendo sin filtro: la
de los emisores fiscales en el resumen del panel y la de valores de índice dentro
del barrido de ajustes. Ninguna había fallado nunca —una leía por identificadores
que ya venían acotados aguas arriba, la otra corría en un ambiente con una sola
inmobiliaria— y las dos habían pasado revisión por pares. Ese es el punto: el
defecto no se ve en la línea de código que le falta el filtro, así que ninguna
cantidad de revisión lo garantiza. La corrección fue invertir el comportamiento por
omisión, no arreglar dos consultas.

**Evidencia.** `docs/adr/0006-aislamiento-entre-inmobiliarias-fallando-cerrado.md`
(contexto, los dos casos encontrados, las cuatro alternativas descartadas y las
consecuencias negativas asumidas);
`apps/api/src/common/tenant/prisma-tenant.extension.ts` (la extensión);
`apps/api/test/unit/prisma-tenant.extension.spec.ts` (verifica operación por
operación, y que sin contexto lance);
`apps/api/test/tenant-isolation.e2e-spec.ts` (dos inmobiliarias recorriendo
endpoints sensibles).

### 1.2. ¿Cómo saben que el modelo de lenguaje no inventa cifras?

**Corto.** Porque no se le pide ninguna. Las métricas las calcula el servidor de
forma determinista contra los registros del contrato; al modelo se le manda esa
grilla ya cerrada y se le pide únicamente prosa. La estructura de respuesta que se
espera no tiene ni un campo numérico, así que no hay lugar donde pueda devolver un
número. Y por si el texto libre trae uno, hay una verificación que recorre cada
número del resumen y lo compara contra las cifras de la grilla, con sus redondeos
razonables: si aparece una cifra ajena, el resumen se descarta y lo redactan las
plantillas deterministas.

**Si insisten** —por ejemplo, si preguntan qué pasa con un número escrito en
palabras, o con una fecha—. La verificación es sobre números escritos con dígitos.
Las fechas de vigencia se admiten porque sus dígitos ya están en la grilla. Un
número escrito en palabras no lo detecta, y eso hay que reconocerlo; lo que
compensa es que el modelo no tiene de dónde sacar un número que no esté en la
grilla, porque la grilla es literalmente todo lo que recibió. La verificación es la
segunda línea, no la primera.

**Evidencia.** `apps/api/src/modules/ai/contract-closure.ts` — la proyección a
hechos, `knownFigures` y `findUnknownFigure`;
`apps/api/src/modules/ai/contract-closure.service.ts` — el descarte y la caída a
plantilla; `apps/api/src/modules/ai/contract-closure.spec.ts` y
`contract-closure.service.spec.ts`; `docs/api.md`, sección de asistencia sobre el
modelo de lenguaje.

### 1.3. ¿Y los datos personales? ¿Qué se le manda al proveedor del modelo?

**Corto.** Nada que identifique a nadie. En la priorización, cada pendiente sale
como una referencia opaca más sus datos objetivos —monto, días de atraso, horas de
acuerdo de nivel de servicio vencidas, estado—. En el resumen de cierre sale una
grilla de métricas cuyos campos son todos números, fechas y tipos: no existe campo
para nombre, documento, correo, teléfono, domicilio, propiedad ni identificador
interno. Los datos locales se reponen del lado del sistema, después de que la
respuesta volvió.

**Si insisten.** La proyección se hace copiando campo por campo, no descartando los
que sobran. La diferencia importa: una métrica nueva queda afuera del pedido hasta
que alguien la agregue a propósito, en lugar de viajar por defecto. El
comportamiento por omisión es no compartir.

**Evidencia.** `apps/api/src/modules/ai/contract-closure.ts` (`ContractClosureFacts`
y `toClosureFacts`); `apps/api/src/modules/ai/daily-context.ts` (`toModelFacts`);
las pruebas de seudonimización en `contract-closure.spec.ts` y
`daily-context.service.spec.ts`.

### 1.4. ¿Qué pasa si se cae el proveedor del modelo?

**Corto.** El sistema entrega el mismo resultado por un camino determinista y lo
declara. La priorización la ordenan reglas propias y el resumen lo redactan
plantillas. El cliente del modelo nunca lanza: sin credencial, con la llamada
cortada por tiempo, con un error del proveedor o con una respuesta que no valida
contra el esquema, devuelve ausencia de respuesta y el servicio sigue por su
camino. La respuesta que llega a la pantalla trae un campo que dice si el orden lo
resolvió el modelo o las reglas.

**Aclaración obligada en la demostración.** El ambiente de demostración no tiene
credencial del proveedor configurada, así que las dos funciones van a correr por el
camino determinista. Hay que decirlo antes de mostrarlas, no después. La razón es
que el repositorio y el ambiente son públicos y no se pone una credencial en un
lugar público; cambiar de proveedor o habilitarlo es configuración —raíz de la API,
identificador del modelo y credencial— y no código.

**Evidencia.** `apps/api/src/modules/ai/language-model.client.ts` (el cliente que no
lanza, el corte por tiempo, la credencial resuelta en el primer uso);
`apps/api/src/modules/ai/priority-rules.ts` y
`apps/api/src/modules/ai/closure-summary-template.ts` (los dos respaldos);
`apps/api/src/modules/ai/ai-priorities.service.ts` (el campo que declara qué camino
corrió); sección 5 del informe final.

### 1.5. ¿Por qué la cobertura es la que es?

**Corto.** La cobertura de líneas de la API es 42,07 %, con 43,22 % de funciones y
31,69 % de ramas. No se presenta como logro: es el número real y el objetivo es
subirlo. El piso que exige la integración continua está a propósito unos puntos por
debajo —38 % de líneas, funciones y sentencias, 27 % de ramas— para que el control
se ponga en rojo cuando la cobertura baja y no cuando alguien no llega a una meta
aspiracional.

**Si insisten.** Dos cosas que hay que decir sin que las tengan que sacar. La
primera es que la distribución no es uniforme: hay servicios centrales con
cobertura unitaria baja o nula —el de reclamos, el de usuarios, el de servicios de
la propiedad— y controladores sin prueba unitaria propia. La segunda es que esos
mismos caminos sí están ejercitados por la suite de integración, que atraviesa la
aplicación completa por HTTP y no cuenta para la medición porque corre aparte:
cuatrocientas sesenta y cinco pruebas en treinta archivos. Compensar parcialmente
no es cubrir, y por eso subir la cobertura —empezando por ramas— es la primera
tarea de mantenimiento pendiente. Lo que no se puede hacer es subir el piso antes
que la cobertura real.

**Evidencia.** `apps/api/jest.config.ts` (el piso y la medición al fijarlo);
`docs/pruebas.md`, sección de cobertura; el reporte de cobertura que produce
`pnpm --filter @realfy/api test:coverage`, que la integración continua sube como
artefacto y conserva catorce días.

### 1.6. ¿Por qué no hay pruebas de navegador, si estaban en los objetivos?

**Corto.** Estaban comprometidas y no se entregaron. Es un desvío, está declarado
como tal, y no hay una excusa técnica: fue una decisión de asignación de esfuerzo
en la última etapa. Con el tiempo que quedaba, construir la suite de integración de
nivel HTTP sobre la API completa daba más señal por hora invertida que automatizar
tres o cuatro recorridos de pantalla.

**Si insisten** —y conviene que insistan, porque la respuesta honesta es la mejor
parte—. La decisión tuvo un costo concreto y se lo puede nombrar: la transición de
estado de la rendición nunca funcionó desde la interfaz porque la pantalla enviaba
un nombre de campo distinto al que esperaba el servidor. Las pruebas del servicio
pasaban, porque no atraviesan la pantalla; las de integración también, porque le
pegan a la API con el nombre correcto. Un recorrido de navegador lo habría
encontrado el primer día. Es exactamente la clase de defecto que quedó descubierta,
hoy la única red que lo atrapa es la prueba manual, y con lo que se sabe ahora la
mejor decisión habría sido recortar una de las dos funciones con modelo de lenguaje
—el plan de sprints lo contemplaba explícitamente— y entregar los recorridos.

**Evidencia.** `01-alcance-y-objetivos.md` (el objetivo específico);
`04-backlog.md`, ítem 27; `04-plan-sprints.md` (la previsión de recortar los ítems
25 y 26); `docs/pruebas.md` (que lo dice sin eufemismo: las pruebas que llama de
integración son de nivel HTTP, no recorridos de interfaz); secciones 4 y 5 del
informe final.

### 1.7. ¿Cómo se protegen las claves privadas de los certificados fiscales?

**Corto.** Con cifrado en sobre. Cada certificado se cifra con una clave de datos
propia, generada al azar en el momento; esa clave de datos se envuelve con una
clave maestra que vive en la configuración del ambiente y nunca en la base. En la
base quedan sólo dos cosas: el certificado cifrado y la clave de datos envuelta.
La clave de datos no sale nunca del servicio que la usa.

**Si insisten.** Tres detalles que conviene tener a mano. Uno: el esquema admite
rotar la clave maestra reenvolviendo las claves de datos, sin volver a cifrar los
certificados. Dos: la clave maestra se valida en el primer uso y no en el arranque,
para que una inmobiliaria que no factura electrónicamente no dependa de una
configuración que no le corresponde —y por lo tanto una instancia sin esa clave
levanta igual—. Tres: si la clave maestra es incorrecta, el desenvolvimiento falla
y la operación falla; no hay camino que devuelva la clave privada sin la clave
maestra correcta.

**Lo que hay que reconocer.** La clave maestra es una variable de ambiente. La
protección es tan buena como la protección del ambiente de despliegue; no hay
módulo de seguridad de hardware ni servicio de gestión de claves detrás. Para el
alcance de este trabajo es una decisión razonable y está declarada; para una
operación real con volumen, el paso siguiente es un servicio de gestión de claves.

**Evidencia.** `apps/api/src/common/crypto/crypto.service.ts` (el esquema, la
jerarquía de claves y la rotación); `apps/api/src/common/crypto/crypto.service.spec.ts`
y `crypto.service.extra.spec.ts`; `apps/api/src/modules/invoices/certificate.service.ts`;
`docs/despliegue.md`, tabla de variables. **En la defensa no se muestra ninguna
clave ni ningún valor de configuración.**

### 1.8. ¿Qué pasa si dos inmobiliarias administran la misma propiedad?

**Corto.** Cada una tiene su propia fila. No hay una entidad de propiedad
compartida: la propiedad pertenece a exactamente una inmobiliaria, igual que todo
el resto del dominio, y la misma dirección cargada por dos inmobiliarias son dos
registros independientes con sus propios contratos, liquidaciones y reclamos.
Ninguna de las dos ve la fila de la otra.

**Si insisten.** Hay que decir las tres consecuencias, porque son reales. Primero,
el dato queda duplicado y no hay nada que lo detecte: no existe restricción de
unicidad por dirección, y no podría existir sin cruzar el límite entre
inmobiliarias. Segundo, el micrositio público de cada una publica su propia versión
del aviso, así que la misma propiedad puede aparecer dos veces en internet con
datos distintos. Tercero, la operación compartida entre inmobiliarias —el
corretaje conjunto, con reparto de comisión— no está modelada y no se puede
representar hoy.

**El argumento de fondo.** No es un descuido: es la consecuencia directa y aceptada
del aislamiento por fila. El invariante que sostiene toda la seguridad del sistema
es que cada fila del dominio pertenece a una sola inmobiliaria; una entidad visible
por varias rompe ese invariante en el lugar exacto donde no conviene romperlo. La
forma correcta de resolverlo, si el negocio lo pide, es un modelo explícito de
operación compartida —una entidad propia que vincule dos inmobiliarias con su
reparto pactado— y no relajar el filtro. Queda como trabajo futuro, y es preferible
a haberlo resuelto haciendo una excepción en el aislamiento.

**Evidencia.** `apps/api/prisma/schema.prisma`, modelo `Property` (columna de
inmobiliaria, índices por inmobiliaria, sin unicidad por dirección);
`docs/adr/0003-multi-tenant-row-level.md`; `03-modelo-datos.md`. Lo mismo aplica a
`Person`, que es única por inmobiliaria e identificación fiscal: la misma persona
en dos inmobiliarias son dos registros.

### 1.9. ¿Qué impide que un cliente pida datos de otra inmobiliaria cambiando un identificador?

**Corto.** El identificador de inmobiliaria no se acepta del cliente. Sale siempre
del token verificado, lo escriben las estrategias de autenticación después de
verificar la firma, y viaja por el contexto de la petición hasta la capa de
persistencia, donde la extensión del cliente de base de datos lo inyecta en el
filtro de cada lectura, de cada mutación y en los datos de cada creación. Pedir el
registro de otra inmobiliaria por su identificador devuelve no encontrado, porque
la consulta lleva además el filtro de la inmobiliaria propia.

**Demostrable en vivo.** El paso 14 del recorrido de `docs/demo.md` entra con el
administrador de una segunda inmobiliaria y muestra las mismas pantallas con datos
completamente distintos.

**Evidencia.** `apps/api/src/common/auth/jwt.strategy.ts` y `portal-jwt.strategy.ts`;
`apps/api/src/common/tenant/`; `apps/api/test/tenant-isolation.e2e-spec.ts`;
`docs/api.md`, convenciones generales.

### 1.10. ¿Y si mañana agregan una tabla y se olvidan de sumarla al filtro?

**Corto.** Queda sin filtrar, y es la principal deuda que el propio ADR-0006
declara: la lista de modelos alcanzados por la extensión está escrita a mano.

**No esquivarlo: mostrarlo.** Comparando la lista contra el esquema hoy aparecen dos
discrepancias, y conviene decirlas antes de que las busquen. La lista nombra tres
modelos de inventario de propiedad que el esquema no tiene, entradas sin efecto. Y
hay un modelo con columna de inmobiliaria que no está en la lista: el registro de
exportaciones del libro de IVA ventas. Hoy no hay fuga por ese lado, y la razón es
accidental: su único acceso en todo el sistema es una escritura de la tarea
programada de facturación, que va por el cliente sin extensión y con la
inmobiliaria puesta a mano, o sea el camino que el ADR declara legítimo. Pero nada
impidió que se agregara sin sumarlo, y el día que alguien lo lea desde un servicio
con sesión, la lectura sale sin filtro.

**Con qué cerrar.** Que la deuda esté declarada en el ADR y que se la pueda exhibir
con el caso concreto es mejor que no tenerla: significa que se sabe dónde mirar. La
salida está identificada y es de dos formas —derivar la lista del esquema, de modo
que un modelo con columna de inmobiliaria quede alcanzado por construcción y la
única lista a mano sea la de excepciones, o mover el filtro al motor con seguridad
a nivel de fila—. La segunda ya está evaluada y descartada para este alcance por
razones escritas, no por comodidad.

**Evidencia.** ADR-0006, sección de consecuencias negativas;
`apps/api/src/common/tenant/prisma-tenant.extension.ts` frente a
`apps/api/prisma/schema.prisma`; sección 7 del informe final.

### 1.11. ¿Por qué aislamiento por fila y no una base o un esquema por inmobiliaria?

**Corto.** Porque el costo operativo de las otras dos no se justifica en este
alcance, y las razones están escritas de antemano y no a posteriori. Un esquema por
inmobiliaria obliga a aplicar cada migración a tantos destinos como clientes y
encarece el monitoreo; una base por inmobiliaria multiplica la infraestructura por
cliente y deja sin solución simple la sincronización del esquema. El aislamiento
por fila da una sola base, un solo juego de migraciones y alta instantánea de una
inmobiliaria nueva.

**Lo que hay que conceder.** Es el esquema que más depende de la aplicación, y por
eso el riesgo estaba anotado en el ADR-0003 desde antes de escribir el primer
módulo, y por eso se lo revisó específicamente antes de la etapa de pruebas. El
resultado de esa revisión es el ADR-0006.

**Evidencia.** `docs/adr/0003-multi-tenant-row-level.md` (las tres alternativas, la
elección y los riesgos con sus mitigaciones), fechado antes del primer módulo de
dominio.

### 1.12. ¿Cómo probaron la facturación electrónica sin operar contra el organismo?

**Corto.** Hay dos caminos y están separados. El módulo habla con el servicio real
del organismo —autenticación con el certificado, solicitud del comprobante,
número de autorización— y para las pruebas automatizadas hay un simulador incluido
en el repositorio que responde en su lugar, activado por configuración. Ninguna
prueba automatizada consulta al organismo: sería dependencia externa dentro de la
integración continua.

**Si insisten.** Si la demostración corre contra el simulador, se dice
explícitamente; está previsto así en el guion. Y si el organismo no responde
durante una emisión en vivo, la contingencia también está prevista: se muestra un
comprobante ya emitido con su número de autorización y su PDF, y se explica el
circuito sobre eso.

**Evidencia.** `docs/pruebas.md` (el simulador y su variable);
`apps/api/src/modules/invoices/arca/`; `docs/demo.md`, paso 9 y contingencias.

### 1.13. La anulación de un comprobante, ¿borra algo?

**Corto.** No. La anulación es fiscal: se emite una nota de crédito contra el
comprobante original, que sigue existiendo con su número y su autorización. Es la
única forma en que puede ser, porque un comprobante autorizado por el organismo no
se puede hacer desaparecer.

**Evidencia.** `docs/api.md`, sección de facturación electrónica; `docs/demo.md`,
paso 9; `03-modelo-datos.md`.

### 1.14. ¿Por qué los índices se consumen como variación y no como nivel?

**Corto.** Porque es como se publican y como se pactan los ajustes: el contrato se
actualiza por la variación del período, no por el cociente entre dos niveles
absolutos que el sistema podría no tener completos. Confundir las dos cosas produce
factores de ajuste sin sentido, y es la decisión de dominio más delicada del
módulo.

**Lo que hay que agregar, porque es la lección.** Es un error que ninguna prueba
unitaria detecta si la prueba asume el mismo malentendido que el código. Ahí no
ayuda la cobertura: ayuda entender el dominio antes de escribir el cálculo.

**Evidencia.** `apps/api/src/modules/index-data/`;
`apps/api/test/e2e/index-data.e2e-spec.ts`; `03-modelo-datos.md`; lecciones del
Hito 2.

### 1.15. ¿Por qué las modalidades de ajuste no son las que dice el documento de alcance?

**Corto.** Porque el documento de alcance decía IPC, UVA y valor manual, y lo
entregado son IPC, ICL, CCP, porcentaje fijo y personalizado, con la tabla
histórica de índices admitiendo IPC, ICL, CVS, CER y UVA. El cambio es de dominio:
el índice que la normativa vigente usa para los alquileres es el ICL, y la
modalidad que la planificación llamaba UVA quedó cubierta por el porcentaje fijo y
el personalizado. La documentación de planificación se corrigió contra el sistema
en la última etapa.

**Lo que hay que reconocer.** Que se corrigió al final es en sí un desvío, y está
declarado: durante meses hubo documentos de planificación que describían un sistema
distinto del que se estaba construyendo. La lección operativa que queda es que el
cambio de dominio y la actualización del documento que lo describe pertenecen al
mismo cambio.

**Evidencia.** `01-alcance-y-objetivos.md` frente al enumerado de modalidades en
`apps/api/prisma/schema.prisma`; `03-modelo-datos.md`; sección 5 del informe final.

### 1.16. ¿Por qué la rendición al propietario no estaba en el backlog?

**Corto.** Porque el backlog priorizado enumera los ítems 05 a 29 del cronograma y
ninguno era la rendición, aunque el caso de uso estaba declarado desde la
planificación —es el CU-13—. El backlog tenía un agujero: enumeraba los módulos por
donde entra el dinero y no el que lo reparte.

**Cómo se detectó.** Al cerrar el Hito 2, cuyo criterio de aceptación obligaba a
recorrer el circuito completo. El sistema sabía cuánto había cobrado de cada
contrato pero no cuánto le correspondía a cada propietario después de la comisión y
las deducciones, así que ese número se seguía calculando por fuera. Está anotado
como próximo paso en el documento del Hito 2, en esos términos, y se construyó en
el Hito 3.

**Evidencia.** `04-backlog.md`; `02-roles-y-casos-uso.md`, CU-13; `hito-02.md`,
próximos pasos; `hito-03.md`, alcance entregado; sección 5 del informe final.

### 1.17. ¿El panel puede mostrar un número desactualizado?

**Corto.** Sí, hasta quince minutos. Las agregaciones del panel se guardan en
memoria por inmobiliaria con vencimiento por tiempo, y registrar un pago o cerrar
una liquidación no descarta lo cacheado. Es una limitación conocida y declarada.

**Si insisten.** El arreglo está diseñado y escrito al lado del código: emitir
eventos de dominio en las operaciones que mueven las métricas y descartar el caché
de esa inmobiliaria al recibirlos. Es trabajo acotado y no se hizo por prioridad.
Hay además una segunda limitación del mismo caché: es de proceso, así que con más
de una instancia de la API cada una tiene su copia y dos peticiones consecutivas
pueden ver números distintos dentro de la ventana. Escalar horizontalmente exige
moverlo a un almacén compartido.

**Evidencia.** `apps/api/src/modules/dashboard/dashboard-cache.service.ts`;
sección 7 del informe final.

### 1.18. ¿Cómo se garantiza que un inquilino del portal no vea el contrato de otro?

**Corto.** Con dos filtros que se aplican juntos. El token del portal es de un
ámbito distinto del token del personal —uno no sirve en el lugar del otro, y eso
está probado— y trae la inmobiliaria y la persona. Las consultas del portal van por
el cliente con la extensión, así que llevan el filtro de inmobiliaria inyectado, y
además filtran explícitamente por la persona autenticada a través de su vínculo con
el contrato. Sin persona en el contexto, la consulta se rechaza.

**Evidencia.** `apps/api/src/modules/portal/portal.service.ts`;
`apps/api/src/common/auth/portal-jwt.strategy.ts`;
`apps/api/test/e2e/portal.e2e-spec.ts` y `portal-auth.e2e-spec.ts` (que incluye el
rechazo de tokens del ámbito equivocado y la rotación del token de refresco).

### 1.19. Un error del servidor, ¿puede filtrar información interna?

**Corto.** No hay camino que evite el filtro global de excepciones, y sobre un error
no previsto responde siempre el mismo texto genérico, sin código de origen, sin
detalle y sin traza. Lo que queda en el registro del servidor es la línea completa,
con el método, la ruta, el estado, el identificador de traza, la inmobiliaria y el
usuario, más el stack. El cliente recibe el identificador de traza, que es lo que
convierte el reporte de un usuario en algo accionable.

**Si insisten.** Antes del filtro, una violación de unicidad llegaba al cliente como
error 500 con el mensaje interno del motor, que incluye el nombre de la restricción
y la tabla. Hoy llega como 409, que además es lo que corresponde semánticamente.

**Demostrable en vivo.** Paso 16 del recorrido: forzar un error de validación y
mostrar el cuerpo con su código y su identificador de traza.

**Evidencia.** `docs/adr/0005-manejo-uniforme-de-errores.md`;
`apps/api/src/common/filters/all-exceptions.filter.ts` y su prueba unitaria, que
recorre cada rama.

### 1.20. ¿Qué pasa si se despliega sin configurar las variables obligatorias?

**Corto.** Depende de la variable, y hay una que hoy no se comporta como debería. Si
falta la conexión a la base de datos, la API no arranca. Si falta la clave maestra
de los certificados, el sistema levanta igual y el error aparece recién en la
operación que necesita cifrar o descifrar, que es deliberado. Pero si falta el
secreto de firma de los tokens, la aplicación arranca usando un valor de reserva
escrito en el código fuente, que es público: un despliegue mal configurado queda
firmando sesiones con un secreto conocido y no lo anuncia.

**Con qué cerrar.** Está declarado como limitación y la corrección es que la falta
de ese valor impida el arranque, igual que la conexión a la base. Es de las cosas
que hay que hacer antes de cualquier uso real, y no se hizo.

**Evidencia.** `docs/despliegue.md`, tabla de variables y su columna de
consecuencia; sección 7 del informe final.

### 1.21. ¿Las tareas programadas están probadas?

**Corto.** No como tareas. Corren por fuera del ciclo de una petición, así que
ninguna de las dos suites las ejercita como tales; su lógica está probada a través
de los servicios que invocan. Es un hueco reconocido, y tiene antecedente: faltaba
registrar el planificador en la aplicación y durante un tiempo no corrieron ni los
avisos, ni el cálculo de punitorios, ni la obtención de índices, sin que nada lo
indicara.

**Lo que agrega el endurecimiento del aislamiento.** Ahora una tarea programada que
use el cliente equivocado falla en lugar de correr sin filtro. Es el intercambio
buscado, pero significa que hay más razones para probarlas, no menos.

**Evidencia.** `docs/pruebas.md`; ADR-0006, consecuencias negativas; lecciones del
Hito 2; sección 4 del informe final.

### 1.22. ¿Los reclamos del portal notifican a alguien?

**Corto.** No. El servicio de notificación de reclamos deja una línea en el registro
del servidor y no crea un aviso ni envía un correo. El sistema de avisos existe y
funciona para vencimientos, deudas y cambios de estado; el circuito de reclamos
quedó sin conectar. Es el hueco más visible para un usuario real y está declarado.

**Evidencia.** `apps/api/src/modules/tickets/ticket-notification.service.ts`;
sección 7 del informe final.

### 1.23. ¿Cuál es el aporte del trabajo, más allá de ser un sistema que funciona?

**Corto.** Dos cosas, y conviene tenerlas ensayadas porque es la pregunta que
decide la nota.

La primera es metodológica: un mecanismo de seguridad que depende de que nadie se
olvide no es una garantía, es una convención, y la diferencia se puede medir. Se
revisó el aislamiento con criterio de seguridad antes de la etapa de pruebas, se
encontró que fallaba abierto, se encontraron dos casos reales en código ya
revisado, y se lo invirtió documentando el razonamiento, las alternativas
descartadas y las consecuencias negativas de la elección. El resultado es que una
clase entera de defecto silencioso pasó a ser un error ruidoso, y que la superficie
a auditar quedó reducida a un conjunto enumerable.

La segunda es sobre integrar un componente no determinista en un dominio
financiero: la parte difícil no es obtener texto del modelo, es poder sostener el
resultado. La respuesta fue quitarle al modelo la posibilidad de calcular, mandarle
datos sin información personal, validar lo que vuelve contra las cifras conocidas y
tener siempre un camino determinista al que caer. Es reproducible en otros dominios
y no una particularidad de este.

**Evidencia.** ADR-0006 y el módulo de asistencia sobre el modelo de lenguaje;
sección 8 del informe final.

---

## 2. Puntos fuertes

Los que conviene poner adelante, con lo que los respalda.

1. **El circuito completo cierra.** De la consulta en el micrositio público a la
   rendición al propietario, sin intervención manual sobre la base. Es demostrable
   de punta a punta y cada paso tiene prueba de integración.
2. **La especificidad regulatoria está resuelta y no simulada.** Ajuste por índices
   con tabla histórica, facturación electrónica con certificados por inmobiliaria,
   varios emisores y numeración por punto de venta, libro de IVA ventas, notas de
   crédito, punitorios configurables por inmobiliaria. Es lo que un producto
   genérico no trae.
3. **El aislamiento entre inmobiliarias se revisó como problema de seguridad y no
   como funcionalidad.** Encontró dos fugas reales en código ya revisado, y la
   corrección fue estructural. Está documentada con alternativas y consecuencias.
4. **Las decisiones están registradas.** Seis registros de decisión con contexto,
   alternativas descartadas y consecuencias negativas asumidas. El ADR-0003 está
   fechado antes del primer módulo de dominio; el ADR-0006 documenta la corrección
   de un riesgo que ese mismo ADR había anotado.
5. **La verificación está automatizada y corre sola.** Cinco trabajos en cada
   cambio: estilo, compilación de los tres paquetes, seiscientas noventa y cuatro
   pruebas unitarias con piso de cobertura, aplicación de las dieciocho migraciones
   sobre una base vacía, y cuatrocientas sesenta y cinco pruebas de integración
   contra una base real.
6. **El trabajo con el modelo de lenguaje está acotado por diseño.** Sin datos
   personales, sin cálculo, con la salida validada y con respaldo determinista que
   se declara en la respuesta.
7. **El error tiene una sola forma.** Un filtro global que ningún camino evita, con
   código de dominio, identificador de traza y la garantía de que un error
   inesperado no devuelve nada interno.
8. **La documentación de operación existe y es usable.** Referencia de API, manual
   de pruebas, manual de usuario por rol, guía de despliegue y guion de la
   demostración.

---

## 3. Flancos débiles reconocidos

Cada uno con lo que hay que contestar. La regla es adelantarlos.

| Flanco | Con qué contestar |
|---|---|
| No hay pruebas de navegador, y estaban comprometidas | Es un desvío declarado, no una omisión que se descubre ahora. Se explica la decisión de asignación de esfuerzo, se nombra el defecto concreto que costó, y se dice cuál habría sido la mejor decisión con lo que se sabe hoy (1.6). |
| Cobertura de 42 % de líneas y 32 % de ramas | El número real, presentado como objetivo y no como logro, con el piso de integración continua explicado como piso y no como meta, y con la suite de integración como compensación parcial reconocida como parcial (1.5). |
| No hay medición de capacidad | El ítem 27 la contemplaba y no se hizo. Los puntos caros están identificados —generación del mes y reportes— y sobre lo segundo hay caché, pero sin medición no se afirma nada sobre capacidad. Este informe no hace ninguna afirmación de rendimiento, a propósito. |
| La lista de modelos filtrados se mantiene a mano, y hay un modelo afuera | Se muestra el caso concreto antes de que lo busquen, se explica por qué hoy no hay fuga y por qué eso es accidental, y se da la salida de diseño (1.10). |
| El secreto de firma tiene valor de reserva en el código | Declarado como limitación, con la corrección identificada y la admisión de que hay que hacerla antes de cualquier uso real (1.20). |
| Las dos funciones con modelo de lenguaje van a correr en modo determinista en la demostración | Se dice antes de mostrarlas, con la razón —repositorio y ambiente públicos— y con la aclaración de que habilitarlo es configuración y no código (1.4). |
| El panel puede mostrar números de hasta quince minutos | Limitación declarada, con el arreglo diseñado y la segunda limitación —caché de proceso— dicha también (1.17). |
| Los avisos de reclamos no se persisten | Declarado. Es el hueco más visible para un usuario real y no se justifica: quedó sin conectar (1.22). |
| La documentación de planificación estuvo desalineada del sistema durante meses | Se declara como desvío, se enumera qué estaba mal, y se dice la lección: la documentación no es una etapa, es parte de cada cambio (1.15). |
| El aislamiento depende de la aplicación y no del motor | La alternativa está evaluada y descartada por razones escritas, no por comodidad, y queda como el camino natural si el proyecto crece (1.11). |
| No se puede representar una propiedad administrada por dos inmobiliarias | Es la consecuencia aceptada del invariante que sostiene toda la seguridad del sistema, con la forma correcta de resolverlo identificada y sin relajar el filtro (1.8). |
| Las tareas programadas no están probadas como tales | Hueco reconocido, con antecedente concreto y con la razón por la que ahora importa más (1.21). |

---

## 4. Reparto de la exposición

El criterio es que cada uno defienda lo que construyó, porque es lo que puede
sostener cuando la pregunta baja al detalle. El reparto sale del historial del
repositorio, que se puede verificar con `git shortlog -sn --no-merges` y con
`git log --no-merges -- <ruta>` sobre cada módulo. Al cierre de la documentación
el reparto de commits es de noventa y siete de Romeo Valdomero, ochenta y cuatro de
Manuel Ferreras y setenta y cuatro de marianonallar, aunque lo que importa para el
reparto de la exposición no es el total de cada uno sino qué partes del sistema
tocó.

### Manuel Ferreras — el circuito del dinero y la infraestructura de verificación

**Qué construyó.** El núcleo contractual y financiero de la API: contratos y sus
plantillas, liquidaciones, punitorios, la rendición al propietario, la facturación
electrónica —emisión contra el organismo con numeración por punto de venta,
comprobantes, notas de crédito y consulta de padrón—, el cifrado de las
credenciales sensibles, el panel, los avisos, el portal del inquilino y su
autenticación, los servicios de la propiedad y las inmobiliarias. Es además quien
más tocó el esquema de datos y las migraciones, quien escribió la suite de
integración sobre base limpia, y quien hizo el endurecimiento del aislamiento.
Cinco de los seis registros de decisión son suyos, incluidos el 0005 y el 0006.

**Qué expone.** La apertura y el cierre. La apertura: el problema, el alcance y el
recorrido del circuito del dinero —contrato, ajuste, liquidación, pago, morosidad,
rendición— que es la parte del recorrido que más pesa. El cierre: la arquitectura,
las decisiones registradas y, sobre todo, el aislamiento fallando cerrado, que es
la pregunta más difícil y le corresponde a quien lo corrigió.

**Preguntas que le tocan.** 1.1, 1.7, 1.9, 1.10, 1.11, 1.16, 1.17, 1.23.

### Romeo Valdomero — la aplicación web y la superficie de acceso

**Qué construyó.** La mayor parte del frontend: las pantallas, el sistema de
tarjetas compartido para los listados —el registro de decisión 0004 es suyo—, las
transiciones y las utilidades del cliente. En la API, la autenticación y los
usuarios, el micrositio público, el puntaje de inquilinos, los reportes y las
interacciones del módulo comercial, el libro de IVA ventas, y la respuesta uniforme
de error con el límite estricto en el ingreso. Construyó también la integración
continua inicial —estilo, compilación y pruebas—, la priorización diaria y el
resumen de cierre sobre el modelo de lenguaje, y la mayor parte de la documentación
de la última etapa: la referencia de API, el manual de pruebas, el manual de
usuario por rol y el guion de la demostración, más las correcciones de la
documentación de planificación.

**Qué expone.** La demostración del sistema en la parte de interfaz —micrositio,
panel, propiedades, contrato, portal del inquilino en sus dos situaciones— y las
dos funciones con modelo de lenguaje, incluida la aclaración obligada de que en el
ambiente de demostración corren por el camino determinista. Le corresponde también
el cierre técnico sobre la forma uniforme del error y el control de acceso por rol.

**Preguntas que le tocan.** 1.2, 1.3, 1.4, 1.18, 1.19, y la parte de interfaz de
1.6.

### marianonallar — el dominio operativo y la puesta en marcha

**Qué construyó.** Los módulos operativos de la API: propiedades, personas, pagos,
reclamos y proveedores, interesados y embudos, tasaciones, importación y
exportación, los índices de ajuste, la auditoría, y el cliente de modelo de
lenguaje configurable por ambiente con el contexto del día. Del lado web, el panel
de prioridades y buena parte del lenguaje visual. Y la puesta en marcha: la
ampliación de la integración continua a los cinco trabajos actuales —estilo,
cobertura con su piso, migraciones desde cero y pruebas de integración— y la guía
de despliegue.

**Qué expone.** El recorrido operativo —propiedades y personas, el circuito del
reclamo de punta a punta entre el portal y el ámbito interno, la asignación de
proveedor por rubro y zona, los interesados y el embudo, la importación con
validación previa fila por fila— y la parte de ingeniería: los cinco trabajos de
integración continua, con detenimiento en el que aplica todas las migraciones sobre
una base vacía, y el despliegue.

**Preguntas que le tocan.** 1.5, 1.12, 1.13, 1.14, 1.20, 1.21, 1.22.

### Preguntas que contesta quien la reciba

Las de alcance y método —1.6, 1.8, 1.15, 1.23— las puede tomar cualquiera, porque
son del trabajo y no de un módulo. Lo que no se hace es pasarse la pregunta entre
integrantes delante del tribunal: se contesta y, si hace falta, otro completa.

---

## 5. Antes de la defensa

El recorrido, los accesos necesarios y el estado con el que el ambiente tiene que
llegar están en `docs/demo.md`, con sus contingencias. No se duplican acá. Lo que
falta agregar es lo que corresponde a la preparación y no al recorrido:

- **Ensayar sobre una copia.** Cada paso del recorrido deja datos. Si se ensaya
  completo más de una vez, se ensaya sobre una copia o se sabe exactamente qué
  registros se consumen.
- **Tener el sistema corriendo también en local**, con su base propia, como
  respaldo del ambiente desplegado.
- **Repasar las respuestas de la sección 1 en voz alta**, en particular 1.1, 1.5 y
  1.6, que son las tres donde la respuesta honesta es más fuerte que la evasiva y
  donde una respuesta dubitativa se lee como que el problema es nuevo para quien
  contesta.
- **Acordar quién abre y quién cierra**, y que los tiempos de cada uno estén
  medidos en un ensayo completo y no estimados.
- **Ninguna credencial en pantalla.** Los accesos van en una hoja aparte, no en el
  repositorio, y las variables de configuración no se muestran.
