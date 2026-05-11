# ADR-0003: Multi-tenancy por row-level

## Estado

Aceptado.

## Fecha

2026-05-11.

## Contexto

Realfy se ofrece como SaaS multi-inmobiliaria. Cada inmobiliaria (entidad `Tenant`) administra su propia cartera de propiedades, personas, contratos, liquidaciones, leads y tickets. El aislamiento entre tenants es un requisito funcional crítico: una fuga de datos entre inmobiliarias implicaría un incidente regulatorio y reputacional grave.

Existen tres patrones canónicos para implementar multi-tenancy con PostgreSQL:

1. **Row-level**: una sola base, una sola schema; cada tabla del dominio incluye una columna `tenantId` y todas las consultas filtran por ella.
2. **Schema-per-tenant**: una sola base, una schema por inmobiliaria. La selección de schema se hace por sesión (`SET search_path`).
3. **Database-per-tenant**: una base por inmobiliaria, instanciada al alta del cliente.

La elección impacta en el costo operativo, en la complejidad del backup/restore, en la facilidad para hacer agregaciones cross-tenant (KPIs internos, soporte) y en la superficie de riesgo por bug de aislamiento.

## Decisión

Se adopta row-level multi-tenancy. Cada tabla del dominio incluye una columna `tenantId` que referencia a `Tenant`. El filtrado por tenant no se delega al consumidor de la API: el `tenantId` se inyecta desde el contexto autenticado (extraído del JWT) y los servicios del backend lo aplican antes de cualquier consulta a Prisma.

Para minimizar el riesgo de olvido, se implementa un guard global (`TenantGuard`) que valida la presencia del `tenantId` en el contexto y un wrapper sobre el cliente Prisma que sobreescribe los métodos de lectura/escritura más comunes para inyectar el filtro automáticamente. Los repositorios manuales siguen el mismo patrón.

## Alternativas consideradas

- **Schema-per-tenant**: ofrece aislamiento más fuerte sin esfuerzo en cada query, pero complica las migraciones (hay que aplicarlas a N schemas), encarece el monitoreo y dificulta los reportes internos cross-tenant. El plan de catálogo de inmobiliarias del MVP no justifica esa rigidez.
- **Database-per-tenant**: aislamiento máximo, pero impone provisionar y administrar tantas bases como inmobiliarias. En Railway el costo escala linealmente, lo cual es inviable para un MVP académico y deja sin solución sencilla la sincronización del esquema.

## Consecuencias

Positivas:

- Una sola base de datos a administrar, con backups y migraciones unificados.
- Las consultas cruzadas para soporte interno o reportes globales (sin exponerse a tenants) son triviales.
- El costo operativo en Railway se mantiene bajo durante el MVP.
- La incorporación de una nueva inmobiliaria es instantánea: alta de un registro en `Tenant`, sin provisionar infraestructura.

Negativas:

- El aislamiento depende de la correcta aplicación del filtro `tenantId` en cada query. Un bug en un servicio puede filtrar datos entre inmobiliarias.
- Cualquier consulta a Prisma escrita sin pasar por el wrapper representa un riesgo; se mitiga con guards, revisión por pares y pruebas e2e que validan acceso cruzado.
- Las consultas pueden volverse más caras a medida que crece la cantidad de tenants; se exige indexar `tenantId` en cada tabla y, donde aplique, generar índices compuestos (`tenantId`, columna de filtro).

## Riesgos y mitigaciones

- **Riesgo**: un endpoint nuevo se implementa sin filtrar por `tenantId` y un agente de una inmobiliaria recupera datos de otra. **Mitigación**: pruebas e2e de Playwright con dos tenants ficticios que recorren los endpoints sensibles y verifican respuestas 403/404; revisión obligatoria de PR sobre cualquier archivo bajo `apps/api/src/modules/**`.
- **Riesgo**: una migración masiva (por ejemplo, recálculo de punitorios) actualiza filas sin restringir por tenant. **Mitigación**: los scripts batch reciben el `tenantId` como argumento obligatorio o iteran tenant por tenant.
- **Riesgo**: un agente con acceso a más de una inmobiliaria recibe un JWT con el `tenantId` equivocado. **Mitigación**: el endpoint de switch de tenant emite un nuevo JWT y rota el refresh token.
