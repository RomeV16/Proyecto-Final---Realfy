# Hito 4: Entrega final de tesis

## Fecha

2026-08-18.

## Resumen del hito

El Hito 4 cierra el trabajo. A diferencia de los anteriores, su entregable no es funcionalidad nueva: es el sistema probado, endurecido y documentado, con el informe final escrito y la demostración preparada. Lo que se agregó desde el Hito 3 fueron las dos funciones con modelo de lenguaje, la infraestructura de pruebas y las correcciones de seguridad, y toda la documentación técnica y de usuario.

El criterio para considerar el hito cumplido fue que un lector externo pudiera, sin ayuda del equipo, entender qué hace el sistema, desplegarlo, probarlo y evaluarlo. De ahí que la etapa final haya producido más documentación que código.

## Entregado desde el Hito 3

- **Panel de priorización diaria** y **resumen de gestión al cierre de contrato**, las dos funciones con modelo de lenguaje. Se construyeron con el proveedor como valor de configuración, sin datos personales saliendo del sistema, con la respuesta del modelo validada contra un esquema y con respaldo determinista, de manera que la funcionalidad no depende de que el proveedor esté disponible.
- **Pruebas integrales**: se arreglaron las suites que no cargaban, se incorporaron las pruebas de integración que corren contra una base creada desde cero, y la integración continua pasó de compilar a cinco trabajos, incluido uno que aplica todas las migraciones sobre una base vacía.
- **Endurecimiento del aislamiento entre inmobiliarias**: la extensión que filtra por inmobiliaria pasó a fallar cerrado. Antes, una consulta sin sesión pasaba sin filtrar; ahora falla. La auditoría previa a ese cambio encontró dos consultas que ya leían datos de otras inmobiliarias.
- **Respuesta uniforme de errores** y límite estricto de intentos en el ingreso, incluido el del portal del inquilino, que no tenía ninguno.
- **Documentación**: manual de usuario por rol, guía de despliegue, referencia de API, manual de pruebas, guion de la demostración y dos decisiones de arquitectura nuevas. Y la corrección de la documentación de etapas anteriores, que en varios puntos describía un sistema distinto al entregado.
- **Informe final y material de preparación de la defensa.**

## Estado final del sistema

El backend expone treinta y un módulos sobre un modelo de cincuenta y cinco entidades, con dieciocho migraciones. La interfaz cubre dieciocho secciones internas, más el portal del inquilino y el portal público por inmobiliaria. Las pruebas son seiscientas noventa y siete unitarias en sesenta y cinco suites y cuatrocientas sesenta y cinco de integración en treinta suites, estas últimas contra una base creada desde cero. La cobertura de líneas es del cuarenta y dos por ciento, con un piso exigido del treinta y ocho en integración continua. Hay seis decisiones de arquitectura registradas.

El repositorio acumula algo más de trescientos commits de los tres integrantes, con cincuenta y una integraciones revisadas de forma cruzada, y las cuatro etapas del cronograma quedaron cerradas con su documento y su etiqueta.

## Lecciones aprendidas

- **Verificar la documentación existente rindió más que escribir documentación nueva.** Al contrastar el modelo de datos documentado contra el esquema, veintiuna de las treinta y dos entidades descriptas tenían al menos un campo que no existía, y había una sección entera dedicada a un módulo que nunca se implementó. La documentación escrita en la etapa de planificación envejeció sin que nadie volviera sobre ella.
- **Un riesgo declarado no es un riesgo controlado.** La lista de modelos alcanzados por el filtro de inmobiliaria estaba anotada como deuda desde su decisión de arquitectura, y aun así se le escapó un modelo. Corregirlo no bastaba: hizo falta una prueba que compare la lista contra el esquema para que el olvido rompa la suite en lugar de pasar inadvertido.
- **Las decisiones de seguridad se toman antes de tener usuarios, o no se toman.** Invertir el aislamiento para que falle cerrado fue posible porque el sistema todavía no está en producción; con datos reales y usuarios activos, el mismo cambio habría requerido una migración de comportamiento y mucho más cuidado.
- **Un trabajo con un modelo de lenguaje se sostiene por lo que el modelo no hace.** La decisión de calcular todas las cifras en el sistema y dejarle al modelo únicamente la redacción, verificando además que no introduzca números propios, es lo que hace defendible el resultado sobre datos financieros de un contrato.
- **Declarar los desvíos fortalece el trabajo.** El informe final dice qué se planificó y no se entregó, cuál es la cobertura real y qué limitaciones quedan abiertas. Un plan que coincide perfectamente con el resultado es menos creíble que uno que explica en qué se desvió y por qué.

## Cierre

Las cuatro etapas del cronograma están cerradas: planificación aprobada, MVP operativo demostrable, beta integrada y entrega final. El sistema queda desplegado en un ambiente de demostración, con la documentación necesaria para operarlo, desplegarlo y evaluarlo, y con sus limitaciones escritas.
