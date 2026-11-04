# Matriz de trazabilidad

La matriz une cada hallazgo del registro (`31-registro-de-feedback.md`) con el caso de uso que modifica o crea, el ítem del cronograma que lo resuelve, la decisión de arquitectura, el endpoint y los casos de prueba que lo verifican. Es el camino de ida y vuelta de la validación en uso real (ver `30-piloto.md`): de una fricción a su prueba, y de una prueba a la fricción que la justifica.

## Cómo leerla

- **CU.** Si el hallazgo cambia un caso de uso existente de `02-roles-y-casos-uso.md`, se cita su identificador (CU-01 a CU-24) como modificado. Si exige un caso de uso que no existe, dice «CU nuevo»: se numera desde CU-25 en el PR del ítem y esta matriz se actualiza en ese mismo PR.
- **Ítem.** Ítem del cronograma (30 a 46) con su issue, que es el número del ítem más 58 (ver `04-backlog.md`).
- **ADR.** Decisión de arquitectura asociada; el estado de cada una está en `../adr/README.md`.
- **PR.** Pedidos de incorporación integrados en `main` que entregan el hallazgo; el mismo número figura en el estado del registro.
- **Endpoint.** Rutas de la API que lo implementan, documentadas en `../api.md`.
- **CP.** Casos de prueba de `../calidad/05-casos-de-prueba.md` que lo verifican. El resultado esperado de cada caso se fija antes de ejecutarlo.

## FB, CU, ítem, PR, ADR, endpoint y CP

| FB | CU | Ítem (issue) | PR | ADR | Endpoint | CP |
|---|---|---|---|---|---|---|
| FB-01 | CU-03, CU-05 (modificados); CU-25, CU-26 (nuevos) | 33 (#91) | #136, #139, #141 | ADR-0007 | `/contracts/:id/lessors`, `/persons/:id/powers`, `/properties/:id/ownerships`, `/persons/:id/bank-accounts` | CP-110 a CP-119, CP-244 a CP-256 |
| FB-02 | CU-03, CU-05 (modificados); CU-25, CU-26 (nuevos) | 33 (#91) | #139, #141 | ADR-0007 | `/contracts/:id/lessors`, `/persons/:id/powers`, `/properties/:id/ownerships` | CP-118, CP-244 a CP-248, CP-253 |
| FB-03 | CU-29 (nuevo) | 32 (#90) | #134, #142 | — | `/tenants/me/read-policy`, `/tenants/me/read-access` | CP-257 a CP-265 |
| FB-04 | CU-05 (modificado); CU-34 (nuevo) | 39 (#97) | #155 | ADR-0015 | `/import/batches`, `/import/batches/:id/rows` | CP-170 a CP-179 |
| FB-05 | CU-06 (modificado); CU-38, CU-39 (nuevos) | 40 (#98) | #150, #166 | — | `/follow-ups`, `/contracts/:id/oral-extension`, `/contracts/:id/renew`, `/contracts/:id/periods/:seq/addendum` | CP-126, CP-127, CP-481 a CP-492, CP-806 a CP-816 |
| FB-06 | CU-10 (modificado); CU-31 (nuevo) | 36 (#94) | #161, #177 | ADR-0012 | `/liquidaciones/:id/payments`, `/financial-accounts`, `/cash-movements`, `/cash-movements/conversion`, `/compensations`, `/receipts`, `/charges/:id/agency-expense` | CP-398 a CP-413; CP-660 a CP-662 y CP-668 (reconciliación) |
| FB-07 | CU-09, CU-11, CU-12 (modificados) | 35 (#93) | #133, #151, #158 | ADR-0008 | `/liquidaciones/generate`, `/penalties`, `/penalties/:id/waive`, `/contracts/:id/penalties/waive-all`, `/penalties/preview`, `/tenants/me/penalty-config` | CP-138, CP-303 a CP-322, CP-360 a CP-371 |
| FB-08 | CU-09 (modificado); CU-33 (nuevo) | 35 (#93) | #156 | ADR-0008 | `/service-bills`, `/service-bills/bulk`, `/service-bills/sheet`, `/service-bills/:id/allocations`, `/contracts/:id/charge-rules` | CP-341 a CP-359 |
| FB-09 | CU-16, CU-17, CU-18 (modificados); CU-30, CU-40 (nuevos) | 35 (#93), 42 (#100) | #159, #167 | — | `/charges`, `/charges/bulk`, `/charges/:id/release`, `/charges/:id/cancel`, `/charges/:id/agency-expense`; con el ítem 42, `/tickets/:id/estimate`, `/preauthorize`, `/quotes`, `/provider-payments` e `/impute` | CP-380 a CP-397, CP-500 a CP-524 |
| FB-10 | CU-13 (retirado: rendición histórica); CU-35 (nuevo); CU-44 (nuevo: envío del estado de cuenta) | 37 (#95), 43 (#101) | #165, #172 | ADR-0009, ADR-0013 | `/owners/balances`, `/owners/:personId/ledger`, `/owners/:personId/opening-balance`, `/owners/:personId/payouts`, `/owner-statements/generate`, `/owner-statements`, `/owner-statements/:id`, `/owner-statements/:id/pdf`, `/owner-statements/:id/issue`, `/owner-statements/:id/annul`; `/renditions` solo lectura; `/outbox/send` | CP-450 a CP-480, CP-630 a CP-653 |
| FB-11 | CU-14 (modificado); CU-43 (nuevo) | 38 (#96) | #125, #170 | ADR-0017 | `/persons/:id/invoicing-settings`, `/persons/:id/invoicing-issuer`, `/payments/:id/invoices`, `/owner-statements/:id/invoices`, `/invoices/pending`, `/invoices/pending/run`; `/invoices` con `personId`, `source` y `ownerStatementId` | CP-160 a CP-163, CP-600 a CP-609 |
| FB-12 | CU-37 (modificado: valores por defecto de los honorarios); CU-41 (nuevo) | 41 (#99) | #168 | — | `/fees/preview`, `/fees`, `/fees/installments`, `/fees/:id`, `/fees/:id/cancel`, `/fees/:id/installments/:n/pay`, `/fees/:id/shares`, `/fees/:id/staff-commissions`, `/staff-commissions`, `/staff-commissions/:id/pay`; `/receipts` y `/invoices/emit` con la cuota de honorario | CP-530 a CP-552 |
| FB-13 | CU-07, CU-08, CU-09 (modificados) | 34 (#92) | #150, #153 | ADR-0011 | `/contracts/:id/terms`, `/contracts/:id/agreements`, `/contracts/:id/adjustments/calculate`, `/contracts/:id/adjustments/:adjId/apply`, `/index-data/estimates-replaced` | CP-120 a CP-129, CP-273 a CP-302 |
| FB-14 | CU-42 (nuevo) | 40 (#98) | #169 | — | `/contracts/:id/deposit`, `/contracts/:id/deposit/installments/:number/collect`, `/contracts/:id/move-out`, `/contracts/:id/move-out/preview`, `/move-outs/:id`, `/move-outs/:id/confirm`, `/move-outs/:id/pdf` | CP-560 a CP-584 |
| FB-15 | CU-06 (modificado); CU-39 (nuevo) | 40 (#98) | #166 | — | `/contracts/:id/renew` (garantes que reafirman) | CP-482 |
| FB-16 | CU-05 (modificación planificada, no entregada) | 40 (#98) | — | — | — | — |
| FB-17 | CU-45 (nuevo) | 44 (#102) | #178 | — | `/properties/:id/listings`, `/properties/:id/ad-copy`, `/listings/overview`, `/listings/pause-unavailable`, `/listings/portals`; `/public/:slug/properties` con zona y precio, `/public/:slug/sitemap` y la consulta con señuelo | CP-720 a CP-729 |
| FB-18 | CU-19 (modificado); CU-44 (bandeja de salida y mensajes entrantes); CU-49 (nuevo: atender las consultas de la bandeja) | 43 (#101) | #172, #183 | ADR-0013 | `/webhooks/whatsapp` (entrantes), `/inbox/email-ingest`, `/conversations`, `/conversations/summary`, `/conversations/settings`, `/conversations/calls`, `/conversations/:id`, `/conversations/:id/read`, `/conversations/:id/reply`, `/conversations/:id/assignee`, `/conversations/:id/status`, `/conversations/:id/links`; la consulta del micrositio abre una consulta Web | CP-635, CP-643, CP-770 a CP-783 |
| FB-19 | CU-41 (nuevo: honorarios de venta y comisiones del personal); CU-46 (nuevo: la operación de venta) | 44 (#102), 41 (#99) | #168, #180 | — | `/fees` (venta por parte), `/staff-commissions`, `/staff-commissions/:id/pay`; `/sales-operations`, `/sales-operations/:id`, `/sales-operations/:id/transition`, `/sales-operations/:id/parties`, `/sales-operations/:id/docs/:code`, `/sales-operations/:id/deposits` (y `/receive`, `/refund`, `/forfeit`), `/sales-operations/deposits/pending`, `/sales-operations/:id/fee-proposal`, `/sales-operations/:id/fee`, `/properties/:id/sales-operations` | CP-533, CP-543; CP-700 a CP-714, CP-718, CP-719, CP-800, CP-802, CP-803 |
| FB-20 | CU-47 (nuevo: las llaves de una propiedad) | 44 (#102) | #180 | — | `/properties/:id/keys`, `/keys/:id`, `/keys/:id/check-out`, `/keys/:id/check-in`, `/keys/out` | CP-715 a CP-717, CP-801, CP-804 |
| FB-21 | CU-44 (bandeja de salida, base de la cobranza); CU-48 (nuevo: cobranza escalonada) | 43 (#101) | #172, #181 | ADR-0013 | `/outbox`, `/outbox/:id/retry`, `/outbox/:id/cancel`, `/persons/:id/consents`; `/collection-cases`, `/collection-cases/:id`, `/collection-cases/:id/notes`, `/collection-cases/:id/agreement`, `/collection-cases/:id/actions/:actionId`, `/collection-cases/:id/actions/:actionId/letter.pdf`, `/collection-cases/:id/actions/:actionId/sent`, `/collection-cases/:id/derive`, `/collection-cases/:id/judicial`, `/collection-cases/:id/close` | CP-630 a CP-653; CP-740 a CP-762 |
| FB-22 | CU-36 (nuevo) | 39 (#97) | #160 | — | `/data-quality`, `/data-quality/:check`, `/data-quality/persons/merge` | CP-430 a CP-440 |
| FB-23 | CU-08 (modificado) | 34 (#92) | #153 | ADR-0011 | `/adjustments/preview-batch`, `/adjustments/apply-batch`, `/adjustments/_run-now` | CP-273 a CP-302 |
| FB-24 | CU-05 (modificado) | 34 (#92) | #112 | — | `/contracts/:id/activate` | CP-80 a CP-84 |
| FB-25 | CU-07, CU-08 (modificados) | 34 (#92) | #109 | ADR-0011 | `/index-data`, `/index-data/refresh`, `/index-data/latest` | CP-51, CP-52 |
| FB-26 | CU-27, CU-28 (nuevos); CU-44 (invitación por la bandeja de salida) | 32 (#90), 43 (#101) | #140, #172 | — | `/users`, `/users/invite`, `/users/accept-invitation`, `/users/:id`, `/users/:id/deactivate`, `/users/:id/reactivate`, `/users/:id/invitation/resend`, `/users/:id/password-reset-link`, `/auth/change-password`, `/auth/password-reset/request`, `/auth/password-reset/confirm` | CP-100 a CP-109, CP-644 |
| FB-27 | — (fuera de alcance: se mantiene como adjunto) | — | — | — | — | — |
| FB-28 | CU-31 (nuevo) | 36 (#94) | #161 | ADR-0012 | `/financial-accounts`, `/custody/:accountId/deliver`, `/liquidaciones/:id/payments` (`inCustody`) | CP-398 a CP-413 |

## Requisitos del informe externo: RF-12, RF-13 y RF-14

El informe externo de calidad numera tres requisitos funcionales sobre el módulo de índices y ajustes (`../calidad/02-plan-de-pruebas.md`). Son anteriores al piloto y se conservan con su numeración; esta tabla los conecta con los ítems, el caso de uso y los casos de prueba.

| RF | Requisito | Issue | CU | Ítem del cronograma | CP (de `../calidad/05-casos-de-prueba.md`) |
|---|---|---|---|---|---|
| RF-12 | Cronograma y cálculo del ajuste según cinco modalidades | #73 | CU-07, CU-08 | 12 (original); 34 (reglas y ajustes con rezago) | CP-01 a CP-17, CP-40 a CP-49, CP-54 a CP-58 |
| RF-13 | Conservar los valores de índice usados en cada ajuste | #74 | CU-08 | 12 (original); 34 | CP-13, CP-14, CP-45, CP-57, CP-58 |
| RF-14 | Obtención automática de índices y carga manual | #75 | CU-07 | 12 (original); 34 | CP-18 a CP-34, CP-46 a CP-54 |

Los casos CP-49 a CP-58 son los que cierran los tres requisitos en la versión actual del catálogo: CP-49 pertenece a las pruebas de integración de la API de índices (CRUD, `latest`, `refresh`, permisos, aislamiento y previsualización, CP-40 a CP-49); CP-50 a CP-52 verifican el contrato con las fuentes externas (BCRA e INDEC) con respuestas grabadas y contra el entorno real; CP-53 y CP-54 cubren la obtención automática y el cálculo con lo obtenido; CP-55 a CP-58 cubren los defectos de encadenamiento de ajustes (DEF-07 y DEF-08).

Dentro del piloto, el ítem 34 extiende esos requisitos sin reemplazarlos: el rezago de dos meses del índice, la base del ajuste (original o vigente), la aplicación masiva con previsualización, el estimado con corrección posterior y la fuente alternativa de índices (FB-13, FB-23 y FB-25). Los casos nuevos se numeran en el rango CP-120 a CP-129 y no modifican los resultados esperados de los casos existentes.

## Reconciliación del ciclo y defectos que encontró

La suite de reconciliación del ítem 45 (#103) verifica el objetivo específico 2 del piloto (`30-piloto.md`) con datos sintéticos: el caso de caracterización y su prueba por la API (CP-660 a CP-668, `../calidad/12-piloto.md`, sección 9). Cada defecto que encontró queda unido a su caso, a la operación que corrige y al hallazgo que dio origen a esa operación.

| Defecto | Operación (FB, ítem) | Endpoint | Caso que lo detecta | Regresión |
|---|---|---|---|---|
| DEF-70 | Reparto del cobro con descuentos (FB-06 y FB-10; ítems 36 y 37) | `/liquidaciones/:id/payments` | CP-663 | CP-660 |
| DEF-71 | Compensación entre locadores (FB-06; ítem 36) | `/compensations` | CP-663 | CP-661 |
| DEF-72 | Compensación en el estado de cuenta (FB-10; ítem 37) | `/compensations` (`date`) | CP-667 | CP-662 |
| DEF-73 | Cobro del primer mes de un contrato nuevo (FB-06; ítem 36) | `/liquidaciones/:id/payments`, `/compensations` | CP-666 | CP-668 |

## Migración y obtención automática de boletas

Los pedidos de la oleada 6 no nacen de un hallazgo nuevo del relevamiento sino de completar lo que los hallazgos FB-04 (importar la cartera) y FB-08 (impuestos y servicios con reglas de traslado) ya exigían. La tabla los une con su caso de uso, la decisión y los casos de prueba; el estado de cada paso de la migración está en `32-migracion.md`.

| Operación | FB de origen | CU | ADR | PR | Endpoint | CP |
|---|---|---|---|---|---|---|
| Servicios y reglas de traslado en el lote de importación (M8) | FB-04, FB-08 | CU-34 (modificado) | ADR-0015, ADR-0008 | #187 | `/import/batches` con `services[]` y `chargeRules[]` | CP-817 a CP-822 |
| Proveedor y cuenta normalizada del servicio | FB-08 | CU-34 (modificado); CU-50 | ADR-0018 | #227 | `/import/batches` (`providerKey`), `/services` | CP-1320 a CP-1328 |
| Formulario web de servicios e impuestos de la propiedad | FB-08 | CU-33 (modificado) | ADR-0018 | #231 | `/services`, `/services/:id` (reactivar con `isActive`) | CP-1370 a CP-1382 |
| Consumo por unidad en la carga de boletas y vista previa del reparto | FB-08 | CU-33 (modificado) | ADR-0008 | #198 | `/service-bills/preview`, `/service-bills/sheet`, `/service-bills/bulk` | CP-1130 a CP-1152 |
| Obtención automática de boletas: catálogo, lectores, circuito, archivo, mail y consulta | FB-08 | CU-50 (nuevo) | ADR-0018 | #193 | `/bills-intake/documents`, `/bills-intake/documents/:id`, `/bills-intake/documents/:id/accept`, `/bills-intake/documents/:id/reject`, `/bills-intake/email-ingest` | CP-1000 a CP-1015 |
| Pantalla de boletas recibidas y configuración de la obtención automática | FB-08 | CU-50 | ADR-0018 | #229 | los de `/bills-intake`; valores por defecto (`billFetching`) | CP-1340 a CP-1369 |
| Boletas por mail de remitentes automáticos | FB-08, FB-18 | CU-50 | ADR-0018 | #236 | `/bills-intake/email-ingest` | CP-1430 a CP-1435 |

## Ensayo general del primer ciclo y defectos que encontró

Los dos ensayos generales sobre una copia de la cartera (`../calidad/12-piloto.md`, sección 10) verifican, con datos reales y fuera del repositorio, el mismo objetivo que la suite sintética. Cada problema que encontraron queda unido al hallazgo cuya regla rompía, a la operación que corrige y a los casos que lo cubren. Los defectos de la tabla están en `../calidad/06-registro-de-defectos.md`; los de E1 y E2 (DEF-173 a DEF-176) se registran con su pedido, abierto al 4/11.

| Problema | Defecto | Operación (FB, ítem) | Endpoint | CP |
|---|---|---|---|---|
| D1: aplicar un ajuste no ve los índices de sistema | DEF-115 | Aplicación de ajustes (FB-13 y FB-23; ítem 34) | `/adjustments/apply-batch`, `/adjustments/_run-now` | CP-1200 a CP-1204 |
| D2: ICL y UVA con la serie incompleta, y sin carga del histórico | DEF-120, DEF-121 | Índices y ajuste (FB-13 y FB-25; ítem 34) | `/adjustments/preview-batch`, `/index-data/backfill` | CP-1220 a CP-1236 |
| D3, D4 y D9: el importador desalinea el cronograma de ajustes | DEF-125 a DEF-129 | Importación del historial de ajustes (FB-04; ítem 39) | `/import/batches` | CP-1240 a CP-1257 |
| D5: la generación del mes no incluye el ajuste que rige desde el día 1 | DEF-130 a DEF-134 | Generación anticipada y ajuste (FB-07 y FB-13; ítem 35) | `/liquidaciones/generate`, aprobación de la liquidación | CP-1260 a CP-1272 |
| D6, D7 y D8: prórroga de palabra, lote por contrato y ventana del primer ajuste | DEF-135 a DEF-137 | Prórroga y aplicación masiva (FB-05 y FB-23; ítems 34 y 40) | `/contracts/:id/oral-extension`, `/adjustments/apply-batch` | CP-1280 a CP-1288 |
| D10 y D11: avisos de boleta en otra moneda, alquiler cero, consumo faltante y ajuste sin porcentaje | DEF-140 a DEF-143 | Boletas, liquidación e importación (FB-08 y FB-04; ítems 35 y 39) | `/service-bills/bulk`, `/service-bills/unbilled`, `/liquidaciones/generate`, `/import/batches` | CP-1300 a CP-1313 |
| E1 y E2: prórroga sin historial y ajuste que baja el alquiler | DEF-173 a DEF-176 | Prórroga y ajuste (FB-05 y FB-13; ítems 34 y 40) | `/contracts/:id/oral-extension`, `/adjustments/preview-batch` | En el pedido #242 |

Fuera del ensayo, el defecto DEF-105 a DEF-107 salió de verificar de punta a punta el reparto por consumo (CP-1130 a CP-1152), y el DEF-170 y el DEF-171, de preparar la recepción de mails (CP-1430 a CP-1435).
