# Backlog

El backlog refleja los ítems 05 a 46 del cronograma Gantt del proyecto: los ítems 05 a 29 son el desarrollo original de la tesis y los ítems 30 a 46 son el piloto en una inmobiliaria real (ver `30-piloto.md`). Los ítems 01 a 04 corresponden a actividades académicas previas (definición de tema, anteproyecto, marco teórico, plan de trabajo) y no se enumeran aquí. Cada entrada incluye un identificador, una descripción funcional acotada, prioridad estimada para el MVP y dependencias respecto de ítems previos.

La prioridad se expresa como alta (bloqueante para el MVP operativo), media (necesaria para Hito 3) y baja (mejora o ítem habilitante de Hito 4). En los ítems del piloto la escala se redefine según cuánto bloquea el uso real, con la misma clasificación de `30-piloto.md`: alta corresponde a P0 (sin esto la inmobiliaria no puede dejar sus planillas en el ciclo mensual) o a un ítem de proceso del que dependen todos; media, a P1 (necesario para operar todo el ciclo dentro de Realfy), y baja, a P2 (ventas y crecimiento).

## Plataforma base

### 05. Configuracion de repositorio, entornos y CI

Inicializar el monorepo Turborepo con `apps/api`, `apps/web` y `packages/shared`. Configurar pnpm workspaces, TypeScript estricto, ESLint, Prettier y los pipelines de GitHub Actions (lint, build, test, e2e). Provisionar entornos de desarrollo, staging y producción en Railway con sus respectivas bases PostgreSQL.

- Prioridad: alta.
- Dependencias: ninguna.

### 06. Autenticacion, roles y permisos

Implementar login interno con JWT de acceso y refresh con rotación. Definir entidades `User`, `RefreshToken` y `UserInvitation`. Crear guards de autorización por rol (administrador, agente) y el flujo de aceptación de invitación.

- Prioridad: alta.
- Dependencias: 05.

### 07. Multi-inmobiliaria, auditoria y logging

Modelar `Tenant`, inyectar `tenantId` desde el contexto autenticado y aplicar el wrapper de Prisma que fuerza el filtro. Implementar `AuditLog` para acciones sensibles y un logging estructurado consumible desde Railway.

- Prioridad: alta.
- Dependencias: 06.

### 08. UI base, navegacion y dashboard inicial

Construir el shell de `apps/web` con App Router, internacionalización mediante `next-intl`, layout autenticado, sidebar de navegación y un dashboard placeholder. Integrar el cliente HTTP tipado contra la API.

- Prioridad: alta.
- Dependencias: 06.

## Gestión operativa

### 09. Gestion de propiedades, estados e imagenes

CRUD de `Property` con tipos, estados (disponible, reservada, alquilada, fuera de servicio), operaciones, media y tasaciones. Carga de imágenes con orden y portada. Auditoría del cambio de estado.

- Prioridad: alta.
- Dependencias: 07, 08.

### 10. Personas, propietarios, inquilinos y garantes

CRUD de `Person` con asignación múltiple de roles, documentos adjuntos y `ProviderProfile` para proveedores. Vista unificada del histórico de la persona.

- Prioridad: alta.
- Dependencias: 07.

### 11. Contratos, garantias, documentos y plantillas

Alta de contratos con partes, garantías, plantillas y generación del documento. Renovación a partir de un contrato vencido. Auditoría de cambios sensibles.

- Prioridad: alta.
- Dependencias: 09, 10.
- Ampliado por el piloto: activación validada, locadores por contrato, reglas versionadas y fin real (ítems 33 y 34); renovación como período del contrato (ítem 40).

### 12. Actualizacion de alquiler por IPC, UVA o valor manual

Modelar `ContractAdjustment`, `AdjustmentSchedule` y `IndexData`. Calcular el próximo ajuste según la modalidad pactada. Importar índices manualmente y, donde sea posible, mediante sincronización con INDEC/BCRA.

- Prioridad: alta.
- Dependencias: 11.
- Ampliado por el piloto: rezago del índice, base del ajuste, estimado con corrección, UVA y escalonado, y aplicación de los ajustes del mes (ítem 34).

## Ciclo financiero

### 13. Liquidaciones mensuales, impuestos, servicios y honorarios

Generar `Liquidacion` con sus líneas (alquiler, expensas, servicios, impuestos, honorarios). Configurar la comisión por contrato. Restricciones de unicidad por contrato y período.

- Prioridad: alta.
- Dependencias: 12.
- Ampliado por el piloto: renglones con destino y marca de comisionable, boletas con reglas de traslado, cargos y punitorios dentro de la liquidación (ítem 35).

### 14. Registro de pagos y estados de deuda

Registrar pagos totales o parciales contra una liquidación. Actualizar el saldo y el estado de deuda del contrato. Auditar bajas con motivo.

- Prioridad: alta.
- Dependencias: 13.
- Ampliado por el piloto: cobro en tres flujos, caja, custodia y compensaciones (ítem 36).

### 15. Morosidad, punitorios y derivacion legal

Calcular punitorios automáticos al pasar la fecha de vencimiento. Cambiar el estado del contrato a mora según umbral. Marcar derivación legal con metadatos.

- Prioridad: alta.
- Dependencias: 14.
- Ampliado por el piloto: punitorio por contrato dentro de la liquidación (ítem 35) y cobranza escalonada (ítem 43).

## Operación y soporte

### 16. Reclamos, tickets de mantenimiento y proveedores

CRUD de tickets con categoría, prioridad, comentarios y adjuntos. Asignación de proveedor desde `ProviderProfile`. Notificación a las partes al cambiar de estado.

- Prioridad: alta.
- Dependencias: 10, 09.
- Ampliado por el piloto: incidencias con preautorización, presupuesto e imputación (ítem 42).

### 17. Portal de autogestion para inquilinos

Construir la rama `/[locale]/portal/...` con login propio basado en `InquilinoCredential` y `PortalRefreshToken`. Vista de saldo, descarga de comprobantes, apertura de tickets y actualización de datos de contacto.

- Prioridad: alta.
- Dependencias: 14, 16.

### 18. Notificaciones de vencimientos, deudas y cambios de estado

Cola de `Notification`, plantillas reutilizables `EmailTemplate`, envío por SMTP. Disparadores en vencimientos, mora, alta de liquidación y cambios de estado de contrato o ticket.

- Prioridad: media.
- Dependencias: 14, 15, 16.
- Corrección: el envío de correo se implementó con Resend, no con SMTP. Ampliado por el piloto: cola de salida y mensajería instantánea (ítem 43).

## Comercial y público

### 19. CRM, leads, pipeline e historial de interacciones

Configurar `Pipeline` y `PipelineStage`. Alta de leads, registro de interacciones y visitas. Conversión de lead en `Person` con apertura opcional de contrato.

- Prioridad: alta.
- Dependencias: 09, 10.

### 20. Portal publico con templates y branding

Páginas públicas SSR por inmobiliaria, ruteo por slug, listado de propiedades disponibles, branding básico (logo, color principal) y formulario de contacto que crea un `Lead`.

- Prioridad: media.
- Dependencias: 09, 19.

## Cumplimiento e inteligencia

### 21. Facturacion electronica via ARCA

Configurar el emisor y el punto de venta en ARCA (`ArcaIssuer`, `ArcaPuntoDeVenta`) y el certificado digital (`ArcaCertificate`). Integrar WSAA/WSFEv1 contra el ambiente de homologación. Emitir comprobantes asociados a pagos y manejar notas de crédito.

- Prioridad: alta.
- Dependencias: 13.
- Ampliado por el piloto: facturación por cuenta del locador (ítem 38).

### 22. Scoring interno de inquilinos y tasaciones

Modelar `TenantScoreConfig` y `TenantScore`. Recalcular puntaje al registrar pagos y cierres de contrato. Cargar tasaciones de propiedades con método y fecha.

- Prioridad: media.
- Dependencias: 14, 09.

### 23. Importacion y exportacion con validacion de datos

Permitir cargar masivamente personas, propiedades y contratos desde CSV/Excel con validación previa y reporte de errores por fila. Exportar entidades clave en CSV.

- Prioridad: media.
- Dependencias: 09, 10, 11.
- Ampliado por el piloto: importación idempotente de contratos, locadores, reglas e historial de ajustes desde el sistema anterior, y panel de calidad de datos (ítem 39).

### 24. Dashboard de KPIs, ocupacion, rentabilidad y flujo de caja

Endpoint `GET /dashboard/summary` y vistas en `apps/web` con ocupación, cobranza, mora y flujo de caja mensual. Reportes detallados por período.

- Prioridad: media.
- Dependencias: 14, 15, 21.

### 25. Panel de priorizacion diaria con IA

Panel que sugiere al agente las acciones del día (cobranzas pendientes, tickets vencidos, leads en pausa) con asistencia de un modelo LLM. Incluye explicación de cada sugerencia.

- Prioridad: baja.
- Dependencias: 14, 16, 19.

### 26. Resumen de gestion con IA al cierre de contrato

Al cerrar un contrato, generar un resumen narrativo con cumplimiento de pagos, tickets, ajustes aplicados y rendiciones, listo para compartir con el propietario.

- Prioridad: baja.
- Dependencias: 11, 14, 15, 16.

## Cierre académico

### 27. Pruebas integrales, seguridad, rendimiento y correcciones

Suite completa de Playwright sobre los flujos críticos. Revisión de seguridad enfocada en aislamiento multi-tenant. Pruebas de carga acotadas sobre liquidaciones y reportes.

- Prioridad: alta.
- Dependencias: todos los ítems funcionales previos.

### 28. Documentacion tecnica, manuales y demo

Documentación técnica final, manual de usuario para administrador, agente e inquilino, video o guion de demostración.

- Prioridad: alta.
- Dependencias: 27.

### 29. Informe final y preparacion de defensa

Redacción del informe de tesis, preparación de presentación y ensayos de defensa.

- Prioridad: alta.
- Dependencias: 28.

## Piloto en una inmobiliaria real

Los ítems 30 a 46 incorporan la validación en uso real. Cada uno tiene un issue con criterios de aceptación y las etiquetas `piloto` y `origen:*`. La oleada indica el orden de ejecución.

### 30. Piloto: relevamiento, plan y registro de feedback

Documentar el contexto anonimizado del piloto, sus objetivos y métricas, el alcance, las fases, la gobernanza de datos y los riesgos; abrir el registro de feedback, la matriz de trazabilidad, la política de privacidad y el índice de decisiones de arquitectura.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: ninguna.
- Oleada: 0.
- Issue: #88.
- Estado al 2026-11-02: En curso. Relevamiento, plan, registro de feedback, matriz de trazabilidad, privacidad e índice de decisiones integrados (#107); el registro de feedback se mantiene durante todo el piloto.

### 31. Base de proceso: protección de rama, plantillas, pruebas web, CI

Plantillas de PR y de issues (requisito, defecto, feedback), etiquetas `piloto` y `origen:*`, protección de la rama principal, prueba de paridad de claves de i18n, cobertura de la web en el análisis estático, política de despliegue al ambiente `piloto` y copia mensual de la base.

- Prioridad: alta.
- Dueño: Romeo.
- Dependencias: ninguna.
- Oleada: 0.
- Issue: #89.
- Estado al 2026-11-02: Hecho (cerrado el 2026-10-31). PR #105, #106, #108, #110, #113, #114, #115, #116, #134, #135 y #137.

### 32. Usuarios, invitaciones, contraseñas y permisos por rol

Pantalla de usuarios (invitar, rol, desactivar), aceptación de invitación, cambio y recupero de contraseña, menú filtrado por rol y matriz de lectura por rol.

- Prioridad: alta.
- Dueño: Romeo.
- Dependencias: 31.
- Oleada: 1.
- Issue: #90.
- Estado al 2026-11-02: Hecho (cerrado el 2026-10-31). PR #140 (usuarios, invitaciones y contraseñas) y #142 (grupos de roles y política de lectura).

### 33. Personas, locadores, apoderados y titularidad

Ficha de persona ampliada con varias cuentas bancarias; locadores por contrato con porcentaje de cobro y vigencia; apoderados con firma conjunta o indistinta; titularidad separada y opcional.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 31.
- Oleada: 1.
- Issue: #91.
- Estado al 2026-11-02: Hecho (cerrado el 2026-10-31). PR #136 (datos de persona y cuentas), #139 (locadores, apoderados y titularidad) y #141 (pantallas de las partes).

### 34. Reglas del contrato, acuerdos y ajustes con rezago

Valores por defecto de la inmobiliaria, reglas versionadas del contrato y acuerdos con fecha; fin real del contrato; ajuste con rezago del índice, base original o vigente, estimado con corrección, aplicación masiva con previsualización; activación validada del contrato.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 33.
- Oleada: 2.
- Issue: #92.
- Estado al 2026-11-02: Hecho. PR #109 (índice de precios desde el INDEC con el BCRA de respaldo), #112 (activación), #148 (un solo camino de ajuste), #150 (reglas versionadas y acuerdos) y #153 (motor de ajuste con rezago).

### 35. Liquidación mensual completa: boletas, cargos, punitorios, recibo

Líneas con destino y marca de comisionable, generación anticipada, boletas de impuestos y servicios con reglas de traslado, centro de carga de cargos puntuales, punitorios en la liquidación con condonación auditada, recibo con monto en letras.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: 34.
- Oleada: 2.
- Issue: #93.
- Estado al 2026-11-02: Hecho. PR #117 y #133 (correcciones de fechas, dinero y deuda), #151 (generador de liquidaciones), #156 (boletas y reglas de traslado), #158 (punitorios en la liquidación) y #159 (centro de carga).

### 36. Cobros, caja, efectivo, custodia y compensaciones

Caja y cuentas, pago en tres flujos (repartido, todo a la inmobiliaria, todo al locador), efectivo en custodia, compensaciones entre locadores, custodia en moneda extranjera y recibos numerados.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 35.
- Oleada: 3.
- Issue: #94.
- Estado al 2026-11-02: Integrado. PR #161 (caja y cuentas, cobro en tres flujos, custodia, compensaciones y recibos de cobro). Pendiente su despliegue en `piloto` y su uso en el C2.

### 37. Cuenta corriente y estado de cuenta del locador

Asientos por locador, estado de cuenta mensual consolidado de todas sus unidades con saldo arrastrado y saldo inicial editable y auditado, en PDF y listo para enviar.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: 36.
- Oleada: 3.
- Issue: #95.
- Estado al 2026-11-02: En curso (PR 3.2 de la oleada 3), para el C2.

### 38. Facturación por cuenta del locador

Emisor delegado por persona, emisión desde el pago o el estado de cuenta, configurable según qué y cuánto se factura.

- Prioridad: media.
- Dueño: Manuel.
- Dependencias: 37.
- Oleada: 4.
- Issue: #96.
- Estado al 2026-11-02: En curso. Comprobante sin pago y emisión recuperable integrados (#125); la emisión por cuenta del locador está planificada para la oleada 4.

### 39. Migración desde el sistema anterior y calidad de datos

Importación idempotente de contratos, locadores, reglas, servicios, ajustes y saldos, con lote y registro; panel de calidad de datos con duplicados y relaciones a optimizar.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 33 a 37.
- Oleada: 3.
- Issue: #97.
- Estado al 2026-11-02: En curso. Importación ligada a la inmobiliaria (#110), importación idempotente (#155) y panel de calidad de datos (#160) integrados; la cartera real se cargó en `piloto` el 2026-11-02 y su revisión con la inmobiliaria sigue abierta.

### 40. Vencimientos, renovaciones, prórrogas y depósitos

Semáforo de vencimientos y seguimientos con lista de verificación, renovación como período del contrato, prórroga de palabra con fin real, depósito con moneda, custodio y regla de devolución, y liquidación de egreso.

- Prioridad: media.
- Dueño: Manuel.
- Dependencias: 34.
- Oleada: 4.
- Issue: #98.
- Estado al 2026-11-02: Planificado (oleada 4). El fin real y la prórroga de palabra ya existen como parte del ítem 34.

### 41. Honorarios: alta, renovación, venta, tasación, comisiones del personal

Honorarios por operación con valores por defecto configurables, cuotas con ajuste, coorretaje y comisiones del personal.

- Prioridad: media.
- Dueño: Manuel.
- Dependencias: 36.
- Oleada: 4.
- Issue: #99.
- Estado al 2026-11-02: Planificado (oleada 4). Los porcentajes de honorarios por defecto ya son valores configurables de la inmobiliaria (ítem 34).

### 42. Incidencias y reparaciones con imputación

Incidencia con preautorización, presupuesto, ejecución, pago e imputación al inquilino o al locador, con honorario de gestión opcional.

- Prioridad: media.
- Dueño: Mariano.
- Dependencias: 36.
- Oleada: 4.
- Issue: #100.
- Estado al 2026-11-02: Planificado (oleada 4). El centro de carga del ítem 35 ya imputa reparaciones al inquilino o al locador.

### 43. Mensajería, bandeja de consultas y cobranza escalonada

Envío de mail, mensajería instantánea con consentimiento y baja a través de una cola de salida, bandeja unificada de consultas con autorrespuesta y cobranza escalonada hasta la etapa prejudicial.

- Prioridad: media.
- Dueño: Romeo.
- Dependencias: 32, 35.
- Oleada: 4 y 5.
- Issue: #101.
- Estado al 2026-11-02: Planificado (oleadas 4 y 5). Depende del dominio propio y de la configuración del correo, pendientes.

### 44. Ventas, llaves y publicación

Operación de venta (reserva, seña, boleto), registro de llaves y sus movimientos, y publicación asistida con estado por portal.

- Prioridad: baja.
- Dueño: Romeo.
- Dependencias: 41.
- Oleada: 5.
- Issue: #102.
- Estado al 2026-11-02: Planificado (oleada 5).

### 45. Validación en campo: ciclos en paralelo, reconciliación y métricas

Ciclos en sombra, paralelo y propio, suite de reconciliación, línea base y métricas del piloto.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: 39.
- Oleada: 3 a 5.
- Issue: #103.
- Estado al 2026-11-02: Pendiente. Línea base y C1 alrededor del 20/11/2026; la suite de reconciliación con casos sintéticos es el PR 3.5.

### 46. Documentación, informe y defensa con el piloto

Actualización de la documentación, el informe final y la preparación de la defensa con el piloto como evidencia.

- Prioridad: alta.
- Dueño: Todos.
- Dependencias: todos los ítems anteriores.
- Oleada: Continuo.
- Issue: #104.
- Estado al 2026-11-02: En curso. Documentación en el mismo PR de cada cambio; capítulo del piloto en el Hito 4 (30/11/2026) y anexo tras C2 y C3.

<!-- Cierre item 04 — backlog priorizado -->
