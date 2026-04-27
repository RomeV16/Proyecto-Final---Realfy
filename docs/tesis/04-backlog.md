# Backlog

El backlog refleja los ítems 05 a 29 del cronograma Gantt del proyecto. Los ítems 01 a 04 corresponden a actividades académicas previas (definición de tema, anteproyecto, marco teórico, plan de trabajo) y no se enumeran aquí. Cada entrada incluye un identificador, una descripción funcional acotada, prioridad estimada para el MVP y dependencias respecto de ítems previos.

La prioridad se expresa como alta (bloqueante para el MVP operativo), media (necesaria para Hito 3) y baja (mejora o ítem habilitante de Hito 4).

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

### 12. Actualizacion de alquiler por IPC, UVA o valor manual

Modelar `ContractAdjustment`, `AdjustmentSchedule` y `IndexData`. Calcular el próximo ajuste según la modalidad pactada. Importar índices manualmente y, donde sea posible, mediante sincronización con INDEC/BCRA.

- Prioridad: alta.
- Dependencias: 11.

## Ciclo financiero

### 13. Liquidaciones mensuales, impuestos, servicios y honorarios

Generar `Liquidacion` con sus líneas (alquiler, expensas, servicios, impuestos, honorarios). Configurar la comisión por contrato. Restricciones de unicidad por contrato y período.

- Prioridad: alta.
- Dependencias: 12.

### 14. Registro de pagos y estados de deuda

Registrar pagos totales o parciales contra una liquidación. Actualizar el saldo y el estado de deuda del contrato. Auditar bajas con motivo.

- Prioridad: alta.
- Dependencias: 13.

### 15. Morosidad, punitorios y derivacion legal

Calcular punitorios automáticos al pasar la fecha de vencimiento. Cambiar el estado del contrato a mora según umbral. Marcar derivación legal con metadatos.

- Prioridad: alta.
- Dependencias: 14.

## Operación y soporte

### 16. Reclamos, tickets de mantenimiento y proveedores

CRUD de tickets con categoría, prioridad, comentarios y adjuntos. Asignación de proveedor desde `ProviderProfile`. Notificación a las partes al cambiar de estado.

- Prioridad: alta.
- Dependencias: 10, 09.

### 17. Portal de autogestion para inquilinos

Construir la rama `/[locale]/portal/...` con login propio basado en `InquilinoCredential` y `PortalRefreshToken`. Vista de saldo, descarga de comprobantes, apertura de tickets y actualización de datos de contacto.

- Prioridad: alta.
- Dependencias: 14, 16.

### 18. Notificaciones de vencimientos, deudas y cambios de estado

Cola de `Notification`, plantillas reutilizables `EmailTemplate`, envío por SMTP. Disparadores en vencimientos, mora, alta de liquidación y cambios de estado de contrato o ticket.

- Prioridad: media.
- Dependencias: 14, 15, 16.

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

Configurar `TenantArcaConfig` (CUIT, punto de venta, certificados). Integrar WSAA/WSFEv1 contra el ambiente de homologación. Emitir comprobantes asociados a liquidaciones y manejar notas de crédito.

- Prioridad: alta.
- Dependencias: 13.

### 22. Scoring interno de inquilinos y tasaciones

Modelar `TenantScoreConfig` y `TenantScore`. Recalcular puntaje al registrar pagos y cierres de contrato. Cargar tasaciones de propiedades con método y fecha.

- Prioridad: media.
- Dependencias: 14, 09.

### 23. Importacion y exportacion con validacion de datos

Permitir cargar masivamente personas, propiedades y contratos desde CSV/Excel con validación previa y reporte de errores por fila. Exportar entidades clave en CSV.

- Prioridad: media.
- Dependencias: 09, 10, 11.

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
