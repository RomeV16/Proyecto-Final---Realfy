# ADR-0002: Stack NestJS, Next.js y Prisma

## Estado

Aceptado.

## Fecha

2026-04-22.

## Contexto

Definida la organización en monorepo TypeScript, queda por decidir qué frameworks usar para la API, para el frontend y para el acceso a datos. Los criterios principales son: tipado fuerte extremo a extremo, productividad para un equipo pequeño, madurez del ecosistema, soporte para multi-tenant y compatibilidad con el deploy en Railway.

El dominio implica reglas de negocio densas (ajustes por IPC/UVA, liquidaciones con líneas configurables, integración con ARCA), pantallas internas con muchos formularios y un portal público con SEO básico. Se requiere también una capa de ORM que permita modelar relaciones complejas y mantener migraciones versionadas.

## Decisión

- **Backend**: NestJS 10. Se elige por su modelo de módulos, su sistema de inyección de dependencias y la facilidad para componer guards, interceptors y pipes (clave para el aislamiento multi-tenant y la auditoría). Los DTOs validados con `class-validator` o `zod` se integran naturalmente con los controladores.
- **Frontend**: Next.js 15 con App Router. Permite resolver el portal público con SSR/SSG y el área administrativa como aplicación interactiva, todo dentro del mismo proyecto. Se integra con `next-intl` para i18n.
- **ORM**: Prisma sobre PostgreSQL. Define el esquema en un único archivo, genera tipos al cliente automáticamente y gestiona migraciones versionadas en `apps/api/prisma/migrations`.

## Alternativas consideradas

- **Express o Fastify**: ofrecen más flexibilidad y menos peso, pero requieren montar a mano la estructura de módulos, la DI y los pipelines de validación que NestJS provee de fábrica. Para un equipo de tres personas el sobrecosto de bootstrap supera la ganancia.
- **Vue o Remix**: ecosistemas válidos. Se descartan porque el equipo ya tiene experiencia previa con React y porque la integración con next-intl y el uso de Server Components simplifican el portal público.
- **TypeORM o Drizzle**: TypeORM tiene historia de inconsistencias con TypeScript estricto. Drizzle es más liviano pero su tooling de migraciones es menos maduro frente al de Prisma. Se prioriza la madurez y la documentación.

## Consecuencias

Positivas:

- Tipado consistente desde el `schema.prisma` hasta los componentes de Next.js gracias a los tipos generados y a `packages/shared`.
- Estructura de NestJS familiar para revisores académicos; se separan claramente las capas controller/service/persistencia.
- Migraciones reproducibles en cada entorno (dev, staging, producción).

Negativas:

- NestJS impone una estructura que algunos miembros del equipo deben aprender; se mitiga con plantillas iniciales por módulo.
- Prisma requiere ejecutar `prisma generate` tras cada cambio de esquema; se automatiza en scripts del monorepo.
- Next.js App Router introduce conceptos nuevos (Server Components, route handlers) que conviven con patrones tradicionales y exigen disciplina de revisión.
