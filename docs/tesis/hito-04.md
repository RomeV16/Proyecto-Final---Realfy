# Hito 4: Entrega final de tesis

## Fecha

2026-11-30. El hito se reabrió el 2026-11-02 y este documento se actualizó por última vez el 2026-11-04; su primera versión se cerró el 2026-08-18 y se conserva más abajo sin cambios de contenido.

## Por qué se reabre

El cronograma fijaba el Hito 4 el 30/11/2026, pero este documento lo daba por cerrado el 18/08/2026, cuando se terminó la versión beta del informe final. Esa contradicción ya existía antes del piloto, y el piloto la volvió imposible de sostener: la validación en una inmobiliaria real empezó el 30/10/2026 y cambia lo que la entrega final tiene que mostrar. Se evaluaron dos caminos: mantener el hito como estaba y abrir un hito nuevo para el piloto, o reabrirlo con la fecha que el cronograma siempre tuvo. Se eligió reabrirlo, para que la entrega y la defensa cuenten una sola historia: el hito se fecha el 30/11/2026 y se entrega con el piloto en curso; lo cerrado el 18/08 pasa a ser su primera versión, y lo que ocurra en los ciclos posteriores se agrega como anexo de validación en campo, sin reescribir lo entregado. Es un desvío declarado respecto del plan del Hito 1, no una corrección silenciosa.

## Resumen del hito

El Hito 4 cierra el trabajo con dos partes. La primera, cerrada el 18/08/2026, es el sistema probado, endurecido y documentado, con el informe final escrito y la demostración preparada. La segunda es el piloto: la puesta del sistema en manos de una inmobiliaria real que administra alquileres, con su cartera cargada, su ciclo mensual reproducido en Realfy y los resultados reconciliados contra su sistema actual. El criterio para dar por cumplida la primera parte fue que un lector externo pudiera entender, desplegar, probar y evaluar el sistema sin ayuda; el de la segunda es que el ciclo mensual de una cartera real cierre con diferencia cero, o con cada diferencia explicada y registrada.

## Capítulo del piloto (estado al 2026-11-04)

El capítulo completo está en `30-piloto.md`; el registro de hallazgos, en `31-registro-de-feedback.md`; la migración, en `32-migracion.md`, y la trazabilidad, en `33-matriz-de-trazabilidad.md`. El informe final lo resume en su sección 9, que incluye la tabla única de cifras del sistema. Lo que sigue resume dónde está cada parte al 2026-11-04.

**Relevamiento.** Se revisaron los archivos que la inmobiliaria entregó de su operación —la base de escritorio, las planillas de ajustes y de estados de cuenta, los recibos y los modelos de contrato— y se le hicieron preguntas por escrito, respondidas el 30/10/2026. De ahí salieron los hallazgos FB-01 a FB-28, todos con origen en el relevamiento y ninguno todavía de uso real, porque nadie de la inmobiliaria operó el sistema aún. Los que más pesaron en el diseño son tres: el locador no es necesariamente el propietario y un contrato puede tener varios, con su porcentaje de cobro; casi todas las reglas son pactables por contrato y cambian por acuerdos fechados, y el dinero llega por tres caminos distintos.

**Plan.** El piloto se organizó en los ítems 30 a 46 del cronograma, en seis oleadas, cada ítem con su issue, su dueño y su revisión cruzada, y con un calendario que no fija el equipo sino el ciclo de la inmobiliaria: la línea base y el primer ciclo en sombra alrededor del 20/11/2026, y los siguientes alrededor del 20 de cada mes hasta febrero de 2027 (`04-plan-sprints.md`, «Fases del piloto»).

**Lo entregado.** Entre el 30/10 y el 3/11/2026 se integraron cincuenta pedidos de incorporación (#105 a #183), todos revisados por otro integrante, y con ellos las seis oleadas de desarrollo quedaron entregadas. Las oleadas 0 a 2, cerradas antes de la reapertura, dieron la base de proceso (protección de la rama principal, plantillas, pruebas de la web, controles de código muerto y duplicación, ensayo de migraciones sobre datos), los usuarios con invitación, recupero de contraseña y política de lectura por rol, el modelo de locadores, apoderados y titularidad, las reglas versionadas del contrato con acuerdos y valores por defecto, el ajuste con rezago y la liquidación completa con boletas, reglas de traslado, cargos, punitorios y recibo numerado. Después de la reapertura se integraron las oleadas 3 a 5:

- **Oleada 3, dinero y datos reales** (ítems 36, 37, 39 y 45): la caja con el cobro en tres flujos, la custodia y las compensaciones (#161); la cuenta corriente y el estado de cuenta mensual consolidado del locador, con saldo inicial y pago al locador, que deja la rendición por contrato como histórico (#165); la importación idempotente y el panel de calidad de datos (#155 y #160), y la suite de reconciliación del ciclo mensual con casos sintéticos (#177), que encontró cuatro defectos antes del primer ciclo (DEF-70 a DEF-73).
- **Oleada 4, ciclo de vida del contrato** (ítems 38, 40, 41 y 42): el semáforo de vencimientos con seguimientos y checklist, la prórroga de palabra y la renovación como período del contrato (#166); las incidencias con preautorización, presupuesto, pago al proveedor e imputación (#167); los honorarios de alta, renovación, venta y tasación, con cuotas y comisiones del personal (#168); los depósitos con moneda, tenedor y cuotas, y la liquidación de egreso (#169), y la facturación por cuenta del locador con emisor delegado (#170).
- **Oleada 5, mensajería y comercial** (ítems 43 y 44): la bandeja de salida idempotente con correo y WhatsApp, modos de envío y consentimiento por canal (#172); la publicación asistida con estado por portal y el micrositio con dominio propio (#178); las ventas desde la reserva hasta la escritura, con señas y documentación, y el registro de llaves (#180), la cobranza escalonada, apagada de fábrica (#181), y la bandeja de consultas unificada, con responsable, plazo de primera respuesta de 15 minutos y autorrespuesta (#183).

Las decisiones de arquitectura pasaron de seis a diecisiete (ADR-0007 a ADR-0017, índice en `../adr/README.md`).

**Carga real de datos.** La cartera de la inmobiliaria se cargó en el ambiente `piloto` el 2026-11-02 con el importador, después de un ensayo sin escritura que dio el mismo resultado, sin filas con error. Se cargaron también los contratos no vigentes, como historial, y el historial de ajustes de los vigentes. Las inconsistencias del origen que el importador no puede resolver solo —repartos entre locadores que el sistema anterior no distingue, reglas inferidas, datos faltantes— quedaron en una lista de revisión para la inmobiliaria, fuera del repositorio, y se corrigen reenviando el lote. Antes y después de la carga se tomaron copias de la base y se probó su restauración con los datos reales: la base se restauró en unos 3 segundos (ver `../despliegue.md`). Entre el 31/10 y el 4/11/2026 el ambiente `piloto` recibió diez despliegues, cada uno precedido por su copia y, cuando traía migraciones, por su ensayo sobre una copia restaurada; el del 3/11 reunió las seis oleadas completas, con la cobranza escalonada y la bandeja de consultas, y los posteriores sumaron la migración de servicios y las correcciones de los ensayos (de 64 a 69 migraciones). La mensajería está en modo apagado en `piloto`. Este repositorio no publica cifras de la cartera: el consentimiento de la inmobiliaria para usar cifras agregadas sigue pendiente.

**Migración completa y boletas automáticas (oleada 6).** El 3/11 se verificó que la migración no estaba completa: faltaban los servicios y reglas de traslado (M8), las boletas (M9), los saldos iniciales (M10), las plantillas (M11) y las ventas en curso (M12). M8 se cargó el mismo día por el importador y se comparó cada contrato activo contra su documento, con las filas de corrección cargadas por reenvío del lote. Las boletas pasaron a un circuito de obtención automática (ADR-0018): un catálogo de proveedores de Córdoba con su lector de PDF, ingreso por archivo y por mail, una cola de revisión para lo que no se lee con certeza y una pantalla para resolverla, y recepción de mails por el DNS propio con un componente de Cloudflare, activa en `piloto` desde el 4/11. M10 tiene una propuesta a confirmar y el saldo inicial de custodia (#197) y el motor de plantillas ampliado (#199) se integraron el 4/11; las ventas tienen un inventario y cuatro brechas. El estado de cada paso está en `32-migracion.md`; la obtención automática, en la sección 9.4 del informe final.

**Dominio y ambientes.** Desde el 3/11 el producto sirve en `realfy.app`: el ambiente `piloto` es el producto, en `app.realfy.app`, y la demostración, con datos sintéticos, en `demo.realfy.app`. El dominio de correo está verificado para el envío; la mensajería sigue apagada.

**Ensayos generales del primer ciclo.** El 3 y el 4/11 se ensayó el ciclo de diciembre dos veces sobre una copia restaurada de la base de `piloto`, con la herramienta del C1 y sin tocar el ambiente. El primero mostró que, con el sistema como estaba, ningún ajuste podía aplicarse y que se esperaba una coincidencia al centavo muy baja; encontró once problemas (D1 a D11, registrados como veinte defectos, DEF-115 a DEF-143, uno bloqueante), que se corrigieron en seis pedidos y se desplegaron juntos. El segundo confirmó las correcciones y encontró dos problemas más (E1 y E2, cuatro defectos, DEF-173 a DEF-176, corregidos en #242): con las boletas cargadas y las prórrogas registradas la coincidencia estimada del C1 mejora mucho (porcentajes: a completar tras el consentimiento de la inmobiliaria), y depende sobre todo de las boletas, las prórrogas y de la regla de redondeo del alquiler ajustado. Los resultados están en `../calidad/12-piloto.md`, sección 10; son estimaciones y no el resultado del C1.

**Validación en campo, pendiente con fecha.** Todo lo anterior está construido y probado, pero todavía no lo operó nadie de la inmobiliaria: los veintiocho hallazgos registrados son del relevamiento y ningún defecto proviene del uso real. La validación depende de fechas que fija el ciclo de la inmobiliaria:

| Ciclo | Fecha | Qué produce | Estado |
|---|---|---|---|
| Línea base | ≈ 20/11/2026 | Tiempos por tarea, errores de carga y atraso del estado de cuenta con el sistema actual | A completar tras el ciclo C1 (≈ 20/11/2026) |
| C1, en sombra | ≈ 20/11/2026 | Reconciliación de los recibos de diciembre, por contrato | A completar (≈ 20/11/2026) |
| C2, en paralelo | ≈ 20/12/2026 | Reconciliación de recibos y estados de cuenta; primeros hallazgos de uso real | A completar en el anexo de validación |
| C3, opera la inmobiliaria | ≈ 20/01/2027 | Métricas antes y después; hallazgos y defectos del uso real | A completar en el anexo de validación |

El resultado del C1 se incorpora a este documento y al informe final antes del 30/11; el del C2 y el C3, al anexo de validación en campo, sin reescribir lo entregado.

## Estado del sistema al 2026-11-04

Las cifras del sistema —módulos, entidades, migraciones, rutas, decisiones de arquitectura, casos de uso, casos de prueba, defectos, pruebas y cobertura— se consignan una sola vez, en la tabla de la sección 9.10 de `29-informe-final.md`, medida el 2026-11-04 sobre el commit `c7b3eac` con la fuente de cada valor, junto con la medición anterior del 2026-11-03 sobre `a2ea7d9`. Este documento no las repite, para no volver a tener números que no coinciden entre documentos, como pasó en la primera versión. Lo que sí corresponde dejar acá es el estado del proceso: la rama principal está protegida desde el 2026-10-30, la integración continua corre nueve trabajos en cada cambio, ocho de ellos obligatorios para integrar, y los sesenta y siete pedidos del piloto (#105 a #237) pasaron por ese circuito.

## Lecciones aprendidas del piloto

- **El relevamiento cambió el modelo antes de que lo cambiara el uso.** La distinción entre locador, titular y apoderado no estaba en ningún documento de la tesis y salió de leer cómo trabaja una inmobiliaria real. Haberla resuelto antes de cargar datos evitó migrar una cartera real sobre un modelo equivocado.
- **Una regla fija en el código es una deuda con fecha.** Cada vez que el relevamiento mostró una regla «de la inmobiliaria» —prorrateo, vencimiento, punitorio, reparto de impuestos, anticipo—, apareció un contrato que la pactaba distinto. La respuesta fue la misma en todos los casos: un valor por defecto de la inmobiliaria que cada contrato puede pisar, y los cambios como acuerdos fechados que no reescriben la historia.
- **La carga se pudo hacer antes de tener los datos perfectos porque es repetible.** Que la importación sea idempotente permitió cargar la cartera y corregirla después, en lugar de esperar a que la inmobiliaria revisara cada dato antes de empezar.
- **La lección de la primera versión se cumplió.** Esa versión decía que un cambio de seguridad hecho sin datos reales habría costado mucho más con ellos. Con el piloto, cada migración se ensaya sobre una copia restaurada de los datos reales antes de desplegarla, y cada despliegue a `piloto` va precedido de una copia; el costo de cambiar algo creció exactamente como se había anticipado.
- **No se presenta el relevamiento como uso.** El registro de feedback separa los hallazgos del relevamiento de los del uso real, y a la fecha todos son del relevamiento. La validación de uso empieza con el C2 y se informa como tal.
- **El ciclo encadenado encuentra lo que el módulo no ve.** La suite de reconciliación encontró cuatro defectos en módulos con buena cobertura y sus pruebas en verde; aparecieron al pasar el resultado de un motor al siguiente, que es lo que hace la inmobiliaria cada mes.
- **Ensayar sobre una copia de los datos reales encuentra lo que lo sintético no.** Los dos ensayos generales encontraron trece problemas (veinticuatro defectos del registro) en la forma en que los datos importados llegan al motor, entre ellos uno que impedía aplicar cualquier ajuste, y la suite sintética, cuyos datos nacen bien formados, no veía ninguno. El ensayo pasa a ser un paso fijo antes de cada ciclo.
- **Dar un paso por cerrado por lo que se construyó es el mismo error que la primera versión.** La migración se creyó completa porque estaban cargados los contratos; no lo estaba, porque faltaban los servicios y las reglas que definen el importe de impuestos y servicios. Se detectó al contrastar con la operación real, no al revisar lo construido.
- **Construir antes del ciclo traslada el riesgo a la validación.** Las oleadas 4 y 5 estaban planificadas entre diciembre y febrero y se integraron antes del primer ciclo. Es una ventaja de calendario, pero también el mismo patrón que la primera versión declaró como desvío: mucha funcionalidad lista y todavía sin operar. La mitigación es la reconciliación sintética y no encender lo que sale hacia afuera —mensajería y cobranza— hasta que la inmobiliaria lo apruebe.

## Riesgos del piloto

| Riesgo | Mitigación |
|---|---|
| El ciclo no reconcilia a tiempo para la entrega del 30/11 | El C1 es en sombra y su resultado se informa como esté, con cada diferencia registrada como FB o defecto; la entrega no depende de que la diferencia sea cero |
| Pérdida o corrupción de los datos reales | Copias nativas diarias y semanales, copia lógica fuera del proveedor semanal y antes de cada despliegue, restauración probada con los datos reales (R-12) |
| Un despliegue rompe el ciclo mensual | Despliegue manual: primero `production`, después `piloto`, con ensayo de migraciones sobre una copia (R-13) |
| Adopción: la inmobiliaria no deja sus planillas | Paralelo obligatorio antes de operar y empezar por lo que más le cuesta, los estados de cuenta |
| Fuente del índice de precios | CSV del INDEC con el BCRA de respaldo, carga manual y estimado con corrección |
| Reglas legales y fiscales no confirmadas | Valores configurables con vigencia y consulta al contador y al abogado |
| Correo y WhatsApp sin habilitar en `piloto` | La mensajería queda en modo apagado; los documentos se descargan en PDF mientras se configuran el dominio, Resend y la cuenta de WhatsApp, y el sistema no marca como enviado lo que no se envió |
| Funcionalidad entregada antes de ser operada | Encender por etapas lo que el ciclo necesita, empezando por la liquidación y el estado de cuenta; la cobranza escalonada y la facturación automática quedan apagadas hasta su validación |
| Consentimiento para publicar cifras agregadas | Nada de cifras de la operación en el repositorio hasta tenerlo; las cantidades agregadas de los ensayos generales se retiran si no llega |
| El proceso diario aplica ajustes sobre un cronograma importado incorrecto | Los arreglos de ajustes se despliegan juntos; antes de cada ciclo, ensayo sobre una copia; dos ajustes de contratos con historial dudoso se retuvieron hasta confirmar con la inmobiliaria |
| El C1 sale con muchas diferencias por boletas, prórrogas y redondeo | Cargar las boletas de diciembre antes de generar, registrar las prórrogas con la fecha que indique la inmobiliaria y decidir la regla de redondeo (`../calidad/12-piloto.md`, sección 10); el C1 se informa como esté |
| Los lectores de boletas de EPEC y Ecogas no están validados con boletas reales | No dan de alta solas: sus documentos van a revisión hasta ajustar el lector con una boleta real |

El registro completo de riesgos del proyecto está en `../calidad/04-riesgos.md`.

## Próximos pasos

Hasta la entrega del 30/11/2026:

- Desplegar en `piloto`, con su copia previa y el ensayo de sus migraciones, lo integrado el 4/11 que todavía no esté desplegado: el saldo inicial de custodia (#197), las plantillas completas (#199) y la prórroga sin historial (#242). La recepción de mails (#234) está activa en `piloto` desde el 4/11.
- Cerrar con la inmobiliaria la lista de revisión de la carga, los saldos iniciales propuestos, las preguntas sobre los contratos con ajuste retenido o historial inválido, y reenviar el lote corregido.
- Antes de generar la liquidación de diciembre: confirmar el IPC de octubre, previsualizar los ajustes del mes, cargar las boletas de diciembre y registrar las prórrogas que indique la inmobiliaria (`../calidad/12-piloto.md`, sección 10).
- Medir la línea base y correr el C1 en sombra alrededor del 20/11/2026: generar la liquidación de diciembre en `piloto`, reconciliar los recibos contra el sistema actual y registrar cada diferencia como hallazgo o defecto dentro de las 24 horas.
- Incorporar el resultado del C1 a este documento y a la sección 9 del informe final, en forma agregada y sólo con el consentimiento de la inmobiliaria.
- Pedir las confirmaciones pendientes al contador, al abogado y al colegio profesional, y las tres decisiones de boletas (conector de la Municipalidad, Rentas y adhesión a la factura digital).

Hasta la defensa, en febrero de 2027:

- C2 en paralelo (≈ 20/12/2026), con los estados de cuenta, y C3 (≈ 20/01/2027), con la inmobiliaria operando: corregir lo que surja del uso real y actualizar el anexo de validación en campo después de cada ciclo.
- Encender la mensajería y, si la inmobiliaria lo aprueba, la cobranza escalonada, una vez verificada la cuenta de WhatsApp (el dominio de correo ya está verificado).
- Preparar la defensa con el piloto como evidencia (`29-preparacion-defensa.md`) e informar el C4 (≈ 20/02/2027) como cierre posterior si cae después.

## Primera versión (cerrada el 2026-08-18)

Lo que sigue es el contenido del hito tal como se cerró el 18/08/2026. Las cifras son las de esa fecha y no se actualizan acá: las vigentes están en la sección 9.10 de `29-informe-final.md`.

### Resumen del hito

El Hito 4 cierra el trabajo. A diferencia de los anteriores, su entregable no es funcionalidad nueva: es el sistema probado, endurecido y documentado, con el informe final escrito y la demostración preparada. Lo que se agregó desde el Hito 3 fueron las dos funciones con modelo de lenguaje, la infraestructura de pruebas y las correcciones de seguridad, y toda la documentación técnica y de usuario.

El criterio para considerar el hito cumplido fue que un lector externo pudiera, sin ayuda del equipo, entender qué hace el sistema, desplegarlo, probarlo y evaluarlo. De ahí que la etapa final haya producido más documentación que código.

### Entregado desde el Hito 3

- **Panel de priorización diaria** y **resumen de gestión al cierre de contrato**, las dos funciones con modelo de lenguaje. Se construyeron con el proveedor como valor de configuración, sin datos personales saliendo del sistema, con la respuesta del modelo validada contra un esquema y con respaldo determinista, de manera que la funcionalidad no depende de que el proveedor esté disponible.
- **Pruebas integrales**: se arreglaron las suites que no cargaban, se incorporaron las pruebas de integración que corren contra una base creada desde cero, y la integración continua pasó de compilar a cinco trabajos, incluido uno que aplica todas las migraciones sobre una base vacía.
- **Endurecimiento del aislamiento entre inmobiliarias**: la extensión que filtra por inmobiliaria pasó a fallar cerrado. Antes, una consulta sin sesión pasaba sin filtrar; ahora falla. La auditoría previa a ese cambio encontró dos consultas que ya leían datos de otras inmobiliarias.
- **Respuesta uniforme de errores** y límite estricto de intentos en el ingreso, incluido el del portal del inquilino, que no tenía ninguno.
- **Documentación**: manual de usuario por rol, guía de despliegue, referencia de API, manual de pruebas, guion de la demostración y dos decisiones de arquitectura nuevas. Y la corrección de la documentación de etapas anteriores, que en varios puntos describía un sistema distinto al entregado.
- **Informe final y material de preparación de la defensa.**

### Estado final del sistema

El backend expone treinta y un módulos sobre un modelo de cincuenta y cinco entidades, con dieciocho migraciones. La interfaz cubre dieciocho secciones internas, más el portal del inquilino y el portal público por inmobiliaria. Las pruebas son seiscientas noventa y siete unitarias en sesenta y cinco suites y cuatrocientas sesenta y cinco de integración en treinta suites, estas últimas contra una base creada desde cero. La cobertura de líneas es del cuarenta y dos por ciento, con un piso exigido del treinta y ocho en integración continua. Hay seis decisiones de arquitectura registradas.

El repositorio acumula algo más de trescientos commits de los tres integrantes, con cincuenta y una integraciones revisadas de forma cruzada, y las cuatro etapas del cronograma quedaron cerradas con su documento y su etiqueta.

### Lecciones aprendidas

- **Verificar la documentación existente rindió más que escribir documentación nueva.** Al contrastar el modelo de datos documentado contra el esquema, veintiuna de las treinta y dos entidades descriptas tenían al menos un campo que no existía, y había una sección entera dedicada a un módulo que nunca se implementó. La documentación escrita en la etapa de planificación envejeció sin que nadie volviera sobre ella.
- **Un riesgo declarado no es un riesgo controlado.** La lista de modelos alcanzados por el filtro de inmobiliaria estaba anotada como deuda desde su decisión de arquitectura, y aun así se le escapó un modelo. Corregirlo no bastaba: hizo falta una prueba que compare la lista contra el esquema para que el olvido rompa la suite en lugar de pasar inadvertido.
- **Las decisiones de seguridad se toman antes de tener usuarios, o no se toman.** Invertir el aislamiento para que falle cerrado fue posible porque el sistema todavía no está en producción; con datos reales y usuarios activos, el mismo cambio habría requerido una migración de comportamiento y mucho más cuidado.
- **Un trabajo con un modelo de lenguaje se sostiene por lo que el modelo no hace.** La decisión de calcular todas las cifras en el sistema y dejarle al modelo únicamente la redacción, verificando además que no introduzca números propios, es lo que hace defendible el resultado sobre datos financieros de un contrato.
- **Declarar los desvíos fortalece el trabajo.** El informe final dice qué se planificó y no se entregó, cuál es la cobertura real y qué limitaciones quedan abiertas. Un plan que coincide perfectamente con el resultado es menos creíble que uno que explica en qué se desvió y por qué.

### Cierre

Las cuatro etapas del cronograma están cerradas: planificación aprobada, MVP operativo demostrable, beta integrada y entrega final. El sistema queda desplegado en un ambiente de demostración, con la documentación necesaria para operarlo, desplegarlo y evaluarlo, y con sus limitaciones escritas.
