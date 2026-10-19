# Calidad de Software aplicada al TFG — módulo de índices y ajustes

Trabajo Práctico Integrador de Calidad de Software sobre la tesis Realfy.
Aplica un proceso de calidad completo a un módulo del sistema: `index-data`,
que obtiene los índices publicados por el BCRA y el INDEC y calcula los
ajustes de alquiler de los contratos.

## Nivel declarado

**Nivel 3: prototipo avanzado.** La tesis tiene la mayoría de las
funcionalidades implementadas, el flujo principal funciona con las
integraciones externas y el sistema se despliega con Docker en Railway
(ver `docs/despliegue.md`). Las metas que se exigen a ese nivel son:

| Aspecto | Meta nivel 3 | Dónde se verifica |
|---|---|---|
| Pipeline | Compilación, pruebas, análisis estático, cobertura, quality gate y reporte automático | `.github/workflows/ci.yml` |
| Quality gate | Bloquea bugs críticos, duplicación > 5 % y cobertura sobre código nuevo < 80 % | SonarCloud, proyecto `RomeV16_Proyecto-Final---Realfy` |
| Cobertura sobre código nuevo | 80 % | Quality gate |
| Cobertura mínima sobre código existente | 80 % sobre el módulo | `apps/api/jest.config.ts` (umbral por módulo) |
| Smoke test | Ejecutado por el pipeline tras el despliegue | Trabajo `smoke-deploy` del pipeline |
| Integración externa | Flujo E2E automatizado en cada despliegue | Trabajo `integration-real` del pipeline |
| Stress y esfuerzo sostenido | Ejecutados, con resultados y umbrales | Trabajo `stress` del pipeline, scripts en `apps/api/test/load/` |
| Plan de pruebas y riesgos | Versionado, criterios de entrada y salida, riesgos P×I, trazabilidad requisito → caso → defecto | `02-plan-de-pruebas.md`, `04-riesgos.md`, `05-casos-de-prueba.md` |
| Defectos | Pasos, esperado, obtenido, vinculados al caso | `06-registro-de-defectos.md` + GitHub Issues con etiqueta `defecto` |
| Herramienta nueva | Proceso de cinco pasos | `08-herramienta-sonarcloud.md` |

## Alcance

El proceso se aplica sobre el módulo `apps/api/src/modules/index-data` y su
motor de cálculo en `packages/shared/src/adjustment-engine`. Cubre los
requisitos RF-12, RF-13 y RF-14 del informe de la tesis y el caso de uso
CU-08 (calcular y aplicar ajuste). El resto del sistema se mantiene como
estaba y sigue cubierto por las suites que ya existían.

## Documentos

| Archivo | Eje del TP |
|---|---|
| `01-objetivos-de-calidad.md` | Introducción a la calidad: objetivos medibles, prácticas de proceso, contingencia |
| `02-plan-de-pruebas.md` | Aseguramiento de la calidad: plan versionado, QA vs QC, plantillas, trazabilidad |
| `03-matriz-iso-25010.md` | Modelos de calidad y niveles de prueba |
| `04-riesgos.md` | Riesgos por probabilidad × impacto |
| `05-casos-de-prueba.md` | Pruebas dinámicas: equivalencia, valores límite, tablas de decisión |
| `06-registro-de-defectos.md` | Defectos con contraste rojo/verde y prueba de regresión |
| `07-integracion-externa.md` | Automatización: contrato y pruebas de BCRA e INDEC |
| `08-herramienta-sonarcloud.md` | Herramientas: proceso de cinco pasos y matriz de decisión |
| `09-metricas.md` | Métricas y análisis estático: evolución antes y después |
| `10-stress.md` | Stress y esfuerzo sostenido: scripts, umbrales y resultados |

## Un comando para cada suite

```bash
pnpm --filter @realfy/api test:modulo        # unitarias del módulo con cobertura
pnpm --filter @realfy/api test:e2e:modulo    # integración del módulo (Postgres real)
pnpm --filter @realfy/api test:integracion-real  # contra BCRA e INDEC reales
pnpm --filter @realfy/api test:smoke -- --url=https://<api>   # smoke sobre un despliegue
pnpm --filter @realfy/api test:stress        # k6: carga y esfuerzo sostenido
```

Los scripts se agregan en `apps/api/package.json` a medida que avanza el
trabajo; cada uno está documentado en el archivo del eje correspondiente.
