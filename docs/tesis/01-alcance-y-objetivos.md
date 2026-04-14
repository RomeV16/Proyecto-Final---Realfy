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

## Exclusiones

Quedan fuera del alcance del trabajo final:

- Contabilidad completa (libro diario, balances, conciliación bancaria avanzada).
- Cobros automáticos por pasarela de pago, débito directo o billeteras virtuales (se modela el registro del pago, no la captura del dinero).
- App móvil nativa para inquilinos o agentes (el portal web es responsive).
- Firma digital de contratos con certificación oficial; se contempla únicamente la generación del documento y su descarga.
- Integraciones con portales externos de publicación (ZonaProp, Argenprop, MercadoLibre) más allá de exportación CSV.
- Liquidación tributaria del propietario o del inquilino (retenciones, ganancias, ingresos brutos).
- Soporte para operaciones de venta con escrituración; el foco es alquiler.

<!-- Cierre item 01 — aprobado por tutor 2026-04-14 -->
