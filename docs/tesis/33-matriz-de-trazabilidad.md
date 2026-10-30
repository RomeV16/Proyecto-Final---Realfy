# Matriz de trazabilidad

La matriz une cada hallazgo del registro (`31-registro-de-feedback.md`) con el caso de uso que modifica o crea, el ítem del cronograma que lo resuelve, la decisión de arquitectura, el endpoint y los casos de prueba que lo verifican. Es el camino de ida y vuelta de la validación en uso real (ver `30-piloto.md`): de una fricción a su prueba, y de una prueba a la fricción que la justifica.

## Cómo leerla

- **CU.** Si el hallazgo cambia un caso de uso existente de `02-roles-y-casos-uso.md`, se cita su identificador (CU-01 a CU-24) como modificado. Si exige un caso de uso que no existe, dice «CU nuevo»: se numera desde CU-25 en el PR del ítem y esta matriz se actualiza en ese mismo PR.
- **Ítem.** Ítem del cronograma (30 a 46) con su issue, que es el número del ítem más 58 (ver `04-backlog.md`).
- **ADR.** Decisión de arquitectura asociada; el estado de cada una está en `../adr/README.md`. Las que figuran como planificadas todavía no existen.
- **Endpoint.** Se completa en el PR del ítem, cuando los endpoints existen y quedan documentados en `../api.md`.
- **CP.** Rango de casos de prueba reservado en `../calidad/05-casos-de-prueba.md`. El resultado esperado de cada caso se fija antes de ejecutarlo.

## FB, CU, ítem, ADR, endpoint y CP

| FB | CU | Ítem (issue) | ADR | Endpoint | CP |
|---|---|---|---|---|---|
| FB-01 | CU-03, CU-05 (modificados) | 33 (#91) | ADR-0007 | Se completa en el PR | CP-110 a CP-119 |
| FB-02 | CU-03, CU-05 (modificados) | 33 (#91) | ADR-0007 | Se completa en el PR | CP-110 a CP-119 |
| FB-03 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 32 (#90) | — | Se completa en el PR | CP-100 a CP-109 |
| FB-04 | CU-05 (modificado); CU nuevo (se numera desde CU-25 en el PR del ítem) | 39 (#97) | ADR-0015 | Se completa en el PR | CP-170 a CP-179 |
| FB-05 | CU-06 (modificado); CU nuevo (se numera desde CU-25 en el PR del ítem) | 40 (#98) | — | Se completa en el PR | CP-180 a CP-189 |
| FB-06 | CU-10 (modificado); CU nuevo (se numera desde CU-25 en el PR del ítem) | 36 (#94) | ADR-0012 | Se completa en el PR | CP-140 a CP-149 |
| FB-07 | CU-09, CU-11, CU-12 (modificados) | 35 (#93) | ADR-0008 | Se completa en el PR | CP-130 a CP-139 |
| FB-08 | CU-09 (modificado); CU nuevo (se numera desde CU-25 en el PR del ítem) | 35 (#93) | ADR-0008 | Se completa en el PR | CP-130 a CP-139 |
| FB-09 | CU-16, CU-17, CU-18 (modificados); CU nuevo (se numera desde CU-25 en el PR del ítem) | 35 (#93), 42 (#100) | — | Se completa en el PR | CP-130 a CP-139, CP-200 a CP-209 |
| FB-10 | CU-13 (modificado); CU nuevo (se numera desde CU-25 en el PR del ítem) | 37 (#95) | ADR-0009 | Se completa en el PR | CP-150 a CP-159 |
| FB-11 | CU-14 (modificado) | 38 (#96) | — | Se completa en el PR | CP-160 a CP-169 |
| FB-12 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 41 (#99) | — | Se completa en el PR | CP-190 a CP-199 |
| FB-13 | CU-07, CU-08, CU-09 (modificados) | 34 (#92) | ADR-0011 | Se completa en el PR | CP-120 a CP-129 |
| FB-14 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 40 (#98) | — | Se completa en el PR | CP-180 a CP-189 |
| FB-15 | CU-06 (modificado) | 40 (#98) | — | Se completa en el PR | CP-180 a CP-189 |
| FB-16 | CU-05 (modificado) | 40 (#98) | — | Se completa en el PR | — |
| FB-17 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 44 (#102) | — | Se completa en el PR | CP-220 a CP-229 |
| FB-18 | CU-19 (modificado); CU nuevo (se numera desde CU-25 en el PR del ítem) | 43 (#101) | ADR-0013 | Se completa en el PR | CP-210 a CP-219 |
| FB-19 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 44 (#102), 41 (#99) | — | Se completa en el PR | CP-220 a CP-229 |
| FB-20 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 44 (#102) | — | Se completa en el PR | CP-220 a CP-229 |
| FB-21 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 43 (#101) | ADR-0013 | Se completa en el PR | CP-210 a CP-219 |
| FB-22 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 39 (#97) | — | Se completa en el PR | CP-170 a CP-179 |
| FB-23 | CU-08 (modificado) | 34 (#92) | ADR-0011 | Se completa en el PR | CP-120 a CP-129 |
| FB-24 | CU-05 (modificado) | 34 (#92) | — | Se completa en el PR | CP-80 a CP-84 |
| FB-25 | CU-07, CU-08 (modificados) | 34 (#92) | ADR-0011 | Se completa en el PR | CP-51, CP-52 |
| FB-26 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 32 (#90) | — | Se completa en el PR | CP-100 a CP-109 |
| FB-27 | — (fuera del piloto: se mantiene como adjunto) | — | — | — | — |
| FB-28 | CU nuevo (se numera desde CU-25 en el PR del ítem) | 36 (#94) | ADR-0012 | Se completa en el PR | CP-140 a CP-149 |

## Requisitos del informe externo: RF-12, RF-13 y RF-14

El informe externo de calidad numera tres requisitos funcionales sobre el módulo de índices y ajustes (`../calidad/02-plan-de-pruebas.md`). Son anteriores al piloto y se conservan con su numeración; esta tabla los conecta con los ítems, el caso de uso y los casos de prueba.

| RF | Requisito | Issue | CU | Ítem del cronograma | CP (de `../calidad/05-casos-de-prueba.md`) |
|---|---|---|---|---|---|
| RF-12 | Cronograma y cálculo del ajuste según cinco modalidades | #73 | CU-07, CU-08 | 12 (original); 34 (reglas y ajustes con rezago) | CP-01 a CP-17, CP-40 a CP-49, CP-54 a CP-58 |
| RF-13 | Conservar los valores de índice usados en cada ajuste | #74 | CU-08 | 12 (original); 34 | CP-13, CP-14, CP-45, CP-57, CP-58 |
| RF-14 | Obtención automática de índices y carga manual | #75 | CU-07 | 12 (original); 34 | CP-18 a CP-34, CP-46 a CP-54 |

Los casos CP-49 a CP-58 son los que cierran los tres requisitos en la versión actual del catálogo: CP-49 pertenece a las pruebas de integración de la API de índices (CRUD, `latest`, `refresh`, permisos, aislamiento y previsualización, CP-40 a CP-49); CP-50 a CP-52 verifican el contrato con las fuentes externas (BCRA e INDEC) con respuestas grabadas y contra el entorno real; CP-53 y CP-54 cubren la obtención automática y el cálculo con lo obtenido; CP-55 a CP-58 cubren los defectos de encadenamiento de ajustes (DEF-07 y DEF-08).

Dentro del piloto, el ítem 34 extiende esos requisitos sin reemplazarlos: el rezago de dos meses del índice, la base del ajuste (original o vigente), la aplicación masiva con previsualización, el estimado con corrección posterior y la fuente alternativa de índices (FB-13, FB-23 y FB-25). Los casos nuevos se numeran en el rango CP-120 a CP-129 y no modifican los resultados esperados de los casos existentes.
