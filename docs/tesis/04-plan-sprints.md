# Plan de Sprints

El desarrollo se organiza en sprints quincenales entre mayo y noviembre de 2026, y desde el piloto en una inmobiliaria real se extiende hasta febrero de 2027 con los sprints S17 a S22 (ver «Fases del piloto»). La cadencia de dos semanas se elige por la disponibilidad parcial de los tres tesistas y por la necesidad de tener cierres frecuentes para validar entregables con el director de tesis.

Los sprints se solapan parcialmente con los ítems del Gantt: un sprint puede arrancar mientras otro está pasando por su ventana de control de calidad, y un mismo ítem del Gantt puede atravesar dos sprints si su ventana en el cronograma así lo dispone. Cuando un sprint coincide con un hito, su revisión final se extiende para producir los artefactos del hito.

## Hitos de referencia

- **Hito 1**: 15/05/2026. Aprobación de planificación: alcance, casos de uso, modelo de datos, arquitectura, backlog y plan de sprints.
- **Hito 2**: 14/08/2026. MVP operativo demostrable con flujo end-to-end (alta de propiedad, contrato, liquidación, pago, comprobante).
- **Hito 3**: 30/10/2026. Plataforma completa con portal del inquilino, CRM, ARCA, dashboard y notificaciones.
- **Hito 4**: 30/11/2026. Entrega final con pruebas integrales, documentación y defensa preparada. Desde el piloto incluye además el capítulo de validación en campo con el relevamiento, el plan, la línea base y el primer ciclo en sombra (ver `hito-04.md`, reabierto el 2 de noviembre de 2026).
- **Anexo de validación en campo**: se actualiza después del C2 (≈ 20/12/2026) y del C3 (≈ 20/01/2027), sin reescribir lo entregado el 30/11.
- **Defensa**: febrero de 2027. Si el C4 (≈ 20/02/2027) cae después, su resultado se informa como cierre posterior del piloto.

## Detalle por sprint

### S1: 04/05/2026 a 15/05/2026

- Ítems del Gantt: 05 (configuración de repositorio y CI), inicio de 06 (auth) y 07 (multi-tenant base).
- Foco paralelo: redacción de los documentos de planificación (alcance, casos de uso, modelo de datos, arquitectura, backlog).
- Hito 1 cierra al final de este sprint.

### S2: 18/05/2026 a 29/05/2026

- Ítems: cierre de 06 (auth con invitaciones), cierre de 07 (auditoría y logging), 08 (UI base y dashboard inicial).
- Entregable: usuarios pueden iniciar sesión, navegar el shell y ver un dashboard placeholder por tenant.

### S3: 01/06/2026 a 12/06/2026

- Ítems: 09 (propiedades y media), 10 (personas y roles).
- Entregable: CRUD funcional de propiedades y personas con auditoría operativa.

### S4: 15/06/2026 a 26/06/2026

- Ítems: 11 (contratos y plantillas), inicio de 12 (ajustes IPC/UVA/manual).
- Entregable: alta y renovación de contratos con generación del documento.

### S5: 29/06/2026 a 10/07/2026

- Ítems: cierre de 12 (índices y aplicación de ajustes), 13 (liquidaciones con líneas).
- Entregable: liquidaciones mensuales calculadas con el último ajuste aplicado.

### S6: 13/07/2026 a 24/07/2026

- Ítems: 14 (pagos y deuda), inicio de 15 (punitorios).
- Entregable: registro de pagos con actualización de saldo y morosidad.

### S7: 27/07/2026 a 07/08/2026

- Ítems: cierre de 15 (derivación legal), 16 (tickets y proveedores), inicio de 21 (ARCA configuración y conexión a homologación).
- Entregable: tickets de mantenimiento operativos y emisión de comprobantes ARCA en homologación.

### S8: 10/08/2026 a 14/08/2026

- Ítems: cierre de 21 (emisión y notas de crédito), pulido del flujo end-to-end MVP.
- Entregable de hito: Hito 2. Demo completa del ciclo alta de propiedad, contrato, liquidación, pago y comprobante.

### S9: 17/08/2026 a 28/08/2026

- Ítems: 17 (portal del inquilino), 18 (notificaciones por email).
- Entregable: inquilinos consultan su saldo, descargan comprobantes y abren tickets desde el portal.

### S10: 31/08/2026 a 11/09/2026

- Ítems: 19 (CRM y pipeline), inicio de 20 (portal público).
- Entregable: gestión de leads con pipeline configurable y captación de contactos.

### S11: 14/09/2026 a 25/09/2026

- Ítems: cierre de 20 (portal público con branding), 22 (scoring y tasaciones).
- Entregable: cada inmobiliaria tiene su portal público con propiedades disponibles y formulario que crea leads.

### S12: 28/09/2026 a 09/10/2026

- Ítems: 23 (importación y exportación masiva), 24 (dashboard de KPIs).
- Entregable: importación masiva con validación previa y dashboard con ocupación, cobranza, mora y flujo de caja.

### S13: 12/10/2026 a 23/10/2026

- Ítems: 25 (panel diario con IA), 26 (resumen de cierre con IA).
- Entregable: componentes de IA operativos sobre los datos reales del tenant.

### S14: 26/10/2026 a 30/10/2026

- Ítems: pulido cruzado de portal, CRM, ARCA y notificaciones. Cierre de Hito 3.
- Entregable de hito: Hito 3. Plataforma completa con todos los módulos funcionales en staging.

### S15: 02/11/2026 a 13/11/2026

- Ítems: inicio de 27 (pruebas integrales, seguridad y rendimiento), avance de 28 (documentación técnica y manuales).
- Entregable: suite Playwright cubriendo flujos críticos, revisión de seguridad multi-tenant.

### S16: 16/11/2026 a 30/11/2026

- Ítems: cierre de 27, cierre de 28, 29 (informe final y defensa).
- Entregable de hito: Hito 4. Informe final, demo, manuales y defensa lista.

## Fases del piloto

### Estado real del plan original

Los sprints S1 a S16 son el plan aprobado en el Hito 1 y se conservan como tal. La ejecución real fue más rápida que el plan: la versión beta del informe final y la documentación del Hito 4 se cerraron el 18/08/2026, con desvíos que el informe declara (entre ellos, que la suite de navegador del ítem 27 no se construyó). Por eso el contenido original de S15 y S16 ya estaba hecho cuando empezaron, y esos dos sprints se reasignan al piloto. El cambio es un desvío declarado: el plan no preveía una validación en uso real y se incorporó el 30/10/2026, a partir del relevamiento de la inmobiliaria.

### Calendario por ciclos reales

Desde S15 el ritmo lo marca el ciclo mensual de la inmobiliaria y no la quincena: la liquidación se prepara alrededor del día 20 del mes anterior y los pagos entran en los primeros días del mes. Cada ciclo exige que esté integrado lo que ese ciclo necesita, y los sprints se ordenan para llegar a cada fecha con eso listo.

| Ciclo | Fecha de liquidación | Modo | Debe estar listo | Evidencia |
|---|---|---|---|---|
| Línea base | ≈ 20/11/2026 | La inmobiliaria opera con su sistema actual y se mide | — | Tiempos por tarea, errores y atrasos |
| C1 | ≈ 20/11/2026 | En sombra: el equipo replica el ciclo en `piloto` | Oleadas 0 a 2 y la cartera importada | Reconciliación de recibos |
| C2 | ≈ 20/12/2026 | En paralelo: la inmobiliaria mira y compara | Oleada 3 (caja y cobros, cuenta corriente del locador) | Reconciliación de recibos y estados de cuenta; primer feedback de uso |
| C3 | ≈ 20/01/2027 | La inmobiliaria opera en Realfy con su sistema actual de respaldo | Oleada 4 | Métricas antes y después; feedback y defectos del uso |
| C4 | ≈ 20/02/2027 | Realfy es el sistema principal | Oleada 5 | Cierre del piloto |

**Estado real al 3/11/2026.** El desarrollo se adelantó a este calendario: entre el 31/10 y el 3/11/2026 se integraron las oleadas 3, 4 y 5 completas salvo la bandeja de consultas, que está en revisión. Los ciclos C2 a C4 ya no esperan desarrollo nuevo: dependen de los resultados de cada ciclo, de las correcciones que produzca el uso real y de habilitaciones externas (dominio de correo, cuenta de WhatsApp y confirmaciones del contador y del abogado). Los sprints S15 a S22 se reescriben con ese estado; la versión anterior, que ubicaba las oleadas 4 y 5 entre diciembre y febrero, se reemplaza y el adelanto se declara como desvío en `29-informe-final.md`, sección 9.8.

### S15 replanificado: 02/11/2026 a 13/11/2026

- Plan: 36 (caja y cobros), 37 (cuenta corriente del locador), 39 (carga de la cartera real en `piloto` y su revisión con la inmobiliaria), 45 (suite de reconciliación con casos sintéticos), 46 (documentación del piloto).
- Estado real al 03/11: hecho, y además las oleadas 4 y 5 salvo la bandeja de consultas. Integrados 36 (#161), 37 (#165), 39 (#155, #160), 45 en su parte sintética (#177), 38 (#170), 40 (#166, #169), 41 (#168), 42 (#167), 43 en parte (#172, #181) y 44 (#178, #180). Cartera real cargada el 02/11 y restauración de su copia medida (unos 3 segundos para la base).
- Resto del sprint: integrar la bandeja de consultas (43); desplegar en `piloto` lo integrado después del último despliegue, con su copia previa; cerrar con la inmobiliaria la lista de revisión de la carga y reenviar el lote (39); 46 (informe final, Hito 4 y este plan con el estado real).

### S16 replanificado: 16/11/2026 a 30/11/2026

- Ítems: 45 (línea base y C1 en sombra, ≈ 20/11), correcciones que salgan de la reconciliación, 46 (resultado del C1 en el informe final y en el Hito 4).
- Entregable de hito: Hito 4 el 30/11, con el piloto en curso: relevamiento, plan, oleadas 0 a 5, línea base, C1 y registro de feedback hasta esa fecha.

### S17: 01/12/2026 a 11/12/2026

- Ítems: correcciones del C1, 43 (dominio de correo, Resend y cuenta de WhatsApp en `piloto`, en modo de lista de prueba), ajuste de los valores por defecto con las respuestas del contador y del abogado.
- Entregable: lo que el C2 necesita —liquidación, cobros y estados de cuenta con las correcciones del C1— desplegado en `piloto` antes del 18/12.

### S18: 14/12/2026 a 23/12/2026

- Ítems: 45 (C2 en paralelo, ≈ 20/12), 30 (primeros hallazgos de uso real en el registro).
- Entregable: reconciliación de recibos y estados de cuenta del C2; primeros FB de uso real.

### S19: 04/01/2027 a 15/01/2027

- Ítems: correcciones del uso real, 43 (mensajería en modo activo y, si la inmobiliaria lo aprueba, la cobranza escalonada), 46 (anexo de validación con el C2).
- Entregable: lo que el C3 necesita desplegado antes del 18/01; anexo de validación actualizado con el C2.

### S20: 18/01/2027 a 29/01/2027

- Ítems: 45 (C3, ≈ 20/01, con la inmobiliaria operando), correcciones del uso real.
- Entregable: métricas antes y después del C3; feedback y defectos del uso real.

### S21: 01/02/2027 a 12/02/2027

- Ítems: 46 (anexo de validación con el C3 y preparación de la defensa), correcciones menores.
- Entregable: anexo de validación final para la defensa y ensayo completo.

### S22: 15/02/2027 a 26/02/2027

- Ítems: 45 (C4, ≈ 20/02), defensa.
- Entregable: defensa; cierre del piloto con el C4, o su informe posterior si la defensa es antes.

Las fechas de los ciclos son las de la inmobiliaria y no se mueven; lo que se ajusta es el contenido de cada sprint. Si un ítem no llega a su ciclo, el ciclo corre con lo que hay y la falta se registra como desvío del piloto.

## Notas operativas

- Cada sprint se planifica el primer lunes con una reunión breve y se cierra el último viernes con una demo interna.
- Las tareas se reparten priorizando que cada tesista mantenga continuidad sobre un módulo (por ejemplo, uno sostiene el dominio financiero a lo largo de varios sprints), sin perder revisión cruzada de pares.
- Los ítems con dependencias fuertes (por ejemplo, 13 sobre 12) se planifican para que la entrega del prerequisito esté cerrada antes del inicio del dependiente.
- Los ítems marcados como baja prioridad (25 y 26) se pueden recortar si los sprints finales requieren más tiempo para 27 y 28 sin afectar el Hito 4.

<!-- Estimaciones tecnicas revisadas por Manuel -->
