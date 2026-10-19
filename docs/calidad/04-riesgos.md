# Riesgos del módulo de índices y ajustes

Versión 1.0 — 19 de octubre de 2026. Probabilidad e impacto en escala 1 a
5; la prioridad es el producto. Se revisa al cierre de cada día del
cronograma y la columna "estado" registra si el riesgo se materializó.

| ID | Riesgo | Prob. | Imp. | P×I | Mitigación | Verificación | Estado |
|---|---|---|---|---|---|---|---|
| R-01 | El BCRA cambia el formato de la API v4.0 o la da de baja | 3 | 5 | 15 | Prueba de contrato contra entorno real en cada ejecución; carga manual como camino alternativo; parser tolerante que descarta filas inválidas | CP-50, CP-51, CP-29 | Abierto |
| R-02 | El INDEC cambia la serie, la API de datos.gob.ar o el CSV de respaldo | 3 | 4 | 12 | Dos fuentes con respaldo; prueba de contrato; carga manual | CP-31, CP-52 | **Materializado** en otra forma: el contrato nunca fue el que el código asumía (DEF-06) |
| R-03 | Los índices obtenidos automáticamente no llegan al cálculo porque se guardan bajo un identificador de sistema que el filtro por inmobiliaria no deja leer | 5 | 5 | 25 | Prueba de integración del flujo refresco → cálculo; corrección con lectura explícita de los valores de sistema | CP-53, CP-54 | **Materializado** (DEF-01) |
| R-04 | Un factor se calcula con la forma equivocada del índice (nivel donde va variación o al revés) | 2 | 5 | 10 | Tabla de decisión con valores esperados calculados a mano; prueba del motor por modalidad | CP-05 a CP-09 | Abierto |
| R-05 | La aplicación automática de ajustes altera un alquiler sin la revisión que exige CU-08 | 2 | 5 | 10 | El servicio no está conectado a ninguna tarea; se documenta la decisión y se prueba que, si se conecta, respete el cronograma y audite | CP-12 a CP-15 | Abierto (L-05) |
| R-06 | Cobertura sobre código nuevo por debajo del 80 % y el quality gate bloquea el trabajo | 3 | 3 | 9 | Escribir la prueba antes del cambio; medir por módulo en local antes de abrir el PR | Quality gate | Abierto |
| R-07 | El trabajo de integración real falla por una caída transitoria y pone el pipeline en rojo sin defecto propio | 4 | 2 | 8 | Reintento con espera; clasificación del fallo como externo en el informe; el doble sigue probando el parser | Historial de Actions | Abierto |
| R-08 | La fecha de ajuste se desplaza al sumar meses sobre fin de mes (31 de enero + 1 mes) | 3 | 3 | 9 | Caso de valor límite sobre `addMonths` | CP-17 | Abierto |
| R-09 | El stress en el despliegue efímero del pipeline no representa la capacidad real de Railway | 4 | 2 | 8 | Reportar los números como relativos al ambiente; medir también en local; comparar antes y después de la mejora en el mismo ambiente | `10-stress.md` | Abierto |
| R-10 | Las versiones no fijadas de las acciones del pipeline cambian de comportamiento o introducen código no verificado | 3 | 3 | 9 | Fijar cada acción por SHA; SonarCloud lo verifica | Rating de seguridad | Abierto |
| R-11 | El equipo no entiende una prueba generada con asistencia y no puede defenderla | 2 | 4 | 8 | Cada caso tiene nombre descriptivo, criterio esperado explicado y referencia al documento; revisión de los casos antes de la entrega | Revisión del día 7 | Abierto |

## Riesgos ordenados por prioridad

1. R-03 (25) — ya materializado, es el primer defecto que se corrige.
2. R-01 (15)
3. R-02 (12)
4. R-04, R-05 (10)
5. R-06, R-08, R-10 (9)
6. R-07, R-09, R-11 (8)

## Relación con los riesgos de la tesis

La tabla 38 del informe declaraba "las fuentes de índices cambian de
formato o de ritmo" con la carga manual como mitigación y lo daba por no
materializado. Este plan lo desagrega en R-01 y R-02 y agrega R-03, que
la tesis no había visto: la carga manual funciona, pero la automática
nunca fue leída por ninguna inmobiliaria. Es una falla silenciosa del mismo
tipo que el informe describe en 7.10.4: no produce error visible y por eso
no estaba en la lista.
