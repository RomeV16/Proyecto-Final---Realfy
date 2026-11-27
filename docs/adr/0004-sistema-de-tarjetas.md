# ADR-0004: Sistema de tarjetas para pantallas con registros repetidos

## Estado

Aceptado.

## Fecha

2026-08-13.

## Contexto

Toda pantalla que lista registros (propiedades, personas, contratos,
liquidaciones, pagos, morosidad, tickets, proveedores, notificaciones y el
portal del inquilino) resolvía por su cuenta la tarjeta, el esqueleto de carga
y el estado vacío. Eso trajo tres problemas:

1. **Cuatro convenciones de carga distintas.** Cada archivo tenía su propio
   `CardSkeleton` copiado y su propio `{loading && …}{!loading && …}`. Como las
   dos ramas podían renderizarse en el mismo frame, el cambio de esqueleto a
   contenido producía un parpadeo y un salto de layout.
2. **Listas que se leían como paredes de texto.** Solo las propiedades tienen
   fotos en el modelo de datos; contratos, liquidaciones, pagos y proveedores no
   tienen ningún campo de imagen, así que sus listados eran filas grises sin
   ningún anclaje visual.
3. **Color de estado inconsistente.** Las chapas de estado usaban clases sueltas
   de la paleta de Tailwind (`emerald-100`, `blue-700`), que no siguen ni el
   modo oscuro ni la paleta cálida del sistema de diseño.

## Decisión

Se incorpora un vocabulario compartido en `apps/web/src/components/ui/`:

| Pieza | Rol |
|---|---|
| `EntityCard` / `EntityRow` | La tarjeta de registro y su variante horizontal |
| `CardGrid` / `RowList` | Contenedores: son dueños de la transición entre carga, contenido y vacío |
| `EntityCover` / `GeneratedCover` / `SmartImage` | Portadas: foto real, o arte generado a partir del id |
| `Avatar` | Identidad de personas y proveedores (no tienen foto) |
| `ProgressRing` / `Sparkline` / `Meter` / `TrendDelta` | Marcas de datos que le dan peso informativo a las tarjetas sin foto |
| `StatTile` | Métrica accionable, con acceso directo al listado que la explica |
| `Badge` | Chapa de estado, derivada de los tokens `--color-*` |
| `EmptyState` | Estado vacío con un llamado a la acción y pasos numerados |
| `Skeleton` / `EntityCardSkeleton` / `CardGridSkeleton` | Placeholders con la forma de la tarjeta real |
| `StaggerItem` / `ListTransition` / `ValueFlip` | Primitivas de movimiento |

### Identidad vs. estado

La identidad la da la portada. Los registros sin foto reciben un degradado,
una textura y un ícono fantasma derivados de su id (`lib/entity-visuals.ts`),
de modo que el mismo contrato se ve siempre igual y una grilla se lee como un
conjunto de objetos distintos.

El estado lo dan la chapa y la barra de acento lateral. Mantenerlos
separados es lo que permite que el color siga siendo informativo mientras la
identidad varía.

### Portada vs. banda

Una portada `aspect-[3/2]` tiene sentido cuando hay una foto real: propiedades,
y solo propiedades. Para el resto, esa misma proporción son 300px de degradado
vacío. Por eso `EntityCard.Cover` acepta `band`: una banda corta que conserva el
color de identidad y la repisa de chapas, y le devuelve el alto al contenido.

## Reglas

1. Nunca escribir a mano los tres estados: `CardGrid` / `RowList` los resuelven
   con un cross-fade, sin parpadeo.
2. El esqueleto imita la forma de la tarjeta real, así el cambio no mueve el
   layout.
3. Primera carga y recarga son distintas: `loading={loading && !data}` muestra
   esqueletos; `busy={loading && !!data}` atenúa el contenido existente.
4. Cada tarjeta dice cuál es su próxima acción (`.Alert` para lo que está
   trabado, `.Action` para el llamado a la acción). Un listado tiene que servir
   como lista de tareas.
5. Los spinners son para acciones; los esqueletos, para contenido.
6. El escalonado de entrada está topeado en 360 ms para que las listas largas no
   se sientan lentas.
7. Todo el movimiento respeta `prefers-reduced-motion`.

## Consecuencias

- Una pantalla nueva de listado se arma componiendo, no copiando: contenedor,
  tarjeta y estado vacío ya existen.
- Las tablas financieras (morosidad) siguen siendo tablas reales en escritorio,
  porque ahí la alineación de columnas comunica; abajo de `md` colapsan a una
  pila de tarjetas con el mismo lenguaje.
- `SmartImage` se queda con un `<img>` plano en lugar de `next/image`: las URLs
  de media son enlaces firmados que se generan por request, así que el host no
  se conoce en build time y `images.remotePatterns` no puede cubrirlo.

## Addendum (27/11/2026): tarjetas para propiedades, estructuras propias para el resto

Con el sistema en uso, casi todos los listados terminaron siendo la misma grilla
de tarjetas con portada generada, y eso escondía que cada pantalla sirve para una
tarea distinta. Se decide:

- Las tarjetas con portada quedan para las propiedades, que son las únicas con
  fotos en el modelo de datos.
- Los listados de dinero y de trabajo usan la estructura que corresponde a su
  tarea: libro por mes con totales (liquidaciones), extracto por día (pagos),
  libro con saldo por fila y arqueo (caja), planilla (centro de carga), cola con
  la próxima gestión (cobranza), tramos de antigüedad (morosidad), agenda
  (vencimientos) y tablero por tenedor (llaves). Contratos, personas, proveedores,
  tickets y leads pasan a listas de filas.
- Los tokens de color y tipografía, los estados de carga y vacío y las chapas de
  estado de este ADR siguen vigentes para todas las pantallas.

El resto del ADR se conserva como registro de la decisión original.
