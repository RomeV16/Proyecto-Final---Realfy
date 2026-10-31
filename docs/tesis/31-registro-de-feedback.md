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
| Estado | Planificado, En curso, Verificado o Fuera del piloto |

## Regla de entrada

Todo hallazgo recorre el mismo camino:

1. Entra al registro como FB en menos de 24 horas desde que se detecta.
2. Se convierte en un issue con la etiqueta `origen:uso-real` (o `origen:relevamiento`, según corresponda).
3. Se resuelve en un PR que enlaza el issue, con los casos de prueba asignados.
4. Se verifica: los casos de prueba pasan y, si el hallazgo viene del uso, la persona que lo reportó confirma la corrección.
5. Se refleja en una métrica del piloto (tiempo del ciclo, diferencias de reconciliación, valoración, tiempo de detección a corrección).

Un FB que no tiene decisión, ítem y casos de prueba asignados no se considera cerrado. Un FB que se decide no resolver pasa a «Fuera del piloto» con el motivo escrito en la columna de decisión.

## Relevamiento y uso real

El registro distingue dos orígenes y no los mezcla:

- **Relevamiento** (`origen:relevamiento`). Reglas y fricciones que surgen de leer cómo funciona la inmobiliaria hoy: respuestas escritas y archivos del sistema actual. Es información sobre el negocio, previa al uso de Realfy.
- **Uso real** (`origen:uso-real`). Hallazgos de personas que operan con Realfy durante los ciclos en sombra, paralelo y propio. Solo este origen es feedback de uso.

Los FB-01 a FB-28 de esta versión son todos de relevamiento. Todavía no hay feedback de uso real, porque ninguna persona de la inmobiliaria usó el sistema: el primer ciclo en el que eso ocurre es el C2 (ver `30-piloto.md`). Los hallazgos de uso real que sigan se agregan desde FB-29 y se declaran como tales; no se presenta el relevamiento como validación de uso.

## Registro

| FB | Fecha | Fuente | Regla o fricción | Decisión | Ítem (issue) | ADR | CP | Estado |
|---|---|---|---|---|---|---|---|---|
| FB-01 | 2026-10-30 | Respuestas | Locador ≠ propietario: quien tiene potestad para alquilar (titular, usufructuario, sublocador, acreedor); puede haber varios por inmueble y lo que cobra cada uno no coincide con su % de titularidad | Locadores por contrato con % de cobro y vigencia; titularidad separada y opcional | 33 (#91) | ADR-0007 | CP-110–119 | Planificado |
| FB-02 | 2026-10-30 | Respuestas | Apoderados con firma conjunta o indistinta; cotitulares que se apoderan para cobrar | Modelo de poderes con alcance y modalidad de firma | 33 (#91) | ADR-0007 | CP-110–119 | Planificado |
| FB-03 | 2026-10-30 | Respuestas | Tres personas usan el sistema con funciones distintas (dirección, atención y publicación, muestras e inventarios); por ahora todas ven todo | Roles y menú por rol; matriz de lectura configurable aunque hoy sea abierta | 32 (#90) | — | CP-257–265 | Implementado |
| FB-04 | 2026-10-30 | Respuestas | Los contratos no vigentes también se cargan (pueden reingresar); un locador se autoadministra y sólo paga comisión inicial | Importar historial; modalidad "sólo intermediación" | 39 (#97) | ADR-0015 | CP-170–179 | Planificado |
| FB-05 | 2026-10-30 | Respuestas | Prórroga de palabra: el fin real puede diferir del contractual; alertas con semáforo y plan de seguimiento (devolución o renovación) | Fin real opcional, semáforo y checklist; contrato vencido sigue liquidando con alerta (D-3) | 40 (#98) | — | CP-180–189 | Planificado |
| FB-06 | 2026-10-30 | Respuestas | El cobro llega de tres formas (repartido, todo a la inmobiliaria, todo al locador), más efectivo en oficina con recibo y custodia, compensaciones entre locadores y devoluciones parciales | Caja y cuentas, pago en tres flujos, custodia y compensaciones | 36 (#94) | ADR-0012 | CP-140–149 | Planificado |
| FB-07 | 2026-10-30 | Respuestas | Punitorios según contrato, a veces condonados; la comisión se cobra sobre alquiler y punitorios, nunca sobre reparaciones, impuestos o servicios | Línea con destino y marca de comisionable; condonación auditada | 35 (#93) | ADR-0008 | CP-130–139 | Planificado |
| FB-08 | 2026-10-30 | Respuestas | Impuestos y servicios configurables por contrato: los paga el inquilino directo, la inmobiliaria o pasan al locador; por %, por consumo o fijo; anual con descuento o mensual; cambian por acuerdo escrito | Reglas de traslado con vigencia y boletas por período | 35 (#93) | ADR-0008 | CP-130–139 | Planificado |
| FB-09 | 2026-10-30 | Respuestas | Gastos del mes (reparaciones, expensas extraordinarias) se imputan al inquilino o al locador en la próxima liquidación; si superan un umbral de honorarios se pide anticipo; incidencias con preautorización y presupuesto | Centro de carga e incidencias con imputación | 35 (#93), 42 (#100) | — | CP-130–139, CP-200–209 | Planificado |
| FB-10 | 2026-10-30 | Respuestas y relevamiento | El estado de cuenta por locador ("acumulador") se arma a mano en planillas, con atraso y errores de copiado; saldos iniciales editables | Cuenta corriente por locador con saldo arrastrado y estado de cuenta consolidado | 37 (#95) | ADR-0009 | CP-150–159 | Planificado |
| FB-11 | 2026-10-30 | Respuestas | La facturación es por cuenta del locador (delegación en ARCA), nunca a nombre de la inmobiliaria | Emisor delegado por persona | 38 (#96) | — | CP-160–169 | Planificado |
| FB-12 | 2026-10-30 | Respuestas | Honorarios: alta 5% del total del contrato (configurable, quién paga, cuotas), renovación igual, venta 3%/5% por parte, tasación con valor fijo o sin cargo | Honorarios por operación con valores por defecto | 41 (#99) | — | CP-190–199 | Planificado |
| FB-13 | 2026-10-30 | Respuestas | Liquidación unos 10 días antes del mes; el ajuste usa el IPC oficial de dos meses antes; "pago a cuenta" con estimación sólo si el INDEC no publicó; base del ajuste configurable | Ajuste con rezago, estimado y corrección; base original o vigente | 34 (#92) | ADR-0011 | CP-120–129 | Planificado |
| FB-14 | 2026-10-30 | Respuestas | El depósito lo guarda el dueño en la moneda que elija; devolución según acuerdo | Depósito con custodio, moneda y regla de devolución | 40 (#98) | — | CP-180–189 | Planificado |
| FB-15 | 2026-10-30 | Respuestas | Garantes: recibos e informes en cada renovación | Ítems del checklist de renovación | 40 (#98) | — | CP-180–189 | Planificado |
| FB-16 | 2026-10-30 | Respuestas | Pagarés como opción documentada | Documento adjunto opcional del contrato | 40 (#98) | — | — | Planificado |
| FB-17 | 2026-10-30 | Respuestas | Publicación en portales a mano; interés en portal propio y réplica | Estado por portal y aviso para copiar; micrositio como portal propio | 44 (#102) | — | CP-220–229 | Planificado |
| FB-18 | 2026-10-30 | Respuestas | La principal queja de los clientes es la demora en responder; consultas por WhatsApp, teléfono, mail y portales | Bandeja unificada con autorrespuesta y SLA de 15 minutos | 43 (#101) | ADR-0013 | CP-210–219 | Planificado |
| FB-19 | 2026-10-30 | Respuestas | Ventas: reservas, señas y honorarios en un libro; comisiones al personal | Operación de venta y comisiones del personal | 44 (#102), 41 (#99) | — | CP-220–229 | Planificado |
| FB-20 | 2026-10-30 | Respuestas | Las llaves varían por contrato (inmobiliaria, inquilino, dueño) | Registro de llaves y movimientos | 44 (#102) | — | CP-220–229 | Planificado |
| FB-21 | 2026-10-30 | Respuestas | Cobranza: recordatorio a los 5 días de vencido, cada 5 días más firme, prejudicial con carta documento al vencer el siguiente | Cobranza escalonada por outbox | 43 (#101) | ADR-0013 | CP-210–219 | Planificado |
| FB-22 | 2026-10-30 | Respuestas | Detectar duplicados y relaciones a optimizar | Panel de calidad de datos | 39 (#97) | — | CP-170–179 | Planificado |
| FB-23 | 2026-10-29 | Relevamiento | Decenas de ajustes por mes calculados en planilla y tipeados dos veces | Aplicación masiva de ajustes con previsualización | 34 (#92) | ADR-0011 | CP-120–129 | Planificado |
| FB-24 | 2026-10-29 | Relevamiento | El contrato creado desde la web queda en Borrador sin forma de activarlo y la propiedad no pasa a Alquilada | Activación validada desde la ficha (PR 0.2) | 34 (#92) | — | CP-80–84 | En curso |
| FB-25 | 2026-10-29 | Relevamiento | La serie de IPC de la API del INDEC dejó de publicarse después de 2026-07 | IPC desde el CSV del INDEC con BCRA de respaldo y carga manual (PR 0.1) | 34 (#92) | ADR-0011 | CP-51, CP-52 | En curso |
| FB-26 | 2026-10-29 | Relevamiento | No hay pantalla para invitar usuarios, aceptar la invitación ni cambiar o recuperar la contraseña | Gestión de usuarios en la web | 32 (#90) | — | CP-100–109 | Implementado (invitar, aceptar, roles, baja, contraseña) |
| FB-27 | 2026-10-30 | Respuestas | Inventario sólo al ingreso, con fotos y texto; al egreso se coteja | Fuera del piloto: se mantiene como adjunto | — | — | — | Fuera del piloto |
| FB-28 | 2026-10-30 | Respuestas | Custodia de moneda extranjera para algunos locadores | Cuenta de custodia con moneda | 36 (#94) | ADR-0012 | CP-140–149 | Planificado |

Los rangos de CP desde CP-80 están reservados por área de pruebas y se asignan en el PR de cada ítem; hasta entonces los casos están planificados y su resultado esperado se fija antes de ejecutar. CP-51 y CP-52 son casos existentes de `../calidad/05-casos-de-prueba.md`.
