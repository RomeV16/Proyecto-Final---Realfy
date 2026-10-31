# Objetivos de calidad

Versión 1.0 — 19 de octubre de 2026.

## Para quién es la calidad

Un objetivo de calidad sirve si alguien puede decir, con un número, si se
cumplió. Se declaran tres puntos de vista porque cada uno mide algo
distinto y los tres se verifican con datos del propio proyecto.

### Desde el usuario (la inmobiliaria)

| ID | Objetivo | Métrica | Meta | Cómo se mide |
|---|---|---|---|---|
| OU-1 | El ajuste de un contrato se calcula con los índices publicados, no con valores inventados ni interpolados | Casos de prueba de CU-08 que pasan con datos reales de BCRA e INDEC | 100 % de los casos del flujo E2E | Trabajo `integration-real` del pipeline |
| OU-2 | El cálculo es exacto al centavo para las cinco modalidades | Diferencia entre el monto calculado y el esperado en la tabla de decisión | 0,00 | Casos CP-05 a CP-11 |
| OU-3 | La consulta de índices responde rápido aunque haya muchas inmobiliarias consultando a la vez | p95 de `GET /api/index-data` bajo 50 usuarios concurrentes | < 500 ms | Script de stress con k6 |
| OU-4 | Si el BCRA o el INDEC se caen, la inmobiliaria sigue pudiendo ajustar | El cálculo funciona con índices cargados a mano cuando el scraper devuelve vacío | Caso CP-32 y CP-54 en verde | Suite unitaria e integración |

### Desde el equipo

| ID | Objetivo | Métrica | Meta | Cómo se mide |
|---|---|---|---|---|
| OE-1 | Nadie mezcla código del módulo sin pruebas que lo cubran | Cobertura sobre código nuevo | ≥ 80 % | Quality gate de SonarCloud en cada PR |
| OE-2 | El módulo deja de ser la parte menos probada de la API | Cobertura de líneas y de ramas del módulo | ≥ 80 % líneas, ≥ 70 % ramas | `jest --coverage` con umbral por módulo |
| OE-3 | Cada defecto corregido queda cerrado por una prueba de regresión | Defectos registrados con prueba de regresión asociada | 100 % | `06-registro-de-defectos.md` |
| OE-4 | Un cambio roto no llega a `main` | PRs que entran con el pipeline en rojo | 0 | Protección de rama (configurada el 2026-10-30) + historial de Actions |

### Desde la organización (la cátedra y el futuro mantenedor)

| ID | Objetivo | Métrica | Meta | Cómo se mide |
|---|---|---|---|---|
| OO-1 | Las decisiones de calidad se apoyan en números, no en impresiones | Métricas del informe que coinciden con las del pipeline y SonarCloud | 100 % | Anexo de métricas con enlace a cada ejecución |
| OO-2 | El módulo es mantenible por alguien que no lo escribió | Deuda técnica estimada por SonarCloud en el módulo; issues críticos abiertos | Rating A; 0 críticos | Panel de SonarCloud |
| OO-3 | La verificación cuesta lo mismo cada vez | Tiempo del pipeline completo | < 15 minutos | Duración de la ejecución en Actions |

## Prácticas de proceso que sostienen los objetivos

| Práctica | Objetivo que sostiene | Cómo se aplica en este repositorio |
|---|---|---|
| Rama protegida y revisión por PR | OE-4 | Desde el 2026-10-30 `main` exige PR, 1 aprobación, rama al día y los chequeos Lint, Build, Unit Tests & Coverage, SonarCloud & Quality Gate, Migrations from scratch, API E2E Tests y Ephemeral deploy smoke & stress. El trabajo de contrato externo (BCRA / INDEC) no es obligatorio porque depende de la disponibilidad de terceros |
| Criterio de aceptación antes de ejecutar | OU-2, OE-3 | Cada caso en `05-casos-de-prueba.md` declara el resultado esperado antes de escribir la prueba |
| Prueba en rojo antes de corregir | OE-3 | Cada defecto tiene una prueba que falla contra el código viejo y pasa contra el nuevo |
| Quality gate automático | OE-1, OO-2 | SonarCloud bloquea el PR; no hay excepción manual |
| Umbral de cobertura como piso, no como meta | OE-2 | El piso del módulo sube solo cuando la cobertura real ya subió |
| Dobles de prueba para lo externo, entorno real para el contrato | OU-1, OU-4 | Las unitarias usan respuestas grabadas; un trabajo aparte pega contra BCRA e INDEC |
| Métrica de proceso y de proyecto | OO-1, OO-3 | Se registran por ejecución en `09-metricas.md` |

**Desvío corregido.** Hasta el 2026-10-30 la protección de `main` estaba
declarada en este documento pero no configurada en el repositorio: OE-4 se
sostenía por disciplina del equipo, no por una regla que lo impidiera. Desde esa
fecha la regla existe y OE-4 está respaldado por la plataforma.

## Plan de contingencia ante la caída de una dependencia crítica

La dependencia crítica del módulo es la obtención de índices desde el BCRA
(ICL y UVA, `api.bcra.gob.ar`) y el INDEC (IPC, CSV en `infra.datos.gob.ar`
con la inflación mensual del BCRA de respaldo). Sin índices no hay cálculo de ajuste
para las modalidades IPC, ICL y CCP. El riesgo está declarado en la tesis
(tabla 38 del informe: "las fuentes de índices cambian de formato o de
ritmo") y en `04-riesgos.md` como R-01 y R-02.

| Escenario | Detección | Respuesta automática | Respuesta manual | Verificación |
|---|---|---|---|---|
| El BCRA no responde o devuelve error HTTP | `fetchICL`/`fetchUVA` registran el error; el trabajo `integration-real` del pipeline falla y avisa | El scraper devuelve una lista vacía para esa fuente y sigue con las demás; la tarea diaria reintenta a las 06:00 del día siguiente | Un Admin carga el valor publicado por `POST /api/index-data` (RF-14 admite carga manual) | CP-29, CP-32 |
| El certificado TLS del BCRA es inválido (ya pasó) | Advertencia en el registro | Reintento con verificación de certificado desactivada, registrado como advertencia | Revisar que la respuesta siga teniendo el esquema esperado | CP-30 |
| La API JSON del INDEC cambia o se cae | Advertencia en el registro | Se usa el CSV de respaldo | Carga manual | CP-31 |
| Las dos fuentes del INDEC fallan | Error en el registro; `integration-real` en rojo | Lista vacía, sin estimar ni interpolar (CU-08 excepción 1) | Carga manual; el cálculo de ajuste responde `MISSING_INDEX_DATA` hasta que haya datos | CP-31, CP-54 |
| El formato de respuesta cambia aunque el HTTP sea 200 | Prueba de contrato contra entorno real en el pipeline (`07-integracion-externa.md`) | Ninguna: las filas no parseables se descartan | Actualizar el parser con su prueba de contrato | CP-50 a CP-52 |

Tiempo máximo tolerado sin índices automáticos: un mes, porque la
periodicidad mínima de ajuste es mensual y la carga manual cubre el hueco.
Responsable de la carga manual: el rol Admin de cada inmobiliaria.
