# Hito 1: Planificación aprobada

## Fecha

2026-05-15.

## Resumen del hito

El Hito 1 corresponde al cierre de la etapa de planificación del trabajo final. Su entregable es el conjunto de documentos que definen el qué y el cómo del proyecto antes de iniciar la construcción del MVP. La meta es que el director de tesis pueda evaluar la viabilidad del plan, el alcance comprometido y la consistencia técnica entre las decisiones tomadas.

## Documentación aprobada

- **Alcance y objetivos** (`01-alcance-y-objetivos.md`): contexto, objetivos generales y específicos, alcance funcional y exclusiones. Foco en el caso argentino con ajustes IPC/UVA y emisión electrónica ARCA.
- **Glosario** (`01-glosario.md`): términos del dominio inmobiliario y técnicos usados en toda la documentación.
- **Roles y casos de uso** (`02-roles-y-casos-uso.md`): definición de los roles (administrador, agente, inquilino) y veinticuatro casos de uso priorizados para el MVP.
- **Criterios de aceptación** (`02-criterios-aceptacion.md`): criterios por módulo (auth, propiedades, contratos, liquidaciones, pagos, tickets, portal inquilino, ARCA, CRM) que guían el desarrollo y las pruebas e2e.
- **Arquitectura** (`03-arquitectura.md`): monorepo Turborepo con NestJS, Next.js y Prisma, despliegue en Railway, multi-tenant por row-level y JWT con refresh rotativo.
- **Modelo de datos** (`03-modelo-datos.md`): entidades de Prisma agrupadas por dominio (auth, personas, propiedades, contratos, liquidaciones, ARCA, CRM, tickets, portal, scoring y notificaciones).
- **Contratos de API** (`03-contratos-api.md`): catálogo de endpoints REST con convenciones uniformes de respuesta y headers de autenticación.
- **Backlog** (`04-backlog.md`): ítems 05 a 29 del Gantt con prioridad y dependencias.
- **Plan de sprints** (`04-plan-sprints.md`): dieciséis sprints quincenales entre mayo y noviembre de 2026 con sus entregables y la asignación de hitos.
- **ADR 0001**: monorepo con Turborepo.
- **ADR 0002**: stack NestJS, Next.js y Prisma.
- **ADR 0003**: multi-tenancy por row-level.

## Lecciones aprendidas

- La especificidad regulatoria argentina (ARCA, IPC, UVA, ley de alquileres vigente) obliga a modelar el dominio con cuidado desde el primer momento; no alcanza con replicar SaaS inmobiliarios genéricos del mercado anglosajón.
- Documentar los casos de uso por rol antes de empezar a tipear código permitió detectar tempranamente la necesidad de separar el flujo de autenticación del portal del inquilino del flujo interno.
- Trabajar con un glosario explícito reduce el ruido en las discusiones técnicas: términos como rendición, liquidación, comprobante o derivación legal quedan acordados antes de aparecer en el código.
- Definir el aislamiento multi-tenant en un ADR específico (0003) antes de programar el primer módulo evita decisiones puntuales inconsistentes y facilita la posterior revisión de seguridad.
- Tres tesistas con disponibilidad parcial requieren sprints cortos y entregables visibles cada quincena; el plan de sprints prioriza ese ritmo sobre la ambición de cada iteración.

## Próximos pasos hacia el Hito 2

- Ejecutar S2 a S8 según el plan de sprints, con foco en cerrar el flujo end-to-end del MVP: alta de propiedad, contrato, liquidación, pago y comprobante ARCA en homologación.
- Habilitar el ambiente de staging en Railway con datos de demostración representativos.
- Construir una primera suite Playwright que cubra el flujo crítico del MVP, aun antes del sprint dedicado a pruebas integrales.
- Validar la integración con ARCA en homologación temprano para detectar bloqueos administrativos (CUIT, certificados, punto de venta).

## Riesgos identificados

- **Integración con ARCA**: depende de obtener certificados de homologación y un punto de venta válido. Mitigación: arrancar el trámite en S5, antes del sprint en que se construye el módulo.
- **Volumen de UI por construir**: los CRUD de propiedades, personas y contratos concentran mucha pantalla en pocos sprints. Mitigación: priorizar componentes compartidos (tablas, formularios, modales) en S2 para no replicar trabajo.
- **Aislamiento multi-tenant**: el riesgo se mitiga con guards y pruebas e2e, pero requiere disciplina de revisión sobre cada PR que toque módulos de dominio.
- **Disponibilidad del equipo**: tres tesistas con cargas académicas y laborales paralelas. Mitigación: sprints quincenales con tareas cerradas y demo interna obligatoria al final de cada uno.
- **Sincronización de índices IPC/UVA**: las fuentes externas (INDEC, BCRA) pueden cambiar formato o ritmo de publicación. Mitigación: contemplar carga manual como camino alternativo y desacoplar el cálculo del medio de obtención.
