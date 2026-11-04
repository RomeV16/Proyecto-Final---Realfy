# Métricas y análisis estático

Versión 1.3 — 4 de noviembre de 2026 (1.0: 20 de octubre; 1.1: 28 de octubre; 1.2: 3 de noviembre). Todos
los números salen de una ejecución identificable (commit, ejecución del pipeline o
análisis de SonarCloud). La medición del 4 de noviembre reemplaza a la del 3 como la
vigente y esta se conserva debajo, para ver la evolución. Las secciones que siguen a
«Medición del 3 de noviembre de 2026» son las del TP de calidad sobre el módulo de
índices y se conservan como estaban: muestran el antes y el después de ese trabajo.

## Medición del 4 de noviembre de 2026 (piloto, con la oleada 6)

Medición sobre `main` en el commit `c7b3eac` (pantalla de boletas recibidas, #229), el
último integrado cuando se tomó la medición, con las seis oleadas de desarrollo y la
oleada 6 de migración y boletas. Es la misma medición de la tabla única de cifras del
informe final (`../tesis/29-informe-final.md`, sección 9.10), con la misma regla: cada
número sale de una ejecución identificable y todo lo que no se pudo medir figura como
no medido. Lo integrado después (#197, #199, #234 y #242) no está incluido; el #197 se
integró mientras se medía.

### Pruebas y cobertura (integración continua)

Fuente: ejecución [41762887734](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41762887734)
del flujo CI sobre `main` en `c7b3eac`, cancelada al final por el empuje de un pedido posterior (#197): los ocho trabajos que alcanzaron a correr terminaron en verde y solo SonarCloud no llegó a correr. A diferencia de la medición
del 3 de noviembre, las cifras salen de la ejecución sobre `main` misma y no de la de un
pedido de árbol idéntico.

| Métrica | 3 nov (`a2ea7d9`) | 4 nov (`c7b3eac`) | Interpretación |
|---|---|---|---|
| Pruebas unitarias de la API | 2.419 en 186 archivos | 2.721 en 203 archivos | Las suman la obtención automática de boletas (lectores de PDF con documentos sintéticos y circuito), el importador de servicios y las correcciones del ensayo general |
| Pruebas del paquete compartido | 1.040 en 45 archivos | 1.087 en 47 archivos | |
| Pruebas de la aplicación web | 1.611 en 141 archivos | 1.688 en 148 archivos | Pantalla de boletas recibidas, formulario de servicios y estabilización de una prueba de formulario (#237) |
| Pruebas de integración de la API | 829 en 60 archivos | 916 en 65 archivos | Trabajo «API E2E Tests» |
| Cobertura de la API: líneas, sentencias, funciones, ramas | 80,30 %, 80,35 %, 81,56 %, 71,79 % | 80,97 %, 81,03 %, 82,05 %, 73,07 % | Sube pese a las 25 correcciones y al módulo nuevo; el piso de CI sigue en 38 % y 27 % |
| Cobertura de líneas de la web | 78,52 % | 79,12 % | |
| Cobertura de líneas del paquete compartido | 73,37 % | 74,08 % | |
| Cobertura del módulo `index-data` | 96,98 % de líneas, 88,62 % de ramas | 97,15 % de líneas, 88,43 % de ramas | Sigue sobre la meta del TP (80 % y 70 %); trabajo «test:modulo» de la misma ejecución |

### SonarCloud

Fuente: último análisis de `main` en SonarCloud, sobre `6b16803` (el anterior a `c7b3eac`, cuyo análisis no llegó a correr; #229 solo cambia la web), del 4 de noviembre de 2026, 02:42 UTC, que
combina la cobertura de las pruebas unitarias y de integración (consulta a la API
pública de SonarCloud sobre la rama `main`).

| Métrica | 3 nov (`ba78a78`) | 4 nov (`6b16803`) | Interpretación |
|---|---|---|---|
| Líneas de código | 104.918 | 111.588 | Crece con la oleada 6 |
| Cobertura (unitarias e integración) | 82,9 % (líneas 81,7 %, ramas 87,1 %) | 83,4 % (líneas 82,7 %, ramas 85,3 %) | Es la cifra que usa el quality gate |
| Bugs | 38, rating C | 38, rating C | Los heredados siguen sin atacarse; el gate bloquea los nuevos |
| Vulnerabilidades | 1, rating B | 1, rating B | Una abierta por revisar |
| Code smells | 1.386, rating A | 1.468, rating A | Crecen con el tamaño; la deuda estimada sigue en rating A |
| Duplicación | 1,2 % | 1,2 % | |
| Puntos sensibles de seguridad revisados | 100 % | 100 % | |
| Quality gate | en verde | en verde | |

### Código muerto y duplicación por paquete

Fuente: ejecución 41762887734, trabajo «Gates: código muerto y duplicación» (jscpd 4.3.0
con 70 tokens y 5 líneas mínimas, sin pruebas; knip 5.88.1).

| Paquete | 3 nov: duplicado (clones, archivos) | 4 nov: duplicado (clones, archivos) | Umbral del gate |
|---|---|---|---|
| api | 1,01 % (39, 334) | 0,98 % (41, 363) | 2,6 % |
| web | 1,74 % (98, 651) | 1,69 % (98, 678) | 2,3 % |
| shared | 0,54 % (9, 99) | 0,56 % (9, 101) | 1,8 % |

Los umbrales del gate siguen sin bajarse aunque la duplicación medida está muy por
debajo; la oleada 6 sumó código sin empujarla.

### Métrica de proceso: defectos del piloto

Del 30 de octubre al 4 de noviembre se registraron sesenta defectos en `main`
(DEF-09 a DEF-176, contados sobre `dd8b22b`, que ya incluye #242): un bloqueante,
veinticinco de severidad alta, veinticinco media y nueve baja. Los treinta y uno que
se sumaron desde la medición anterior salen de cuatro orígenes: veinticuatro de los
ensayos generales del ciclo sobre una copia de la cartera (DEF-115 a DEF-143 y DEF-173
a DEF-176), tres de la verificación del reparto por consumo (DEF-105 a DEF-107), dos de
la revisión de la recepción de mails (DEF-170 y DEF-171) y dos de la prueba del motor
de plantillas (DEF-110 y DEF-111). Ninguno proviene del uso real: los ensayos los corre
el equipo sobre una copia, con los procesos programados apagados. Todos se cerraron con
su prueba de regresión en rojo primero.

La métrica del TP, el tiempo entre la detección y la regresión en verde, se puede
medir ahora de forma aproximada, porque el issue de estos defectos se abrió al triar el
informe del ensayo y no junto con el pedido que los corrige. Del issue a la integración
del pedido pasaron entre 1,0 y 6,4 horas (mediana 2,6) en los veinticinco defectos
anteriores a #242 (veinticuatro issues; fuente: fechas de apertura de los issues y de integración de los
pedidos de la API de GitHub). Es una cota inferior del tiempo desde la detección:
la hora en que el ensayo encontró cada uno no se registró aparte. Desde el C1 se
registra con la hora de detección (`12-piloto.md`, sección 5).

### Métrica de proyecto: el pipeline

Fuente: historial de ejecuciones del flujo CI por empuje a `main` desde el 30 de octubre
(23:16 UTC) hasta la de `c7b3eac` del 4 de noviembre (consulta con `gh run list`).

| Métrica | Valor | Meta | Interpretación |
|---|---|---|---|
| Ejecuciones sobre `main` | 67: 48 en verde, 16 canceladas por un empuje posterior y 3 en rojo | Toda ejecución en rojo explicada | Cumplida. Los dos rojos nuevos (`820ae5a` y `37b9e22`) son la misma prueba de pantalla de la web (`operational-defaults-form.test.tsx`, «Test timed out in 5000ms»), que se acercaba al tope de 5 s y en el runner lo superaba; se corrigió en #237. Es una prueba inestable, no un defecto del producto. El rojo anterior fue otra prueba de la web (ver la medición del 3 de noviembre) |
| Duración del pipeline completo | De 25 a 35 minutos en las ejecuciones en verde del 3 y 4 de noviembre | < 15 minutos | **No cumplida**, y empeora: 23 a 30 minutos el 3 de noviembre, 25 a 35 el 4 |
| Duración del trabajo de integración | 17,8 a 24,9 minutos en las siete últimas ejecuciones en verde; 24,9 en `6b16803` | Tope declarado de 25 minutos | **En el límite.** Con el ritmo de crecimiento actual el tope se supera con el próximo pedido grande |

La duración del trabajo de integración alcanzó el tope declarado: la medición del 3 de
noviembre ya lo había marcado como riesgo y no se aplicó ninguna de las dos opciones
(repartir la suite de integración en varios trabajos con una base cada uno, o acotar
la limpieza entre casos a las tablas que cada archivo usa). Pasa a ser la deuda de
proceso más urgente.

### Métricas del piloto

Las métricas de uso real —diferencias de reconciliación, tiempo del ciclo, valoración
de uso, atraso del estado de cuenta, errores de carga y tiempo de detección a
corrección— están definidas en `12-piloto.md`, sección 7, con sus metas. Sus valores
quedan **a completar tras el ciclo C1 (≈ 20/11/2026)** para la línea base y el primer
ciclo, y tras el C2 (≈ 20/12/2026) y el C3 (≈ 20/01/2027) para la evolución. Se
publican agregadas y solo con el consentimiento de la inmobiliaria. Lo que sí existe
es la coincidencia estimada del C1 por los dos ensayos generales (`12-piloto.md`,
sección 10), cuyos porcentajes figuran como «a completar tras el consentimiento de la
inmobiliaria». Es una estimación sobre supuestos, no un resultado.

## Medición del 3 de noviembre de 2026 (piloto)

Medición sobre `main` en el commit `a2ea7d9` (integración de la bandeja de
consultas, #183, con la que quedaron entregadas las seis oleadas de desarrollo), con
el piloto en una inmobiliaria real en curso. Es la misma
medición de la tabla única de cifras del informe final
(`../tesis/29-informe-final.md`, sección 9.10); acá se agregan las métricas de
calidad que el informe no detalla. La referencia «antes» es el cierre del TP
(`ac07cdf`, 28 de octubre) o el análisis del 19 de octubre cuando así se indica.

### Pruebas y cobertura (integración continua)

Fuente: ejecución [41591721662](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41591721662)
del pedido #183, sobre `5c6ca93`, cuyo árbol es idéntico al de `a2ea7d9`; todos sus
trabajos en verde. La ejecución sobre `main`
([41595020268](https://github.com/RomeV16/Proyecto-Final---Realfy/actions/runs/41595020268))
falló en una prueba de pantalla de la web que en el pedido había pasado (ver
«Métrica de proyecto»), y por eso no corrieron la integración ni SonarCloud; sus
unitarias de la API y del paquete compartido coinciden con las de esta tabla.

| Métrica | Antes (`ac07cdf`, 28 oct) | Ahora (`a2ea7d9`, 3 nov) | Interpretación |
|---|---|---|---|
| Pruebas unitarias de la API | 807 | 2.419 en 186 archivos | Crecieron con cada ítem del piloto; cada motor de dinero tiene pruebas de valores conocidos |
| Pruebas del paquete compartido | 48 | 1.040 en 45 archivos | Incluyen los motores puros y la reconciliación con los motores (CP-663 a CP-665) |
| Pruebas de la aplicación web | No había | 1.611 en 141 archivos | vitest, con pantallas renderizadas en jsdom |
| Pruebas de integración de la API | 491 | 829 en 60 archivos | Incluyen la reconciliación por la API (CP-666 y CP-667) |
| Cobertura de la API: líneas, sentencias, funciones, ramas | 44,48 %, 44,36 %, 45,77 %, 34,50 % | 80,30 %, 80,35 %, 81,56 %, 71,79 % | El piso de CI sigue en 38 % y 27 %: es una alarma contra regresiones, no una meta |
| Cobertura de líneas de la web | — | 78,52 % | Medida desde que la web tiene pruebas (#106) |
| Cobertura de líneas del paquete compartido | — | 73,37 % | Primera medición con el paquete en el análisis (#106) |
| Cobertura del módulo `index-data` | 96,63 % de líneas, 92,70 % de ramas | 96,98 % de líneas, 88,62 % de ramas | Sigue sobre la meta del TP (80 % y 70 %); las ramas bajaron cuatro puntos con el código que el piloto sumó al módulo, como la aplicación masiva de ajustes |

### SonarCloud

Fuente: último análisis de `main`, sobre `ba78a78` (el commit anterior, con la
cobranza escalonada), del 3 de noviembre de 2026, 06:35 UTC, que combina la
cobertura de las pruebas unitarias y de integración. El análisis de `a2ea7d9` no
corrió porque la ejecución de `main` falló antes; el del pedido #183 pasó el quality
gate.

| Métrica | 19 oct (`2eb2fa7`) | 3 nov (`ba78a78`) | Interpretación |
|---|---|---|---|
| Líneas de código | 82.136 | 104.918 | El piloto agregó cinco dominios nuevos; la limpieza de código muerto quitó unas 4.300 líneas (#115) |
| Cobertura (unitarias e integración) | — | 82,9 % (líneas 81,7 %, ramas 87,1 %) | Es la cifra que usa el quality gate; la de la tabla anterior es solo la unitaria |
| Bugs | 41, rating C | 38, rating C | Bajaron poco: el gate bloquea los nuevos, pero los heredados no se atacaron. Queda como deuda declarada |
| Vulnerabilidades | 42, rating E | 1, rating B | Las 40 de `ci.yml` se corrigieron en el TP; queda una abierta por revisar |
| Code smells | 818, rating A | 1.386, rating A | Crecieron con el tamaño; la deuda estimada sigue en rating A |
| Duplicación | 5,1 % | 1,2 % | Efecto de la limpieza (L1 a L6) y del gate de jscpd |
| Puntos sensibles de seguridad revisados | — | 100 % (ninguno abierto) | |
| Quality gate | en verde sobre el PR #76 | en verde | |

### Código muerto y duplicación por paquete

Fuente: ejecución 41591721662, trabajo «Gates: código muerto y duplicación»
(jscpd 4.3.0 con 70 tokens y 5 líneas mínimas, sin pruebas; knip 5.88.1).

| Paquete | 31 oct: duplicado (clones) | 3 nov: duplicado (clones, archivos) | Umbral del gate |
|---|---|---|---|
| api | 2,32 % (42) | 1,01 % (39, 334) | 2,6 % |
| web | 1,93 % (60) | 1,74 % (98, 651) | 2,3 % |
| shared | 1,11 % (6) | 0,54 % (9, 99) | 1,8 % |

knip: sin hallazgos nuevos y con la línea base vacía. Los umbrales del gate no se
bajaron todavía aunque la duplicación medida quedó muy por debajo; bajarlos es la
forma de que la mejora no se pierda.

### Métrica de proceso: defectos del piloto

Del 30 de octubre al 3 de noviembre se registraron veintinueve defectos en `main`
(DEF-09 a DEF-95): once de severidad alta, catorce media y cuatro baja. Ninguno
proviene del uso real. Todos se cerraron con su prueba de regresión en rojo primero,
y la evidencia de DEF-09 a DEF-23 (commits y ejecuciones en rojo y en verde) está en
el PR #138.

La métrica del TP —días entre la detección y la regresión en verde— no se puede
calcular igual para el piloto, y conviene decir por qué: el issue de cada defecto se
abrió junto con el pedido que lo corrige, así que la diferencia entre su apertura y
su cierre mide el ciclo de revisión (entre 0 y 2 horas en los veintinueve casos) y no
el tiempo desde la detección. La fecha de detección no quedó registrada aparte. Se
corrige desde el C1: cada diferencia de la reconciliación en campo se registra
dentro de las 24 horas con su fecha de detección (`12-piloto.md`, sección 5), y esa
es la fecha contra la que se mide la corrección.

### Métrica de proyecto: el pipeline

Fuente: historial de ejecuciones del flujo CI por empuje a `main` desde el 30 de
octubre (23:16 UTC) hasta la de `a2ea7d9` del 3 de noviembre.

| Métrica | Valor | Meta | Interpretación |
|---|---|---|---|
| Ejecuciones sobre `main` | 50: 38 en verde, 11 canceladas por un empuje posterior y 1 en rojo | Toda ejecución en rojo explicada | Cumplida, con una salvedad: el rojo de `a2ea7d9` es una prueba de pantalla de la web (`contract-parties.test.tsx`, «sin poderes vigentes muestra el vacío») que pasó en el pedido sobre el mismo árbol. Es una prueba inestable, no un defecto del producto, y queda para corregir: una prueba que falla al azar entrena a ignorar el rojo |
| Duración del pipeline completo | De 11 a 14 minutos el 31 de octubre; de 23 a 30 minutos el 3 de noviembre | < 15 minutos | **No cumplida.** La duración creció con la suite de integración, que corre en un solo trabajador contra una base compartida |
| Duración del trabajo de integración | 16,5 minutos en `ba78a78`, 21 en el pedido #181 y 22 en el #183 | Tope declarado de 25 minutos | Margen chico: con el ritmo de crecimiento actual, el tope se alcanza en pocas oleadas |

La duración es el hallazgo de esta medición. Las opciones son repartir la suite de
integración en varios trabajos con una base cada uno, o acotar la limpieza entre
casos a las tablas que cada archivo usa. Ninguna se aplicó todavía; se registra
como riesgo del proceso.

### Métricas del piloto

Las métricas de uso real —diferencias de reconciliación, tiempo del ciclo,
valoración de uso, atraso del estado de cuenta, errores de carga y tiempo de
detección a corrección— están definidas en `12-piloto.md`, sección 7, con sus
metas. Sus valores quedan a completar tras el ciclo C1 (≈ 20/11/2026) para la línea
base y el primer ciclo, y tras el C2 (≈ 20/12/2026) y el C3 (≈ 20/01/2027) para
la evolución. Se publican agregadas y solo con el consentimiento de la
inmobiliaria.

## Métricas de producto (SonarCloud + Jest)

| Métrica | Qué mide | Antes (`main` 2eb2fa7, 19 oct) | Después | Interpretación |
|---|---|---|---|---|
| Líneas de código del repositorio | Tamaño | 82.136 | | Referencia; no es objetivo subirlas ni bajarlas |
| Bugs (repositorio) | Errores probables detectados estáticamente | 41, rating C | Código del PR: 0 bugs, rating A (PR #76) | Ninguno en `index-data`; los del repositorio quedan fuera de alcance salvo los que el gate bloquee como nuevos |
| Vulnerabilidades (repositorio) | Problemas de seguridad | 42, rating E | Código del PR: 0, rating A; las 40 de `ci.yml` desaparecen al mezclar | 40 de 42 están en `ci.yml`: acciones sin SHA y `npx` sin versión. Se corrigen el día 2 |
| Code smells (repositorio) | Deuda de mantenibilidad | 818, rating A | Código del PR: 3 | Rating A pese al número: la deuda estimada es baja respecto del tamaño |
| Duplicación (repositorio) | Líneas duplicadas | 5,1 % | Código del PR: 2,4 %; sobre código nuevo 0,0 % | Justo sobre el 5 % que el TP pone como tope; dentro del módulo la duplicación `preview`/`applyDueAdjustments` se elimina el día 5 |
| Cobertura de líneas, API completa | Sentencias ejecutadas por las unitarias | 42,44 % (commit 98e34b7, informe de tesis) | 44,05 % (día 3, local) | Piso en CI: 38 % |
| Cobertura de líneas, módulo `index-data` | Ídem, acotado | 44,89 % | 94,81 % (día 3), 96,47 % (día 5), 96,63 % (DEF-07/08) | Meta 80 % |
| Cobertura de ramas, módulo | Decisiones ejecutadas | 25,26 % | 86,31 % (día 3), 92,04 % (día 5), 92,70 % (DEF-07/08) | Meta 70 %. Es la métrica que más dice sobre la lógica de CU-08 |
| Cobertura de funciones, módulo | | 46,93 % | 95,65 % (día 3) | |
| Pruebas unitarias del módulo | Cantidad de casos | 18 | 107 (día 5), 111 (DEF-07/08) + 18 del motor en el paquete compartido | |
| Pruebas de integración del módulo | Cantidad de casos | 17 | 21 (día 5) + 5 de contrato real; CP-58 en la suite de contratos | |

### SonarCloud sobre el PR #76 (análisis desde el pipeline, con cobertura)

| Métrica | Valor | Condición del gate |
|---|---|---|
| Líneas analizadas del PR | 1.371 | — |
| Cobertura sobre código nuevo | 97,3 % | ≥ 80 % ✔ |
| Bugs nuevos | 0 (rating A) | rating A ✔ |
| Vulnerabilidades nuevas | 0 (rating A) | rating A ✔ |
| Duplicación sobre código nuevo | 0,0 % | ≤ 3 % ✔ |
| Hotspots revisados | 100 % | 100 % ✔ |
| **Quality gate** | **en verde** | |

Las cifras del repositorio completo (41 bugs, 42 vulnerabilidades) son las
de `main` y cambian recién al mezclar el PR; el análisis del PR muestra
que el trabajo no agrega ninguna y que la corrección de `ci.yml` elimina
las 40 que estaban ahí.

## Código muerto y duplicación por paquete (gates knip y jscpd)

Medición del 31 de octubre de 2026 sobre `main` con la limpieza de código muerto
aplicada (jscpd 4.3.0 con 70 tokens y 5 líneas mínimas, sin pruebas ni mocks;
knip 5.88.1). Detalle y política en `08-herramienta-sonarcloud.md`.

| Paquete | Líneas duplicadas | Clones | Umbral del gate |
|---|---|---|---|
| api | 2,32 % | 42 | 2,6 % |
| web | 1,93 % | 60 | 2,3 % |
| shared | 1,11 % | 6 | 1,8 % |

| Hallazgos de knip | Antes (análisis de octubre) | Ahora |
|---|---|---|
| Archivos sin uso | 7 | 0 |
| Exports de valor sin uso | 25 | 1 (en la línea base) |
| Dependencias sin uso | 9 | 0 |

## Métrica de proceso

**Tiempo entre la detección de un defecto y su prueba de regresión en
verde.** Se mide por defecto en `06-registro-de-defectos.md` con las fechas
del issue y del PR. Meta: todos los defectos del TP cerrados dentro del
cronograma (≤ 4 días desde la detección). Es una métrica de proceso porque
describe cómo trabaja el equipo, no el producto.

| Defecto | Detectado | Prueba en rojo | Corrección en verde | Días |
|---|---|---|---|---|
| DEF-01 | 19 oct | 20 oct (run 39336742449) | 20 oct | 1 |
| DEF-02 | 19 oct | 20 oct | 20 oct | 1 |
| DEF-03 | 19 oct | 20 oct | 20 oct | 1 |
| DEF-04 | 19 oct | — (código muerto) | 20 oct | 1 |
| DEF-05 | 19 oct (sospechado), 20 oct (confirmado) | 20 oct | 20 oct | 1 |
| DEF-06 | 19 oct (prueba contra entorno real) | 20 oct | 20 oct | 1 |
| DEF-07 | 28 oct (datos de la demostración) | 28 oct (run 40804485827) | 28 oct | 0 |
| DEF-08 | 28 oct (revisión del barrido al corregir DEF-07) | 28 oct (run 40804485827) | 28 oct | 0 |

## Métrica de proyecto

**Duración del pipeline completo y tasa de ejecuciones en verde.** Se toma
del historial de GitHub Actions de la rama `tp-calidad`. Meta: < 15 minutos
y toda ejecución en rojo explicada por un defecto real o por una
dependencia externa (R-07).

| Ejecución | Fecha | Disparador | Duración | Resultado | Causa si rojo |
|---|---|---|---|---|---|
| 39332025846 | 19 oct | PR #76, día 1 (2ad0d7b) | — | cancelada por el push siguiente | — |
| 39332624038 | 19 oct | día 2 (5abf962) | — | cancelada por el push siguiente | — |
| 39333479276 | 19 oct | día 3 (344010d) | ~12 min | **verde** (8 trabajos) | — |
| 39336402384 | 19 oct | día 4 (d1e2ff0) | — | cancelada por el push siguiente; `integration-real` y `sonar` en verde antes de cancelarse | — |
| 39336742449 | 19 oct | regresión en rojo (27a5d92) | ~3 min | **rojo** | 8 casos nuevos fallan contra el código con DEF-02, 03, 05 y 06: defecto real |
| 39337428907 | 19 oct | correcciones (b6e9eca) | ~2 min | **rojo** | `contract-closure-trigger.spec.ts` construye `ContractsService` por el inyector y no tenía el proveedor nuevo `IndexDataService`: doble de prueba faltante, no defecto de producto |
| 39337763326 | 19 oct | doble + k6 (58de3d1) | 7 min | **rojo** en el paso de stress | 7 trabajos en verde; el stress corrió completo sin errores y el p95 (720 ms) superó el umbral de 500 ms en el runner compartido. Ver `10-stress.md` |
| 39339533616 | 19 oct | mejoras medidas (bcf3f83) | 6 min | **verde** (8 trabajos) | Ejecución completa en verde: smoke, stress (p95 8,8 ms), contrato real y gate incluidos |
| 40804485827 | 28 oct | PR #85, regresión en rojo (0cfa450) | ~1 min | **rojo** | 3 casos nuevos fallan contra el código con DEF-07 y DEF-08: defecto real |
| 40804889473 | 28 oct | PR #85, corrección (a1591b4) | 7 min | **rojo** solo en `integration-real` | 7 de 8 trabajos en verde, CP-55 a CP-58 incluidos. CP-52 falla por frescura: la API de series del INDEC no publica desde julio (último dato 2026-07-01, 120,09 días contra un tope de 120). Externo (R-07), no defecto propio |

La clasificación de la ejecución 40804889473 se revisó el 30 de octubre: el
INDEC sí había publicado agosto y septiembre, y lo que faltaba venía de la API
de series de datos.gob.ar, que con `sort=desc` omite el último mes y va un mes
atrás del CSV. La causa es externa, pero el módulo la dejaba pasar porque solo
iba al CSV si la API fallaba. Se corrigió cambiando la fuente del IPC, sin
tocar el tope de CP-52 (`07-integracion-externa.md`, última sección).

## Mejora medida antes y después

Se eligió una mejora que se pueda medir con el mismo instrumento antes y
después: **la cobertura de ramas del módulo**, porque es la que refleja si
la tabla de decisión de CU-08 está realmente ejercitada.

| Momento | Líneas | Ramas | Funciones | Pruebas | Instrumento |
|---|---|---|---|---|---|
| Antes (2eb2fa7) | 44,89 % | 25,26 % | 46,93 % | 18 | `pnpm --filter @realfy/api test:modulo` |
| Después (día 3, 20 oct) | 94,81 % | 86,31 % | 95,65 % | 91 | mismo comando, misma máquina; piso del módulo subido a 80 / 70 |
| Después (día 5, 20 oct) | 96,47 % | 92,04 % | 98,03 % | 107 | ídem, con las correcciones |

Segunda mejora medida, de desempeño (`10-stress.md`): bajo 50 usuarios
virtuales, p95 del listado 104,6 → 17,4 ms y del último valor 92,8 → 13,3 ms,
tras resolver la unión propia + sistema en SQL y reducir las consultas de
`latest` de diez a dos.

## Hallazgo sobre la suite existente

Al correr la suite unitaria completa de la API en una máquina con zona
horaria America/Argentina/Buenos_Aires fallan 12 casos de tres archivos
fuera del alcance (`reports.service.spec.ts`, `arca-client.factory.spec.ts`,
`arca-ta.manager.spec.ts`). En el pipeline (UTC) pasan. El de reportes pasa
localmente con `TZ=UTC`, lo que confirma que depende de la zona horaria; los
dos de ARCA fallan por otra causa local no investigada. Se reporta como
hallazgo: las pruebas unitarias deberían fijar `process.env.TZ` para ser
reproducibles en cualquier máquina. Las pruebas nuevas del módulo usan
fechas a mediodía UTC por esa razón (ver DEF-05).

Seguimiento al 30 de octubre: Jest fija `TZ=UTC` en un `globalSetup` (CP-73). Con
la zona de Buenos Aires en la shell, la suite completa de la API (807 casos)
dejaba entonces un único caso en rojo, `ReportsService › getCashFlow › arma un
renglon por mes del rango`; los de ARCA ya pasaban. Con el `globalSetup` los 807
pasan en cualquier zona.

## Análisis estático

- **ESLint** corre en el trabajo `lint` sobre los tres paquetes. Estado al
  19 de octubre: 0 errores, advertencias solo en la aplicación web
  (`no-img-element`), fuera de alcance.
- **SonarCloud** corre en el trabajo `sonar` con cobertura. Issues abiertos
  dentro de `apps/api/src/modules/index-data` al 19 de octubre: 0 bugs,
  0 vulnerabilidades; code smells por revisar el día 3 (complejidad
  cognitiva de `applyDueAdjustments` y duplicación con `preview`).
