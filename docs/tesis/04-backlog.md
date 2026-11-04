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
- Corrección: el envío de correo se implementó con Resend, no con SMTP. Ampliado por el piloto: bandeja de salida con modos por ambiente, consentimiento y WhatsApp (ítem 43, PR 5.1 y 5.2, hecho); bandeja de consultas y cobranza escalonada (PR 5.3 y 5.4).

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

Los ítems 30 a 46 incorporan la validación en uso real. Cada uno tiene un issue con criterios de aceptación y las etiquetas `piloto` y `origen:*`. La oleada indica el orden de ejecución. Al 2026-11-03 están hechos los ítems 30 a 44, con lo que las seis oleadas de desarrollo quedaron entregadas; el 45 y el 46 son continuos hasta la defensa, porque dependen de los ciclos de la inmobiliaria. Después, el 3 y el 4/11, se sumó la oleada 6 de migración y boletas, que no tiene un ítem propio y se cuenta dentro de los ítems 35 y 39 (ver «Oleada 6» al final de esta sección).

### 30. Piloto: relevamiento, plan y registro de feedback

Documentar el contexto anonimizado del piloto, sus objetivos y métricas, el alcance, las fases, la gobernanza de datos y los riesgos; abrir el registro de feedback, la matriz de trazabilidad, la política de privacidad y el índice de decisiones de arquitectura.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: ninguna.
- Oleada: 0.
- Issue: #88.
- Estado al 2026-11-03: Hecho. Relevamiento, plan, registro de feedback, matriz de trazabilidad, privacidad e índice de decisiones integrados (#107) y ampliados con los diagramas y el plan de aceptación en campo (#162). El registro de feedback se sigue alimentando durante todo el piloto, con los hallazgos del uso real desde el C2.

### 31. Base de proceso: protección de rama, plantillas, pruebas web, CI

Plantillas de PR y de issues (requisito, defecto, feedback), etiquetas `piloto` y `origen:*`, protección de la rama principal, prueba de paridad de claves de i18n, cobertura de la web en el análisis estático, política de despliegue al ambiente `piloto` y copia mensual de la base.

- Prioridad: alta.
- Dueño: Romeo.
- Dependencias: ninguna.
- Oleada: 0.
- Issue: #89.
- Estado al 2026-11-03: Hecho (cerrado el 2026-10-31). PR #105, #106, #108, #110, #113, #114, #115, #116, #134, #135 y #137; después se sumaron la evidencia en rojo y verde de los defectos (#138) y el ensayo de migraciones con esquema de referencia en la semilla (#154).

### 32. Usuarios, invitaciones, contraseñas y permisos por rol

Pantalla de usuarios (invitar, rol, desactivar), aceptación de invitación, cambio y recupero de contraseña, menú filtrado por rol y matriz de lectura por rol.

- Prioridad: alta.
- Dueño: Romeo.
- Dependencias: 31.
- Oleada: 1.
- Issue: #90.
- Estado al 2026-11-03: Hecho (cerrado el 2026-10-31). PR #140 (usuarios, invitaciones y contraseñas) y #142 (grupos de roles y política de lectura).

### 33. Personas, locadores, apoderados y titularidad

Ficha de persona ampliada con varias cuentas bancarias; locadores por contrato con porcentaje de cobro y vigencia; apoderados con firma conjunta o indistinta; titularidad separada y opcional.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 31.
- Oleada: 1.
- Issue: #91.
- Estado al 2026-11-03: Hecho (cerrado el 2026-10-31). PR #136 (datos de persona y cuentas), #139 (locadores, apoderados y titularidad) y #141 (pantallas de las partes).

### 34. Reglas del contrato, acuerdos y ajustes con rezago

Valores por defecto de la inmobiliaria, reglas versionadas del contrato y acuerdos con fecha; fin real del contrato; ajuste con rezago del índice, base original o vigente, estimado con corrección, aplicación masiva con previsualización; activación validada del contrato.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 33.
- Oleada: 2.
- Issue: #92.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-02). PR #109 (índice de precios desde el INDEC con el BCRA de respaldo), #112 (activación), #148 (un solo camino de ajuste), #150 (reglas versionadas y acuerdos) y #153 (motor de ajuste con rezago).

### 35. Liquidación mensual completa: boletas, cargos, punitorios, recibo

Líneas con destino y marca de comisionable, generación anticipada, boletas de impuestos y servicios con reglas de traslado, centro de carga de cargos puntuales, punitorios en la liquidación con condonación auditada, recibo con monto en letras.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: 34.
- Oleada: 2.
- Issue: #93.
- Estado al 2026-11-04: Hecho (cerrado el 2026-11-02). PR #117 y #133 (correcciones de fechas, dinero y deuda), #151 (generador de liquidaciones), #156 (boletas y reglas de traslado), #158 (punitorios en la liquidación) y #159 (centro de carga). Después del cierre, el primer ensayo general del ciclo encontró y corrigió defectos de la generación y del ajuste del mes (DEF-130 a DEF-134, #225) y de los avisos de boletas (DEF-140 a DEF-143, #222), y la verificación del reparto por consumo, otros tres (DEF-105 a DEF-107, #198).

### 36. Cobros, caja, efectivo, custodia y compensaciones

Caja y cuentas, pago en tres flujos (repartido, todo a la inmobiliaria, todo al locador), efectivo en custodia, compensaciones entre locadores, custodia en moneda extranjera y recibos numerados.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 35.
- Oleada: 3.
- Issue: #94.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-02). PR #161 (caja y cuentas, cobro en tres flujos, custodia, compensaciones y recibos de cobro). Desplegado en `piloto`; su uso con la cartera real empieza en el C2.

### 37. Cuenta corriente y estado de cuenta del locador

Asientos por locador, estado de cuenta mensual consolidado de todas sus unidades con saldo arrastrado y saldo inicial editable y auditado, en PDF y listo para enviar.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: 36.
- Oleada: 3.
- Issue: #95.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-02). PR #165 (cuenta corriente, estado de cuenta mensual consolidado, saldo inicial y pago al locador; la rendición por contrato pasa a histórico).

### 38. Facturación por cuenta del locador

Emisor delegado por persona, emisión desde el pago o el estado de cuenta, configurable según qué y cuánto se factura.

- Prioridad: media.
- Dueño: Manuel.
- Dependencias: 37.
- Oleada: 4.
- Issue: #96.
- Estado al 2026-11-03: Hecho. PR #125 (comprobante sin pago y emisión recuperable) y #170 (facturación por cuenta del locador con emisor delegado, cola con reintentos y notas de crédito). Los criterios fiscales quedan con su valor por defecto hasta la confirmación del contador.

### 39. Migración desde el sistema anterior y calidad de datos

Importación idempotente de contratos, locadores, reglas, servicios, ajustes y saldos, con lote y registro; panel de calidad de datos con duplicados y relaciones a optimizar.

- Prioridad: alta.
- Dueño: Mariano.
- Dependencias: 33 a 37.
- Oleada: 3.
- Issue: #97.
- Estado al 2026-11-04: Hecho en lo que construye, con la migración todavía incompleta. PR #110 (importación ligada a la inmobiliaria), #155 (importación idempotente) y #160 (panel de calidad de datos); después, #187 (servicios y reglas de traslado en el lote, paso M8), #221 (cronograma de ajustes por fecha del historial, DEF-125 a DEF-129) y #227 (proveedor y cuenta normalizada). La cartera real se cargó en `piloto` el 2026-11-02 y los servicios y reglas el 2026-11-03; el issue sigue abierto hasta cerrar con la inmobiliaria la lista de revisión de la carga, los saldos iniciales propuestos (M10, con el saldo inicial de custodia integrado el 4/11 en #197), las plantillas (M11, en un pedido abierto) y las ventas en curso (M12, con su inventario hecho). El estado de cada paso está en `32-migracion.md`.

### 40. Vencimientos, renovaciones, prórrogas y depósitos

Semáforo de vencimientos y seguimientos con lista de verificación, renovación como período del contrato, prórroga de palabra con fin real, depósito con moneda, custodio y regla de devolución, y liquidación de egreso.

- Prioridad: media.
- Dueño: Manuel.
- Dependencias: 34.
- Oleada: 4.
- Issue: #98.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-02). PR #166 (semáforo, seguimientos con checklist, prórroga de palabra y renovación como período) y #169 (depósitos y liquidación de egreso).

### 41. Honorarios: alta, renovación, venta, tasación, comisiones del personal

Honorarios por operación con valores por defecto configurables, cuotas con ajuste, coorretaje y comisiones del personal.

- Prioridad: media.
- Dueño: Manuel.
- Dependencias: 36.
- Oleada: 4.
- Issue: #99.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-02). PR #168 (honorarios de alta, renovación, venta y tasación, cuotas ajustables, comisiones del personal y coorretaje).

### 42. Incidencias y reparaciones con imputación

Incidencia con preautorización, presupuesto, ejecución, pago e imputación al inquilino o al locador, con honorario de gestión opcional.

- Prioridad: media.
- Dueño: Mariano.
- Dependencias: 36.
- Oleada: 4.
- Issue: #100.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-02). PR #167 (preautorización, presupuestos con aprobación, pago al proveedor, imputación y honorario de gestión).

### 43. Mensajería, bandeja de consultas y cobranza escalonada

Envío de mail, mensajería instantánea con consentimiento y baja a través de una cola de salida, bandeja unificada de consultas con autorrespuesta y cobranza escalonada hasta la etapa prejudicial.

- Prioridad: media.
- Dueño: Romeo.
- Dependencias: 32, 35.
- Oleada: 4 y 5.
- Issue: #101.
- Estado al 2026-11-04: Hecho. PR #172 (bandeja de salida idempotente, correo y WhatsApp, modos de envío y consentimiento), #181 (cobranza escalonada, apagada de fábrica) y #183 (bandeja de consultas unificada con responsable, plazo de primera respuesta y autorrespuesta; corrige DEF-95). El dominio propio del producto y el dominio de correo están verificados desde el 3/11; la recepción de los mails entrantes (Email Routing y un Worker de Cloudflare) está en un pedido abierto (#234). La mensajería queda apagada en `piloto` hasta verificar la cuenta de WhatsApp y hasta que la inmobiliaria apruebe los envíos; las decisiones legales de la cobranza siguen pendientes de revisión por el abogado de la inmobiliaria.

### 44. Ventas, llaves y publicación

Operación de venta (reserva, seña, boleto), registro de llaves y sus movimientos, y publicación asistida con estado por portal.

- Prioridad: baja.
- Dueño: Romeo.
- Dependencias: 41.
- Oleada: 5.
- Issue: #102.
- Estado al 2026-11-03: Hecho (cerrado el 2026-11-03). PR #178 (publicación asistida y micrositio con dominio propio) y #180 (ventas, señas, documentación y llaves).

### 45. Validación en campo: ciclos en paralelo, reconciliación y métricas

Ciclos en sombra, paralelo y propio, suite de reconciliación, línea base y métricas del piloto.

- Prioridad: alta.
- Dueño: Manuel.
- Dependencias: 39.
- Oleada: 3 a 5.
- Issue: #103.
- Estado al 2026-11-04: Continuo. La suite de reconciliación con casos sintéticos está integrada (#177) y encontró DEF-70 a DEF-73. Se hicieron dos ensayos generales del primer ciclo sobre una copia de `piloto`, que encontraron veinticuatro defectos (DEF-115 a DEF-143 y DEF-173 a DEF-176) y estimaron la coincidencia del C1 según las boletas y las prórrogas (porcentajes: a completar tras el consentimiento de la inmobiliaria; `../calidad/12-piloto.md`, sección 10). La línea base y el C1 son alrededor del 20/11/2026, el C2 alrededor del 20/12/2026 y el C3 alrededor del 20/01/2027.

### 46. Documentación, informe y defensa con el piloto

Actualización de la documentación, el informe final y la preparación de la defensa con el piloto como evidencia.

- Prioridad: alta.
- Dueño: Todos.
- Dependencias: todos los ítems anteriores.
- Oleada: Continuo.
- Issue: #104.
- Estado al 2026-11-04: Continuo. Documentación en el mismo PR de cada cambio, más tres PR propios (#107, #162 y #186) y la actualización del informe final, el Hito 4 y este plan con las oleadas 3 a 5; la del 4/11 suma la oleada 6, los ensayos generales y las cifras remedidas. El anexo de validación se actualiza tras el C2 y el C3.

### Oleada 6: migración completa y obtención automática de boletas

Trabajo agregado el 3 y el 4/11/2026, después de verificar que la migración de la cartera estaba incompleta y de que ningún proveedor ofrece una interfaz de consulta de boletas. No tiene ítem del cronograma ni issue de ítem: se cuenta dentro de los ítems 35 (boletas y reglas de traslado) y 39 (migración), y se declara como ampliación de alcance en el informe final, sección 9.8. Integrado: servicios y reglas en el lote de importación (#187), consumo por unidad (#198), obtención automática de boletas con su catálogo de proveedores y circuito común (#193, ADR-0018), formulario de servicios (#231), proveedor y cuenta normalizada (#227), pantalla de boletas recibidas (#229), boletas por mail de remitentes automáticos (#236) y las correcciones del ensayo general (#220 a #225). Abiertos al 4/11: plantillas de contrato completas (#199), Worker de recepción de mails (#234) y prórroga de contratos importados sin historial (#242); el saldo inicial de cuentas de caja y custodia (#197) se integró ese día.

<!-- Cierre item 04 — backlog priorizado -->
