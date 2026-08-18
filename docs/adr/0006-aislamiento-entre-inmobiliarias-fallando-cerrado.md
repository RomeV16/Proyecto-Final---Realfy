# ADR-0006: El aislamiento entre inmobiliarias falla cerrado

## Estado

Aceptado.

## Fecha

2026-08-18.

## Contexto

El ADR-0003 fijó el aislamiento por row-level: cada tabla del dominio tiene una
columna `tenantId` y toda consulta se filtra por ella. La implementación se apoya
en dos piezas. El contexto de la petición viaja por `AsyncLocalStorage`, con
`nestjs-cls`, y lo llenan las estrategias de Passport después de verificar el
token: la del personal escribe `tenantId`, `userId` y el rol; la del portal
escribe `tenantId`, la persona y una marca de que la petición es del portal. La
segunda pieza es una extensión del cliente de Prisma
(`apps/api/src/common/tenant/prisma-tenant.extension.ts`) que intercepta todas las
operaciones de los modelos con alcance de inmobiliaria e inyecta el filtro:
en el `where` de las lecturas y de las mutaciones, y en el `data` de las
creaciones.

El problema estaba en qué hacía esa extensión cuando **no había** inmobiliaria en
el contexto. La respuesta era: nada. La consulta pasaba tal cual, sin filtro.

Eso es fallar abierto, y es peligroso por cómo se combina con el resto del
diseño. Un endpoint nuevo al que se le olvidó el guard, un servicio invocado
desde un planificador de tareas —donde no hay petición y por lo tanto no hay
contexto—, una llamada disparada desde un `setTimeout` que perdió el contexto
asíncrono: en todos esos casos la consulta no fallaba. Devolvía filas. Devolvía
las filas de **todas** las inmobiliarias, y el código que la llamó las trataba
como si fueran las suyas.

Lo que hace que esto sea difícil de detectar es que no se parece a un error. Un
listado que devuelve más registros de los que corresponde se ve como un listado.
En un ambiente con una sola inmobiliaria cargada —que es la situación normal
durante el desarrollo— es literalmente indistinguible del comportamiento
correcto. El defecto solo se manifiesta cuando hay una segunda inmobiliaria con
datos, es decir, en producción.

La revisión previa a la etapa de pruebas encontró dos lugares donde eso ya estaba
ocurriendo. En el panel, la consulta que resuelve los datos de los emisores
fiscales para el resumen de facturación se hacía por identificador, sin acotar por
inmobiliaria. En el barrido de ajustes de contratos, la búsqueda de valores de
índice dentro de la transacción tampoco acotaba. Ninguno de los dos había fallado
nunca: uno leía por identificadores que ya venían filtrados aguas arriba, y el
otro corría en un ambiente con una sola inmobiliaria.

## Decisión

La extensión falla cerrado. Cuando una operación sobre un modelo con alcance de
inmobiliaria llega sin inmobiliaria en el contexto y sin una exención explícita,
se lanza `TenantIsolationError` en lugar de ejecutar la consulta:

```
if (!tenantId) {
  throw new TenantIsolationError(model, operation);
}
```

`TenantIsolationError` no deriva de `HttpException`, y eso es deliberado. Por el
filtro global del ADR-0005 sale como 500 con código `INTERNAL_ERROR`, que es lo
que corresponde: no es un error del cliente, es un defecto del servidor. El
mensaje que sí llega al registro nombra el modelo y la operación, y explica cuál
de los dos caminos legítimos había que usar.

Porque hay accesos legítimos sin sesión, y la decisión no sirve si no los
contempla. Son de dos clases y tienen su propio mecanismo cada una.

**Trabajo de sistema que abarca varias inmobiliarias**: los planificadores de
tareas —facturación, punitorios, notificaciones, reportes programados, ajustes de
contratos—, la resolución del `slug` del micrositio público y las consultas del
propio micrositio. Estos leen a través de `PrismaService.baseClient`, que es el
cliente sin la extensión, y **cada consulta lleva su filtro explícito**. El
barrido de ajustes, por ejemplo, busca los cronogramas vencidos de todas las
inmobiliarias por `baseClient`, y después acota cada consulta interna por el
`tenantId` del contrato que está procesando. La responsabilidad de filtrar se
vuelve visible en el código en lugar de quedar implícita.

**Flujos donde la inmobiliaria todavía no se conoce**: el ingreso, el registro y
el refresco de sesión, tanto del personal como del portal, más la resolución de
inmobiliaria y algunas operaciones transaccionales de usuarios. Acá la búsqueda
es por correo o por token, no por inmobiliaria, y el filtro no se puede inyectar
porque el valor no existe todavía. Estos usan
`TenantContextService.setBypassTenantFilter(true)`, siempre dentro de un
`try / finally` que lo vuelve a apagar, de modo que la exención dure lo que dura
la operación y no se filtre al resto de la petición.

El guard del micrositio público lleva un comentario que explica por qué lee por
`baseClient`: se ejecuta antes de que exista contexto de inmobiliaria —y nunca va
a existir, porque la petición no tiene sesión—, así que con la extensión la
búsqueda del `slug` sería rechazada de plano.

Junto con el cambio se corrigieron los dos casos que la revisión había
encontrado, y se agregaron pruebas: unitarias sobre la extensión
(`apps/api/test/unit/prisma-tenant.extension.spec.ts`), que verifican la
inyección del filtro operación por operación y que la ausencia de contexto lanza;
y de extremo a extremo (`apps/api/test/tenant-isolation.e2e-spec.ts`), que
recorren endpoints sensibles con dos inmobiliarias y comprueban que ninguna llega
a los datos de la otra.

## Alternativas consideradas

- **Confiar en la revisión por pares y en las pruebas.** Es lo que había, y la
  revisión encontró dos casos ya presentes en código que había pasado revisión.
  El problema no es la falta de atención sino que el fallo es silencioso: no hay
  nada que la revisión pueda ver en la línea que le falta el filtro.
- **Row-Level Security de PostgreSQL.** Es la solución más fuerte: el filtro deja
  de depender de la aplicación y pasa al motor. Se descartó por dos razones
  prácticas. Exige propagar la identidad de la inmobiliaria a la sesión de base
  (`SET LOCAL`) en cada transacción, lo que con un pool de conexiones y el
  cliente de Prisma no es directo; y las políticas quedarían definidas en las
  migraciones, con lo cual el aislamiento se partiría en dos lugares —el esquema
  y la extensión— en vez de uno. Queda como el camino natural si el proyecto
  crece más allá del MVP.
- **Un guard que exija contexto de inmobiliaria en toda petición.** No alcanza:
  el problema aparece justamente donde no hay petición, en las tareas
  programadas. Un guard no cubre lo que no pasa por el ciclo HTTP.
- **Devolver un conjunto vacío en lugar de lanzar.** Sería fallar cerrado sin
  romper nada, pero convierte un defecto en un resultado plausible. Un listado
  vacío se interpreta como "no hay datos", y el bug vuelve a ser invisible. Que
  la operación falle con un error nombrado es precisamente el objetivo.

## Consecuencias

Positivas:

- Un guard olvidado o un contexto perdido dejan de ser una fuga de datos entre
  inmobiliarias y pasan a ser un error 500 con un mensaje que nombra el modelo y
  la operación. El mismo defecto que antes era invisible ahora es ruidoso.
- El acceso de sistema queda declarado. Leer por `baseClient` es una decisión
  explícita que se ve en el diff, y obliga a escribir el filtro a mano al lado.
- La superficie a auditar se reduce a un conjunto acotado y enumerable: los usos
  de `baseClient` y los de `setBypassTenantFilter`. Cualquier otro camino está
  cubierto por la extensión.

Negativas:

- Un olvido en el sentido contrario —usar el cliente con extensión desde una
  tarea programada— ahora rompe la tarea en vez de correr de más. Es el
  intercambio que se busca, pero significa que las tareas programadas hay que
  probarlas: una que falle sigue siendo invisible desde la interfaz.
- Escribir el filtro a mano en el código que usa `baseClient` reintroduce
  localmente el riesgo que la extensión eliminó. La diferencia es que ahora está
  concentrado en unos pocos archivos identificables, no disperso en cualquier
  servicio.
- La lista de modelos con alcance de inmobiliaria está escrita a mano en la
  extensión. Un modelo nuevo con columna `tenantId` que no se agregue a esa lista
  queda sin filtrar y sin protección: la extensión lo deja pasar por no
  reconocerlo. Es la principal deuda que deja esta decisión, y el punto que
  conviene revisar en cada migración que agregue una tabla.
- `RefreshToken` y `PipelineStage` no tienen columna `tenantId` y quedan fuera de
  la lista a propósito: su aislamiento depende de la relación con su padre
  —el usuario y el embudo respectivamente—, que sí está filtrado.
