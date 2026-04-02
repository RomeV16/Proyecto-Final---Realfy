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

