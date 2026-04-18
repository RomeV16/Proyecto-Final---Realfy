# ADR-0001: Monorepo con Turborepo

## Estado

Aceptado.

## Fecha

2026-04-18.

## Contexto

Realfy se compone, como mínimo, de dos aplicaciones desplegables: una API backend (`apps/api`) y un frontend web (`apps/web`). Ambas comparten un dominio rico (propiedades, contratos, liquidaciones, comprobantes ARCA, leads del CRM) modelado con TypeScript. Existen también utilidades, enums y validadores que aparecen en los dos lados (por ejemplo, las modalidades de ajuste IPC/UVA/manual, los estados de propiedad y los esquemas de validación con Zod).

Sostener esa relación con repositorios separados implicaría publicar paquetes intermedios o copiar tipos a mano, con el riesgo de desincronizar la API y el frontend frente a cualquier cambio. A su vez, el equipo es pequeño (tres tesistas) y se busca minimizar el costo operativo del versionado, el control de dependencias y la coordinación de despliegues.

En ese marco, se evalúa cómo organizar el código de modo que el tipado sea consistente extremo a extremo, que los builds aprovechen cacheo entre paquetes y que el CI quede simple de mantener.

## Decisión

Se adopta una estructura de monorepo gestionada con Turborepo sobre workspaces de pnpm. El árbol queda compuesto por `apps/api`, `apps/web`, `packages/shared` y, a futuro, otros paquetes según se identifiquen abstracciones reutilizables. Turborepo administra la orquestación de tareas (`build`, `lint`, `test`, `dev`) con cache local y, opcionalmente, remoto.

## Alternativas consideradas

- **Nx**: ecosistema más amplio y soporte de generadores potentes. Se descarta por una curva de configuración más profunda y porque varias funcionalidades que aporta no son necesarias para el alcance del trabajo.
- **Lerna**: en mantenimiento limitado tras la transferencia a Nrwl. La integración con pnpm es menos directa.
- **Multi-repo**: implicaría publicar los tipos compartidos como paquete propio en un registry privado, con coordinación manual de versiones. No se justifica para un equipo de tres personas.

## Consecuencias

Positivas:

- Una única instalación de dependencias compartidas, sin riesgo de drift de versiones entre API y web.
- Tipos del dominio reutilizables sin pasar por un registry intermedio.
- Cache de Turborepo acelera los builds en CI cuando los cambios afectan a un solo paquete.
- Refactors que tocan API y web pueden hacerse en un mismo commit y revisarse de forma atómica.

Negativas:

- Curva inicial para alinear configuraciones (TypeScript, ESLint, Prettier) entre paquetes.
- El despliegue independiente exige tener claro qué cambios afectan a cada aplicación; se mitiga con scripts específicos por servicio en Railway.
- Riesgo de acoplar accidentalmente código del frontend con internals del backend; se controla mediante reglas de import en `packages/shared`.
