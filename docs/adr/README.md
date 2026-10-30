# Registro de decisiones de arquitectura

Índice de las decisiones de arquitectura (ADR) del proyecto. Cada decisión vive en su propio archivo de esta carpeta, con contexto, decisión y consecuencias. Una decisión aceptada no se reescribe: si cambia, se escribe una nueva que la reemplaza y la anterior pasa a «Reemplazada».

## Decisiones aceptadas

| Número | Título | Estado | Fecha |
|---|---|---|---|
| [0001](0001-monorepo-turborepo.md) | Monorepo con Turborepo | Aceptado | 2026-04-18 |
| [0002](0002-stack-nest-next-prisma.md) | Stack NestJS, Next.js y Prisma | Aceptado | 2026-04-22 |
| [0003](0003-multi-tenant-row-level.md) | Multi-tenancy por row-level | Aceptado | 2026-05-11 |
| [0004](0004-sistema-de-tarjetas.md) | Sistema de tarjetas para pantallas con registros repetidos | Aceptado | 2026-08-13 |
| [0005](0005-manejo-uniforme-de-errores.md) | Manejo uniforme de errores | Aceptado | 2026-08-18 |
| [0006](0006-aislamiento-entre-inmobiliarias-fallando-cerrado.md) | El aislamiento entre inmobiliarias falla cerrado | Aceptado | 2026-08-18 |

## Decisiones planificadas para el piloto

Las decisiones que el piloto vuelve necesarias (ver `../tesis/30-piloto.md`) se escriben en el PR que las implementa y se agregan a esta tabla con su fecha cuando se aceptan. Hasta entonces no existe el archivo.

| Número | Título | Estado | Se decide en |
|---|---|---|---|
| 0007 | Locadores por contrato con porcentaje de cobro, apoderados y titularidad separada | Planificada | Ítem 33, PR de locadores y apoderados |
| 0008 | Impuestos y servicios trasladables: tres pagadores, reglas con vigencia y boletas | Planificada | Ítem 35, PR de boletas y reglas de traslado |
| 0009 | Cuenta corriente y estado de cuenta del locador, en reemplazo de la rendición por contrato | Planificada | Ítem 37, PR de cuenta corriente |
| 0010 | Reglas versionadas del contrato y valores por defecto de la inmobiliaria | Planificada | Ítem 34, PR de versiones de reglas y acuerdos |
| 0011 | Ajuste con rezago, estimación y corrección; fuente del índice de precios | Planificada | Ítem 34, PR del motor de ajuste |
| 0012 | Flujos de cobro, caja y custodia | Planificada | Ítem 36, PR de caja y cuentas |
| 0013 | Mensajería saliente con outbox y cobranza escalonada | Planificada | Ítem 43, PR de mensajería |
| 0014 | Ambiente piloto con datos reales y privacidad | Planificada | Ítem 31, PR de infraestructura del piloto |
| 0015 | Importación idempotente desde el sistema anterior | Planificada | Ítem 39, PR de importación |
| 0016 | Diagramas como código (mermaid) | Planificada (ítem 31) | Ítem 31, PR de base de proceso; se agrega en otro PR |

## Ajustes previstos a decisiones existentes

- ADR-0004: unificar su encabezado con el formato del resto (secciones «Estado» y «Fecha»).
- ADR-0006: agregar la regla de que todo modelo nuevo se registra en el filtro por inmobiliaria y en la limpieza de las pruebas de integración.

## Formato

Cada decisión usa las secciones Estado, Fecha, Contexto, Decisión y Consecuencias. Los estados posibles son Propuesta, Aceptado, Reemplazada y Rechazada.
