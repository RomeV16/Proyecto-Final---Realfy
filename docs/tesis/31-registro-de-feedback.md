# Registro de feedback

Este documento es el registro de hallazgos del piloto (ver `30-piloto.md`). Cada hallazgo, ya sea una regla de negocio que el sistema no respeta o una fricción de uso, entra como una fila con identificador `FB-nn`. El registro es la entrada de la trazabilidad: de cada FB se llega a casos de uso, ítem, decisión de arquitectura y casos de prueba en `33-matriz-de-trazabilidad.md`.

## Campos

| Campo | Contenido |
|---|---|
| FB | Identificador correlativo, que no se reutiliza |
| Fecha | Fecha en que el hallazgo entró al registro |
| Fuente | De dónde viene: respuestas escritas de la inmobiliaria o relevamiento de sus archivos; desde el primer ciclo, el uso real |
| Regla o fricción | Qué regla del negocio o qué dificultad se observó, en términos del dominio |
| Decisión | Qué se decidió hacer, aunque sea no hacer nada |
| Ítem (issue) | Ítem del cronograma que lo resuelve, con su issue |
| ADR | Decisión de arquitectura asociada, si la hay |
| CP | Casos de prueba que lo verifican, con el resultado esperado fijado antes de ejecutar |
| Estado | Planificado (ningún PR lo entregó todavía), Implementado (#PR) cuando un PR integrado en `main` lo entrega, Verificado cuando además se confirmó en el uso real, o Fuera de alcance |

## Regla de entrada

Todo hallazgo recorre el mismo camino:

1. Entra al registro como FB en menos de 24 horas desde que se detecta.
2. Se convierte en un issue con la etiqueta `origen:uso-real` (o `origen:relevamiento`, según corresponda).
3. Se resuelve en un PR que enlaza el issue, con los casos de prueba asignados.
4. Se verifica: los casos de prueba pasan y, si el hallazgo viene del uso, la persona que lo reportó confirma la corrección.
5. Se refleja en una métrica del piloto (tiempo del ciclo, diferencias de reconciliación, valoración, tiempo de detección a corrección).

Un FB que no tiene decisión, ítem y casos de prueba asignados no se considera cerrado. Un FB que se decide no resolver pasa a «Fuera de alcance» con el motivo escrito en la columna de decisión.

## Relevamiento y uso real

El registro distingue dos orígenes y no los mezcla:

- **Relevamiento** (`origen:relevamiento`). Reglas y fricciones que surgen de leer cómo funciona la inmobiliaria hoy: respuestas escritas y archivos del sistema actual. Es información sobre el negocio, previa al uso de Realfy.
- **Uso real** (`origen:uso-real`). Hallazgos de personas que operan con Realfy durante los ciclos en sombra, paralelo y propio. Solo este origen es feedback de uso.

Los FB-01 a FB-28 de esta versión son todos de relevamiento. Todavía no hay feedback de uso real, porque ninguna persona de la inmobiliaria usó el sistema: el primer ciclo en el que eso ocurre es el C2 (ver `30-piloto.md`). Los hallazgos de uso real que sigan se agregan desde FB-29 y se declaran como tales; no se presenta el relevamiento como validación de uso.

## Registro

| FB | Fecha | Fuente | Regla o fricción | Decisión | Ítem (issue) | ADR | CP | Estado |
|---|---|---|---|---|---|---|---|---|
| FB-01 | 2026-10-30 | Respuestas | Locador ≠ propietario: quien tiene potestad para alquilar (titular, usufructuario, sublocador, acreedor); puede haber varios por inmueble y lo que cobra cada uno no coincide con su % de titularidad | Locadores por contrato con % de cobro y vigencia; titularidad separada y opcional | 33 (#91) | ADR-0007 | CP-110–119, CP-244–256 | Implementado (#136, #139, #141) |
| FB-02 | 2026-10-30 | Respuestas | Apoderados con firma conjunta o indistinta; cotitulares que se apoderan para cobrar | Modelo de poderes con alcance y modalidad de firma | 33 (#91) | ADR-0007 | CP-118, CP-244–248, CP-253 | Implementado (#139, #141) |
| FB-03 | 2026-10-30 | Respuestas | Tres personas usan el sistema con funciones distintas (dirección, atención y publicación, muestras e inventarios); por ahora todas ven todo | Roles y menú por rol; matriz de lectura configurable aunque hoy sea abierta | 32 (#90) | — | CP-257–265 | Implementado (#134, #142) |
| FB-04 | 2026-10-30 | Respuestas | Los contratos no vigentes también se cargan (pueden reingresar); un locador se autoadministra y sólo paga comisión inicial | Importar historial; modalidad "sólo intermediación" | 39 (#97) | ADR-0015 | CP-170–179 | Implementado (#155): historial de contratos no vigentes y contrato autoadministrado con solo comisión inicial |
| FB-05 | 2026-10-30 | Respuestas | Prórroga de palabra: el fin real puede diferir del contractual; alertas con semáforo y plan de seguimiento (devolución o renovación) | Fin real opcional, semáforo y checklist; contrato vencido sigue liquidando con alerta (D-3) | 40 (#98) | — | CP-126, CP-127, CP-481–492, CP-806–816 | Implementado (#150, #166) |
| FB-06 | 2026-10-30 | Respuestas | El cobro llega de tres formas (repartido, todo a la inmobiliaria, todo al locador), más efectivo en oficina con recibo y custodia, compensaciones entre locadores y devoluciones parciales | Caja y cuentas, pago en tres flujos, custodia y compensaciones | 36 (#94) | ADR-0012 | CP-398–413, CP-660–662, CP-668 | Implementado (#161; DEF-70, DEF-71 y DEF-73 corregidos en #177) |
| FB-07 | 2026-10-30 | Respuestas | Punitorios según contrato, a veces condonados; la comisión se cobra sobre alquiler y punitorios, nunca sobre reparaciones, impuestos o servicios | Línea con destino y marca de comisionable; condonación auditada | 35 (#93) | ADR-0008 | CP-138, CP-303–322, CP-360–371 | Implementado (#151, #158; punitorio sobre saldo en #133) |
| FB-08 | 2026-10-30 | Respuestas | Impuestos y servicios configurables por contrato: los paga el inquilino directo, la inmobiliaria o pasan al locador; por %, por consumo o fijo; anual con descuento o mensual; cambian por acuerdo escrito | Reglas de traslado con vigencia y boletas por período | 35 (#93) | ADR-0008 | CP-341–359 | Implementado (#156) |
| FB-09 | 2026-10-30 | Respuestas | Gastos del mes (reparaciones, expensas extraordinarias) se imputan al inquilino o al locador en la próxima liquidación; si superan un umbral de honorarios se pide anticipo; incidencias con preautorización y presupuesto | Centro de carga e incidencias con imputación | 35 (#93), 42 (#100) | — | CP-380–397, CP-500–524 | Implementado (#159 centro de carga, #167 incidencias) |
| FB-10 | 2026-10-30 | Respuestas y relevamiento | El estado de cuenta por locador ("acumulador") se arma a mano en planillas, con atraso y errores de copiado; saldos iniciales editables | Cuenta corriente por locador con saldo arrastrado, saldo inicial editable y auditado, y estado de cuenta mensual consolidado con PDF (CU-35); envío del estado emitido por mail o WhatsApp desde la bandeja de salida (CU-44) | 37 (#95), 43 (#101) | ADR-0009, ADR-0013 | CP-450–480, CP-630–653 | Implementado (#165; envío por la bandeja de salida en #172, sin credenciales de correo ni WhatsApp en el piloto) |
| FB-11 | 2026-10-30 | Respuestas | La facturación es por cuenta del locador (delegación en ARCA), nunca a nombre de la inmobiliaria | Emisor delegado por persona; factura del alquiler por cuenta del locador con qué, cuándo y cuánto configurables (CU-43) | 38 (#96) | ADR-0017 | CP-160–163, CP-600–609 | Implementado (#125, #170); la validación fiscal con el contador sigue abierta |
| FB-12 | 2026-10-30 | Respuestas | Honorarios: alta 5% del total del contrato (configurable, quién paga, cuotas), renovación igual, venta 3%/5% por parte, tasación con valor fijo o sin cargo | Honorarios por operación con valores por defecto: un honorario por persona que paga, cuotas que siguen los ajustes del alquiler, cobro a caja con recibo o descontado de la cuenta del locador, coorretaje (CU-41) | 41 (#99) | — | CP-530–552 | Implementado (#168) |
| FB-13 | 2026-10-30 | Respuestas | Liquidación unos 10 días antes del mes; el ajuste usa el IPC oficial de dos meses antes; "pago a cuenta" con estimación sólo si el INDEC no publicó; base del ajuste configurable | Ajuste con rezago, estimado y corrección; base original o vigente | 34 (#92) | ADR-0011 | CP-120–129, CP-273–302 | Implementado (#150, #153) |
| FB-14 | 2026-10-30 | Respuestas | El depósito lo guarda el dueño en la moneda que elija; devolución según acuerdo | Depósito con custodio, moneda y regla de devolución, y liquidación de egreso | 40 (#98) | — | CP-560–584 | Implementado (#169) |
| FB-15 | 2026-10-30 | Respuestas | Garantes: recibos e informes en cada renovación | Ítems del checklist de renovación | 40 (#98) | — | CP-482 | Implementado (#166) |
| FB-16 | 2026-10-30 | Respuestas | Pagarés como opción documentada | Documento adjunto opcional del contrato | 40 (#98) | — | — | Planificado: ningún PR lo entregó todavía |
| FB-17 | 2026-10-30 | Respuestas | Publicación en portales a mano; interés en portal propio y réplica | Estado del aviso por portal en la ficha, aviso para copiar por plantillas y micrositio como portal propio con dominio, filtros, SEO y consulta con señuelo (CU-45); ningún portal externo se integra: no se confirmó una interfaz | 44 (#102) | — | CP-720–729 | Implementado (#178); el dominio propio y la consulta a los portales sobre una interfaz siguen pendientes |
| FB-18 | 2026-10-30 | Respuestas | La principal queja de los clientes es la demora en responder; consultas por WhatsApp, teléfono, mail y portales | Bandeja unificada con autorrespuesta y SLA de 15 minutos | 43 (#101) | ADR-0013 | CP-635, CP-643, CP-770–783 | Implementado (#172 mensajes entrantes, #183 bandeja de consultas); falta armar el reenvío de la casilla de mails, ver despliegue |
| FB-19 | 2026-10-30 | Respuestas | Ventas: reservas, señas y honorarios en un libro; comisiones al personal | Operación de venta y comisiones del personal | 44 (#102), 41 (#99) | — | CP-533, CP-543, CP-700–714, CP-718, CP-719, CP-800, CP-802, CP-803 | Implementado (#168 honorarios de venta y comisiones del personal, #180 operación de venta); las reglas de pérdida y devolución de la seña quedan como preguntas para el abogado |
| FB-20 | 2026-10-30 | Respuestas | Las llaves varían por contrato (inmobiliaria, inquilino, dueño) | Registro de llaves y movimientos | 44 (#102) | — | CP-715–717, CP-801, CP-804 | Implementado (#180) |
| FB-21 | 2026-10-30 | Respuestas | Cobranza: recordatorio a los 5 días de vencido, cada 5 días más firme, prejudicial con carta documento al vencer el siguiente | Cobranza escalonada por outbox: caso por contrato, recordatorios a los 5, 10 y 15 días con el importe exacto de hoy, carta documento como borrador que una persona confirma y derivación a un abogado manual (CU-48) | 43 (#101) | ADR-0013 | CP-630–653, CP-740–762 | Implementado (#181, sobre la bandeja de salida de #172), apagado de fábrica; el contenido de la carta documento y el plazo quedan pendientes de revisión del abogado |
| FB-22 | 2026-10-30 | Respuestas | Detectar duplicados y relaciones a optimizar | Panel de calidad de datos | 39 (#97) | — | CP-430–440 | Implementado (#160) |
| FB-23 | 2026-10-29 | Relevamiento | Decenas de ajustes por mes calculados en planilla y tipeados dos veces | Aplicación masiva de ajustes con previsualización | 34 (#92) | ADR-0011 | CP-273–302 | Implementado (#153) |
| FB-24 | 2026-10-29 | Relevamiento | El contrato creado desde la web queda en Borrador sin forma de activarlo y la propiedad no pasa a Alquilada | Activación validada desde la ficha (PR 0.2) | 34 (#92) | — | CP-80–84 | Implementado (#112) |
| FB-25 | 2026-10-29 | Relevamiento | La serie de IPC de la API del INDEC dejó de publicarse después de 2026-07 | IPC desde el CSV del INDEC con BCRA de respaldo y carga manual (PR 0.1) | 34 (#92) | ADR-0011 | CP-51, CP-52 | Implementado (#109) |
| FB-26 | 2026-10-29 | Relevamiento | No hay pantalla para invitar usuarios, aceptar la invitación ni cambiar o recuperar la contraseña | Gestión de usuarios en la web; la invitación sale por mail desde la bandeja de salida cuando hay correo configurado (CU-44) | 32 (#90), 43 (#101) | ADR-0013 | CP-100–109, CP-644 | Implementado (#140; invitación por mail en #172, sin dominio de correo en el piloto) |
| FB-27 | 2026-10-30 | Respuestas | Inventario sólo al ingreso, con fotos y texto; al egreso se coteja | Fuera del piloto: se mantiene como adjunto | — | — | — | Fuera de alcance |
| FB-28 | 2026-10-30 | Respuestas | Custodia de moneda extranjera para algunos locadores | Cuenta de custodia con moneda | 36 (#94) | ADR-0012 | CP-398–413 | Implementado (#161) |

Los estados reflejan los PR integrados en `main` hasta el #185 (3 de noviembre de 2026): veintiséis hallazgos están implementados, uno sigue planificado (FB-16) y uno quedó fuera de alcance (FB-27). Ninguno está verificado en el sentido de la regla de entrada, porque la confirmación de quien lo reportó llega con el uso real, desde el C2. Todos los casos de prueba citados existen en `../calidad/05-casos-de-prueba.md`; el PR de cada hallazgo, con su caso de uso y su endpoint, está en `33-matriz-de-trazabilidad.md`.
