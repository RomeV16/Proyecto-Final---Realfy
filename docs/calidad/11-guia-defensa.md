# Guía de defensa: preguntas probables y respuestas

Preguntas que un docente puede hacer sobre el TP, con la respuesta corta
que se puede dar de memoria y dónde está la evidencia. Está pensada para
poder responder "qué pruebas hicimos, dónde y para qué".

## Sobre el módulo y el alcance

**¿Por qué eligieron este módulo?**
Porque tiene una integración externa real sin credenciales (BCRA e INDEC),
que se puede probar contra el entorno real en cada ejecución; porque su
lógica es la más delicada de la tesis (el informe advierte sobre confundir
nivel con variación de un índice) y porque tenía una de las coberturas más
bajas de la API: 44,9 % de líneas y 25,3 % de ramas con 18 pruebas.

**¿Qué hace el módulo?**
Obtiene todos los días a las 06:00 los índices ICL y UVA del BCRA y el IPC
del INDEC, los guarda, permite cargarlos a mano, y con ellos calcula el
nuevo alquiler de un contrato según cinco modalidades: IPC, ICL, CCP,
porcentaje fijo y personalizado. Es el caso de uso CU-08 y los requisitos
RF-12, RF-13 y RF-14.

**¿Qué nivel declararon y por qué?**
Nivel 3, prototipo avanzado: la tesis está casi completa, el flujo
principal funciona con integraciones externas y se despliega con Docker.
Las metas de nivel 3 (80 % de cobertura, smoke tras despliegue, E2E con
la integración externa, stress con umbrales) se cumplen sobre el módulo.

## Sobre qué pruebas hicimos y dónde

**¿Qué tipos de pruebas aplicaron?**
Cinco niveles: unitarias (servicios y motor de cálculo con dobles),
integración de API (endpoints por HTTP contra PostgreSQL real),
integración externa (contrato con BCRA e INDEC, con respuestas grabadas y
contra el entorno real), smoke sobre un despliegue nuevo, y carga (stress
y esfuerzo sostenido con k6). Más análisis estático con ESLint y
SonarCloud.

**¿Dónde está cada prueba?**
- Unitarias: `apps/api/src/modules/index-data/*.spec.ts` (107 casos) y
  `packages/shared/src/adjustment-engine/adjustment-engine.spec.ts` (18).
- Integración de API: `apps/api/test/e2e/index-data.e2e-spec.ts` (17) e
  `index-data-scraper.e2e-spec.ts` (4).
- Contrato externo: `apps/api/test/integration/external.contract.spec.ts`
  (fixtures reales) y `external.real.spec.ts` (red real).
- Smoke: `apps/api/test/smoke/smoke.mjs`.
- Carga: `apps/api/test/load/stress.js` y `soak.js`.

**¿Qué prueba una unitaria y qué prueba una de integración acá? Dé un ejemplo de cada una.**
Unitaria: CP-05 verifica que con variaciones de IPC de 2 % y 3 % el
servicio proyecte 105.060 sobre 100.000 (factor 1,0506 y no 1,05); Prisma
y la lectura de índices son dobles. Integración: CP-54 registra una
inmobiliaria, crea un contrato IPC, dispara el refresco con la red
sustituida y pide la previsualización por HTTP: tiene que devolver el
mismo factor 1,0506 usando los índices que el scraper guardó en la base
real. La unitaria prueba la fórmula; la de integración prueba que los
datos lleguen hasta la fórmula.

**¿Para qué sirve la prueba de contrato contra el entorno real si ya tienen dobles?**
Los dobles prueban que nuestro parser hace lo correcto con lo que creemos
que el proveedor manda; la prueba real verifica que el proveedor siga
mandando eso. De hecho fue la que encontró DEF-06: la fixture original de
la tesis tenía valores como 7045,47 (niveles) y la prueba "pasaba" porque
reproducía el mismo malentendido del código. Es la paradoja del pesticida.

**¿Qué es el smoke y cuándo corre?**
Seis pasos sobre una instancia recién desplegada: salud con base
conectada, registro, listado de índices, carga manual, último valor y 401
sin token. Corre en el pipeline después de construir la imagen Docker de
la API y arrancarla con sus migraciones contra una base vacía, en cada
PR y cada push a `main`.

## Sobre las técnicas

**¿Qué clases de equivalencia definieron?**
Por ejemplo, para la cantidad de valores de índice disponibles: vacía (0),
un solo valor (1) y dos o más. Cada clase tiene un comportamiento
esperado distinto: con IPC vacío el alquiler no cambia; con ICL de un solo
valor el factor es 1; con dos o más se encadena o se divide.

**¿Y valores límite?**
Paginación: `page` 0 (inválido) y 1 (válido); `limit` 100 (válido) y 101
(inválido). Precisión: 6 decimales válido, 7 inválido. Fechas: 31 de enero
más un mes tiene que dar 28 de febrero, no 3 de marzo (era DEF-05).

**¿Qué es la tabla de decisión y qué decide?**
Cruza modalidad × datos disponibles × porcentaje declarado en 11 reglas,
con el alquiler esperado calculado a mano antes de ejecutar. Lo que decide
es la regla central del negocio: cómo se calcula el nuevo alquiler. La más
importante es D1 (2 % y 3 % encadenados dan 5,06 %, no 5 %).

**¿Qué diferencia hay entre cobertura de sentencia y de decisión, y cuánto lograron?**
Sentencia: qué porcentaje de instrucciones ejecutaron las pruebas.
Decisión (ramas): qué porcentaje de los caminos de cada `if` o `switch`.
El módulo pasó de 45,9 % / 25,3 % a 96,5 % / 92 %. La de ramas es la que
importa en un `switch` de cinco modalidades.

**¿Qué significa Arrange–Act–Assert?**
Preparar (dobles y datos), ejecutar (una sola llamada) y verificar
(resultado esperado fijado antes). Todas las unitarias nuevas siguen ese
orden y llevan el identificador del caso en el nombre.

## Sobre los defectos

**¿Cuál fue el defecto más importante y cómo lo encontraron?**
DEF-01: el scraper guardaba los índices bajo el identificador
`__system__` y todas las lecturas pasan por el filtro de aislamiento por
inmobiliaria, así que nadie los veía nunca. La función automática corría
todos los días y no servía para nadie. Se encontró leyendo el flujo entre
la escritura y la lectura, y se confirmó con CP-53 y CP-54 en rojo.

**¿Qué es el contraste rojo/verde y dónde está la evidencia?**
Primero se escribe la prueba de regresión y se sube sola: el pipeline la
registra en rojo contra el código viejo (ejecución 39336742449, ocho casos
fallidos). Después entra la corrección y la misma prueba queda en verde.
Así se demuestra que la prueba detecta el defecto y que la corrección lo
cierra.

**¿Cómo trazan un requisito hasta un defecto?**
Issue de requisito (RF-14 es #75) → casos CP-nn en el catálogo con su
archivo y nombre de prueba → issue de defecto (#77) que cita el caso y el
requisito, y se cierra con el commit de la corrección y la regresión.

## Sobre el pipeline y las herramientas

**¿Qué hace el quality gate y qué bloquea?**
Es la condición de SonarCloud que falla el trabajo del pipeline: cero bugs
nuevos, duplicación nueva ≤ 3 %, cobertura sobre código nuevo ≥ 80 %. Es
más estricto que lo pedido (5 %) porque el plan gratuito no permite gates
propios; se usa el incorporado.

**¿Por qué fijaron las acciones por SHA?**
SonarCloud marcó 40 vulnerabilidades en el propio `ci.yml`: acciones
referenciadas por etiqueta (`v4`) y `npx` sin versión fija. Una etiqueta
se puede mover; un SHA no. Fue la primera corrección que salió del
análisis estático.

**¿Por qué el stress falló en el pipeline y pasó en local?**
Porque el runner de GitHub tiene dos vCPU compartidas entre la API, la
base y el generador de carga: p95 de 720 ms contra 104 ms en local, con
cero errores. El umbral de 500 ms es el del ambiente de referencia; en el
pipeline se admite el doble y se publica el valor. Y el dato sirvió: mostró
que `latest` hacía diez consultas por llamada, que es la segunda mejora
medida.

**¿Qué mejora midieron antes y después?**
Dos: la cobertura de ramas del módulo (25,3 % → 92 %, mismo comando) y el
costo del listado y del último valor bajo 50 usuarios, antes y después de
pasar la unión propia + sistema a SQL y de reducir las consultas de
`latest` de diez a dos (números en `10-stress.md`).

**¿Qué pasa si se cae el BCRA?**
El scraper devuelve lista vacía para esa fuente y sigue con las otras, lo
registra, y reintenta al día siguiente; mientras tanto el Admin carga el
valor publicado a mano (RF-14 lo admite) y el cálculo sigue funcionando.
La prueba de contrato real pone el pipeline en rojo para avisar. Está en
el plan de contingencia de `01-objetivos-de-calidad.md`.

## Preguntas incómodas

**¿Usaron IA?** Sí, para borradores de pruebas, scripts y texto. Cada caso
tiene un criterio esperado calculado a mano, y los números del informe
vienen de ejecuciones propias del pipeline y de SonarCloud.

**¿Qué no pudieron hacer?** Desplegar en Railway (sin acceso a la cuenta):
se reemplazó por un despliegue efímero real en el pipeline. Un gate
propio en SonarCloud (plan gratuito). Y la misma suma de meses defectuosa
existe en el módulo de contratos, fuera del alcance: se reporta.

**¿La cobertura del 96 % garantiza que el módulo funciona?** No. Tenía
pruebas en verde y cuatro defectos. Lo que lo encontró fueron las pruebas
que cruzan fronteras: entre componentes, con la base y con el proveedor.
