# Plan de Sprints

El desarrollo se organiza en sprints quincenales entre mayo y noviembre de 2026. La cadencia de dos semanas se elige por la disponibilidad parcial de los tres tesistas y por la necesidad de tener cierres frecuentes para validar entregables con el director de tesis.

Los sprints se solapan parcialmente con los ítems del Gantt: un sprint puede arrancar mientras otro está pasando por su ventana de control de calidad, y un mismo ítem del Gantt puede atravesar dos sprints si su ventana en el cronograma así lo dispone. Cuando un sprint coincide con un hito, su revisión final se extiende para producir los artefactos del hito.

## Hitos de referencia

- **Hito 1**: 15/05/2026. Aprobación de planificación: alcance, casos de uso, modelo de datos, arquitectura, backlog y plan de sprints.
- **Hito 2**: 14/08/2026. MVP operativo demostrable con flujo end-to-end (alta de propiedad, contrato, liquidación, pago, comprobante).
- **Hito 3**: 30/10/2026. Plataforma completa con portal del inquilino, CRM, ARCA, dashboard y notificaciones.
- **Hito 4**: 30/11/2026. Entrega final con pruebas integrales, documentación y defensa preparada.

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

## Notas operativas

- Cada sprint se planifica el primer lunes con una reunión breve y se cierra el último viernes con una demo interna.
- Las tareas se reparten priorizando que cada tesista mantenga continuidad sobre un módulo (por ejemplo, uno sostiene el dominio financiero a lo largo de varios sprints), sin perder revisión cruzada de pares.
- Los ítems con dependencias fuertes (por ejemplo, 13 sobre 12) se planifican para que la entrega del prerequisito esté cerrada antes del inicio del dependiente.
- Los ítems marcados como baja prioridad (25 y 26) se pueden recortar si los sprints finales requieren más tiempo para 27 y 28 sin afectar el Hito 4.
