# Registro de decisiones de arquitectura

Índice de las decisiones de arquitectura (ADR) del proyecto. Cada decisión vive en su propio archivo de esta carpeta, con contexto, decisión y consecuencias. Una decisión aceptada no se reescribe: si cambia, se escribe una nueva que la reemplaza y la anterior pasa a «Reemplazada»; las precisiones posteriores que no la cambian se agregan como addendum fechado al final del mismo archivo.

Índice verificado el 3 de noviembre de 2026 contra los archivos de la carpeta: dieciocho decisiones, todas aceptadas. Las seis primeras son del desarrollo original de la tesis; de la 0007 en adelante, del piloto en una inmobiliaria real (`../tesis/30-piloto.md`).

## Decisiones

| Número | Título | Estado | Fecha | Origen |
|---|---|---|---|---|
| [0001](0001-monorepo-turborepo.md) | Monorepo con Turborepo | Aceptado | 2026-04-18 | Tesis |
| [0002](0002-stack-nest-next-prisma.md) | Stack NestJS, Next.js y Prisma | Aceptado | 2026-04-22 | Tesis |
| [0003](0003-multi-tenant-row-level.md) | Multi-tenancy por row-level | Aceptado | 2026-05-11 | Tesis |
| [0004](0004-sistema-de-tarjetas.md) | Sistema de tarjetas para pantallas con registros repetidos | Aceptado | 2026-08-13 | Tesis |
| [0005](0005-manejo-uniforme-de-errores.md) | Manejo uniforme de errores | Aceptado | 2026-08-18 | Tesis |
| [0006](0006-aislamiento-entre-inmobiliarias-fallando-cerrado.md) | El aislamiento entre inmobiliarias falla cerrado | Aceptado, con addendum del 2026-10-31 | 2026-08-18 | Tesis |
| [0007](0007-locadores-apoderados-y-titularidad.md) | Locadores por contrato, apoderados y titularidad de propiedades | Aceptado | 2026-10-31 | Piloto, ítem 33 |
| [0008](0008-impuestos-y-servicios-trasladables.md) | Impuestos y servicios trasladables: tres pagadores, reglas con vigencia y boletas | Aceptado | 2026-11-01 | Piloto, ítem 35 |
| [0009](0009-cuenta-corriente-y-estado-de-cuenta-del-locador.md) | Cuenta corriente y estado de cuenta del locador | Aceptado; deja la rendición por contrato como histórico de solo lectura | 2026-11-02 | Piloto, ítem 37 |
| [0010](0010-reglas-versionadas-y-valores-por-defecto.md) | Reglas versionadas del contrato y valores por defecto de la inmobiliaria | Aceptado, con dos addenda (numeración de recibos y convenciones de liquidación pactables, 2026-11-01) | 2026-10-31 | Piloto, ítem 34 |
| [0011](0011-ajuste-con-rezago-estimacion-y-correccion.md) | Ajuste con rezago, estimación y corrección | Aceptado | 2026-10-31 | Piloto, ítem 34 |
| [0012](0012-flujos-de-cobro-caja-y-custodia.md) | Flujos de cobro, caja y custodia | Aceptado | 2026-11-02 | Piloto, ítem 36 |
| [0013](0013-mensajeria-saliente-con-outbox-y-cobranza-escalonada.md) | Mensajería saliente con outbox y cobranza escalonada | Aceptado; cubre también la bandeja de consultas entrante (PR 5.3). Las decisiones legales de la cobranza siguen pendientes de revisión por el abogado de la inmobiliaria | 2026-11-03 | Piloto, ítem 43 |
| [0014](0014-ambiente-piloto-con-datos-reales.md) | Ambiente piloto con datos reales | Aceptado | 2026-10-31 | Piloto, ítem 31 |
| [0015](0015-importacion-idempotente-desde-el-sistema-anterior.md) | Importación idempotente desde el sistema anterior | Aceptado | 2026-11-01 | Piloto, ítem 39 |
| [0016](0016-diagramas-como-codigo.md) | Diagramas como código (mermaid) | Aceptado | 2026-10-30 | Piloto, ítem 31 |
| [0017](0017-facturacion-por-cuenta-del-locador-con-emisor-delegado.md) | Facturación por cuenta del locador con emisor delegado | Aceptado | 2026-11-02 | Piloto, ítem 38 |
| [0018](0018-obtencion-automatica-de-boletas.md) | Obtención automática de boletas de servicios e impuestos | Aceptado; los lectores de EPEC y Ecogas quedan a ajustar con la primera boleta real | 2026-11-03 | Piloto, uso real |

La fecha es la de aceptación que figura en cada archivo. El orden de los números no coincide con el de las fechas en el piloto porque los números se reservaron en el plan, antes de implementar, y cada decisión se aceptó en el pedido de incorporación que la implementa.

## Relaciones entre decisiones

- La 0006 endurece la 0003: el filtro por inmobiliaria falla cerrado. Su addendum agrega que todo modelo nuevo se registra en el filtro, con una prueba que compara la lista contra el esquema, y que los procesos programados corren dentro del contexto de cada inmobiliaria.
- La 0009 se apoya en la 0012: la cuenta corriente del locador lee el reparto que el cobro guardó, sin recalcularlo.
- La 0018 se apoya en la 0008 (la boleta que da de alta es la misma `ServiceBill` y sale el mismo reparto) y en la 0013 (el ingreso de boletas por mail reutiliza la firma del ingreso de mails de la bandeja de consultas); su proceso diario corre con el contexto de cada inmobiliaria que fija la 0006.
- La 0017 extiende la facturación con varios emisores de la primera versión a la emisión por cuenta del locador, con su delegación en ARCA.
- La 0008, la 0011 y la 0012 se apoyan en las reglas versionadas de la 0010: las reglas de traslado, el rezago del índice y el flujo de cobro se leen a la fecha del período, y sus cambios son acuerdos fechados.

## Decisiones planificadas

No quedan decisiones planificadas. Las diez que el plan del piloto previó (0007 a 0016) están aceptadas, y la 0017 y la 0018 se sumaron al implementar la facturación por cuenta del locador y la obtención automática de boletas. Una decisión nueva se escribe en el pedido que la implementa y se agrega a esta tabla con su fecha cuando se acepta.

## Ajustes pendientes a decisiones existentes

- ADR-0004: unificar su encabezado con el formato del resto (secciones «Estado» y «Fecha»); hoy los declara como lista al principio del archivo.

## Formato

Cada decisión usa las secciones Estado, Fecha, Contexto, Decisión y Consecuencias. Los estados posibles son Propuesta, Aceptado, Reemplazada y Rechazada.
