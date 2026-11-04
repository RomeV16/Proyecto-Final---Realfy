# Alcance y Objetivos

## Contexto y problemática

El mercado inmobiliario argentino opera en un escenario particular: inflación persistente, marcos regulatorios cambiantes para los contratos de locación, ajustes pactados por IPC o UVA, y un esquema tributario donde la facturación electrónica frente a ARCA (ex AFIP) es obligatoria. En este contexto, una inmobiliaria pequeña o mediana suele combinar varias herramientas para gestionar su operación diaria: planillas de cálculo para llevar el control de los contratos, un sistema contable separado para emitir comprobantes, mensajería tipo WhatsApp para coordinar reclamos de mantenimiento, y carpetas físicas o drives compartidos para la documentación.

Esta dispersión genera problemas recurrentes:

- Las liquidaciones mensuales se arman a mano, lo cual incrementa el riesgo de error al aplicar ajustes por índice (IPC, UVA o valor manual pactado).
- La conciliación de pagos depende del criterio de cada agente y no queda registrada de forma trazable.
- Los inquilinos no tienen un canal autogestionado para consultar su saldo, descargar el comprobante del mes o reportar un desperfecto.
- Los propietarios reciben rendiciones en formatos diversos, sin acceso histórico.
- La emisión de comprobantes electrónicos por ARCA queda desacoplada del sistema operativo de la inmobiliaria.
- El seguimiento comercial de leads y visitas suele perderse al no existir un CRM integrado al ciclo del contrato.

Realfy busca consolidar todo el ciclo de gestión inmobiliaria sobre una única plataforma multi-inmobiliaria, con foco en el contexto regulatorio argentino.

### Piloto con una inmobiliaria real

Desde octubre de 2026 el sistema se valida en una inmobiliaria real, una empresa familiar de administración de alquileres que lleva su ciclo mensual con una base de datos de escritorio y planillas (el capítulo completo está en `30-piloto.md`). El relevamiento de su operación confirmó los problemas de la lista anterior y agregó tres que el planteo original no había visto. El primero es que quien alquila y cobra no es necesariamente el dueño del inmueble: un contrato puede tener varios locadores, cada uno con su porcentaje de cobro, y apoderados que firman o cobran por ellos. El segundo es que casi todas las reglas del negocio son pactables contrato por contrato y cambian por acuerdos fechados, de modo que un sistema con reglas fijas en el código no sirve para operar. El tercero es que el costo principal de la operación está en el estado de cuenta que cada locador recibe al cierre del mes, que se arma a mano y llega con atraso.

## Objetivos generales

- Diseñar e implementar una plataforma SaaS multi-inmobiliaria que cubra el ciclo completo de gestión de alquileres residenciales y comerciales, desde la captación del lead hasta la rendición al propietario.
- Demostrar la aplicabilidad de una arquitectura monorepo TypeScript moderna (Turborepo, NestJS, Next.js, Prisma) sobre un caso real con requerimientos regulatorios locales.

## Objetivos específicos

- Modelar el dominio (propiedades, personas, contratos, liquidaciones, pagos, rendiciones) en un esquema relacional consistente con los regímenes argentinos de ajuste.
- Implementar el cálculo automático de actualizaciones por IPC, UVA y valor manual, con tabla histórica de índices.
- Generar liquidaciones mensuales con líneas configurables (alquiler, expensas, servicios, impuestos, honorarios, punitorios) y producir el comprobante electrónico vía ARCA.
- Construir un portal de autogestión para inquilinos con login propio, vista de saldo, descarga de comprobantes y apertura de tickets.
- Proveer un CRM básico con pipeline configurable, registro de interacciones y conversión de lead a contrato.
- Establecer un esquema de auditoría, logging y permisos por rol que permita operar en modo multi-inmobiliaria sin fugas entre tenants.
- Documentar la solución y validarla con pruebas integrales (Playwright) y revisión de seguridad sobre los flujos críticos.
- Validar el sistema en uso real con una inmobiliaria piloto: reproducir su ciclo mensual completo con las reglas pactadas en cada contrato, reconciliar los resultados contra su sistema actual hasta que no queden diferencias sin explicar y registrar cada fricción del uso hasta una corrección verificada. Las metas y la forma de medirlas están en `30-piloto.md`.

## Alcance funcional

Forman parte del alcance del trabajo final:

- Gestión de propiedades, propietarios, inquilinos y garantes.
- Contratos con garantías, plantillas y documentos asociados.
- Ajuste de alquiler por IPC, UVA y valor manual.
- Liquidaciones mensuales y registro de pagos.
- Morosidad, punitorios y derivación legal en modo manual.
- Tickets de mantenimiento con proveedores asignables.
- Portal de autogestión para inquilinos.
- Notificaciones por email de vencimientos, deudas y cambios de estado.
- CRM con leads, pipeline e interacciones.
- Portal público de la inmobiliaria con branding básico.
- Facturación electrónica vía ARCA (homologación contra el ambiente de testing).
- Scoring interno de inquilinos y tasaciones.
- Importación y exportación masiva con validación.
- Dashboard de KPIs operativos.
- Componentes con asistencia de IA: panel diario de priorización y resumen al cierre de contrato.

### Ampliación por el piloto

El piloto agrega al alcance lo que la inmobiliaria necesita para dejar sus planillas. La ampliación se decidió el 30 de octubre de 2026, a partir del relevamiento, y se organiza en los ítems 30 a 46 del cronograma (`04-backlog.md`). Al 2 de noviembre de 2026 su estado es el siguiente:

| Funcionalidad | Ítem | Estado |
|---|---|---|
| Usuarios con invitación, cambio y recupero de contraseña, menú y lectura de datos sensibles por rol | 32 | Implementado |
| Personas con documento, domicilio y varias cuentas bancarias; locadores por contrato con porcentaje de cobro y vigencia; apoderados; titularidad separada | 33 | Implementado |
| Activación del contrato; reglas versionadas con acuerdos fechados y valores por defecto de la inmobiliaria; fin real y prórroga de palabra; ajuste con rezago, estimado y corrección, y aplicación de los ajustes del mes | 34 | Implementado |
| Liquidación completa: generación anticipada con prorrateo y vencimiento pactado, boletas de impuestos y servicios con reglas de traslado, centro de carga, punitorios dentro de la liquidación, recibo numerado con monto en letras | 35 | Implementado |
| Importación idempotente desde el sistema anterior, con servicios y reglas de traslado, y panel de calidad de datos | 39 | Implementado; la carga de la cartera real y de sus servicios está hecha y su revisión con la inmobiliaria sigue en curso (saldos, plantillas y ventas, en `32-migracion.md`) |
| Caja operativa, cobro en tres flujos, efectivo en custodia y compensaciones | 36 | Implementado |
| Cuenta corriente y estado de cuenta consolidado por locador | 37 | Implementado |
| Facturación electrónica por cuenta del locador | 38 | Implementado |
| Vencimientos con semáforo, renovación como período del contrato, depósitos y liquidación de egreso | 40 | Implementado |
| Honorarios de alta, renovación, venta y tasación, y comisiones del personal | 41 | Implementado |
| Incidencias y reparaciones con preautorización, presupuesto e imputación | 42 | Implementado |
| Correo con dominio propio, mensajería instantánea con consentimiento, bandeja de consultas y cobranza escalonada | 43 | Implementado; la mensajería está apagada en el ambiente piloto y la recepción de mails está activa desde el 4/11/2026 |
| Operación de venta hasta el boleto (reserva y seña), registro de llaves y publicación asistida en portales | 44 | Implementado |
| Obtención automática de boletas de servicios e impuestos por PDF, mail y consulta, con catálogo de proveedores y revisión (oleada 6, dentro de los ítems 35 y 39) | 35, 39 | Implementado; los lectores de electricidad y gas y el conector de consulta quedan pendientes |
| Ciclos en paralelo, reconciliación y métricas del piloto | 45 | En curso: dos ensayos generales hechos sobre una copia; línea base y primer ciclo en sombra alrededor del 20/11/2026 |

## Exclusiones

Quedan fuera del alcance del trabajo final:

- Contabilidad completa (libro diario, balances, conciliación bancaria avanzada). La caja operativa y la cuenta corriente por locador que agrega el piloto registran el dinero que pasa por la inmobiliaria y lo que se le debe a cada locador; no son un sistema contable.
- Cobros automáticos por pasarela de pago, débito directo, billeteras virtuales o recaudadoras como SIRO (se modela el registro del pago, incluido el efectivo en oficina, no la captura del dinero). La recaudadora queda declarada como trabajo futuro.
- App móvil nativa para inquilinos o agentes (el portal web es responsive).
- Firma digital de contratos con certificación oficial; se contempla únicamente la generación del documento y su descarga.
- Integraciones con portales externos de publicación (ZonaProp, Argenprop, MercadoLibre y portales de clasificados) que no ofrezcan una interfaz programática. El piloto incorpora la publicación asistida —estado del aviso por portal y texto listo para copiar— y el micrositio como portal propio; la integración solo entra si el portal ofrece una interfaz. Al implementar el ítem 44 no se confirmó que Zonaprop, Argenprop, MercadoLibre ni Clasificados La Voz ofrezcan una interfaz, un archivo de avisos o una notificación de consultas que una inmobiliaria pueda usar desde un sistema propio, de modo que ninguna integración se construyó: la publicación en esos portales es manual y el sistema registra el estado de cada aviso. Consultar a la persona que publica y a los portales si existe esa interfaz queda como acción pendiente; si aparece, entra como trabajo futuro.
- Liquidación tributaria del propietario o del inquilino (retenciones, ganancias, ingresos brutos). La facturación electrónica por cuenta del locador que agrega el piloto emite el comprobante en su nombre; no liquida sus impuestos.
- Escrituración de operaciones de venta. El piloto incorpora la operación de venta hasta el boleto —reserva, seña y honorarios—, sin la escrituración.
- Dentro del piloto, además: el inventario estructurado con fotos (se mantiene como adjunto), el portal del propietario, la publicación en redes sociales y una capa de análisis de garantes más allá del puntaje actual. Se declaran como trabajo futuro.

## Revisión del alcance por el piloto

Este documento se aprobó en el Hito 1 y su versión original no incluía el uso con datos reales de personas ni las secciones «Piloto con una inmobiliaria real», «Ampliación por el piloto» y la precisión de las exclusiones, que se agregaron el 2 de noviembre de 2026. Es un desvío declarado respecto del alcance aprobado: el cambio no nace de una reestimación del equipo sino del relevamiento de una operación real, y cada ampliación tiene su hallazgo de origen en `31-registro-de-feedback.md` y su ítem en `04-backlog.md`. Las exclusiones originales se mantienen; lo que cambió es dónde pasa exactamente la frontera de cada una, y la relación entre unas y otras está detallada en `30-piloto.md`, «Relación con las exclusiones del alcance original».

<!-- Cierre item 01 — aprobado por tutor 2026-04-14 -->
