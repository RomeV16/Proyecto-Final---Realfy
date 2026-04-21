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

