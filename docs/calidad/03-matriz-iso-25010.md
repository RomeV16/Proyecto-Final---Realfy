# Matriz ISO/IEC 25010 del módulo de índices y ajustes

Versión 1.0 — 19 de octubre de 2026. Cada característica se evalúa con
evidencia del repositorio o de una ejecución, no con una opinión. El estado
"antes" corresponde a `main` en el commit `2eb2fa7` (19 de octubre de 2026);
el "después" se completa al cierre del trabajo en `09-metricas.md`.

| # | Característica | Subcaracterística relevante | Evidencia antes | Qué se hace en este trabajo | Cómo se verifica |
|---|---|---|---|---|---|
| 1 | Adecuación funcional | Completitud, corrección | Las cinco modalidades están en el motor compartido; CCP no se resuelve en la previsualización ni en la aplicación automática (limitación L-05 del informe). Los índices obtenidos automáticamente quedan bajo un identificador de sistema que ninguna inmobiliaria puede leer (DEF-01) | Tabla de decisión modalidad × datos; corrección de DEF-01 y DEF-03 | CP-05 a CP-14, CP-53, CP-54 |
| 2 | Eficiencia de desempeño | Comportamiento temporal, capacidad | Sin medición: el informe declara que no hubo pruebas de carga (desvío D-05) | Stress de 50 usuarios virtuales y esfuerzo sostenido de 10 minutos sobre `GET /api/index-data`; una mejora medida antes y después | `10-stress.md`, CP-70, CP-71 |
| 3 | Compatibilidad | Interoperabilidad | Consume dos formatos externos: JSON del BCRA v4.0 (ICL, UVA e inflación mensual) y CSV del INDEC para el IPC. Solo el camino feliz está probado con dobles | Prueba de contrato con respuestas grabadas y contra entorno real | `07-integracion-externa.md`, CP-50 a CP-52 |
| 4 | Usabilidad | Operabilidad, protección contra errores | No hay pantalla para índices en la aplicación web: se administran por API, solo rol Admin. Los errores de validación devuelven `VALIDATION_ERROR` con detalle | Casos de valores límite sobre la validación (paginación, precisión decimal) | CP-20, CP-21, CP-23, CP-24 |
| 5 | Fiabilidad | Tolerancia a fallos, recuperabilidad | Cada fuente falla de forma aislada y devuelve lista vacía; la tarea diaria no tira el proceso (`runGuarded`). La aplicación automática de ajustes no está conectada a ninguna tarea (L-05) | Plan de contingencia; casos de fallo por fuente; decisión documentada sobre la tarea de aplicación automática | `01-objetivos-de-calidad.md`, CP-29 a CP-32, DEF-03 |
| 6 | Seguridad | Confidencialidad, integridad | Aislamiento por inmobiliaria fallando cerrado (ADR-0006), probado por `test/e2e/index-data.e2e-spec.ts`. SonarCloud marca 42 vulnerabilidades en el repositorio, casi todas en `ci.yml` por acciones sin versión fija y uso de `npx` sin versión | Versiones fijas por SHA en el pipeline; reintento TLS inseguro del BCRA revisado | SonarCloud rating de seguridad; CP-30, CP-58 |
| 7 | Mantenibilidad | Modularidad, capacidad de prueba, analizabilidad | Cobertura del módulo 44,89 % líneas / 25,26 % ramas (18 pruebas). Tres DTOs de `class-validator` sin uso (el servicio valida con Zod). Lógica de armado de parámetros duplicada entre `preview` y `applyDueAdjustments` | Cobertura al 80 %; eliminación del código muerto; extracción del armado de parámetros a una función probada | `09-metricas.md`, SonarCloud duplicación y deuda |
| 8 | Portabilidad | Instalabilidad, adaptabilidad | `Dockerfile.api` y `railway.json`; migraciones aplicadas al arrancar. El despliegue se verifica a mano con `curl /api/health` | Despliegue efímero en el pipeline con smoke automático | Trabajo `smoke-deploy`, CP-60 |

## Top 3 y por qué

1. **Adecuación funcional (corrección).** Un factor de ajuste mal calculado
   cambia el alquiler que paga una persona. El informe de tesis ya señala
   que confundir nivel con variación "produce factores sin sentido" y que
   es el tipo de error que una prueba unitaria no detecta si asume el mismo
   malentendido. Por eso la tabla de decisión fija los valores esperados a
   mano antes de ejecutar.
2. **Fiabilidad (tolerancia a fallos).** El módulo depende de dos
   organismos externos que ya cambiaron de formato y de certificado durante
   el desarrollo. Que una caída no impida ajustar es lo que convierte la
   obtención automática en algo usable.
3. **Mantenibilidad (capacidad de prueba).** Es el módulo con la lógica de
   dominio más delicada y una de las coberturas más bajas de la API. Subirla
   al 80 % y sacar el código muerto es lo que permite tocarlo sin miedo
   después de la tesis.

Seguridad queda cuarta a propósito: el aislamiento entre inmobiliarias ya
tiene pruebas de integración propias y un ADR; lo que falta es higiene del
pipeline, que se corrige en el día 2.

## Mapa de niveles de prueba

| Nivel | Cuántos casos (antes → objetivo) | Qué cubre | Ambiente |
|---|---|---|---|
| Unitario | 18 → ~55 | Motor de cálculo, servicios, controlador, tarea programada | Memoria |
| Integración de API | 17 → ~21 | Endpoints por HTTP, aislamiento, RBAC, flujo de refresco a cálculo | PostgreSQL real |
| Integración externa | 0 → 5 | Contrato con BCRA e INDEC | Red real + dobles |
| Sistema (smoke) | 1 suite interna → 1 interna + 1 sobre despliegue | Arranque, salud, autenticación, lectura del módulo | Despliegue efímero |
| Aceptación | Criterios de CU-08 | Flujo completo índice → cálculo → aplicación | Integración de API |
| No funcional | 0 → 2 | Stress y esfuerzo sostenido | Despliegue efímero |

## Despliegue verificado en cada instancia

| Instancia | Cómo se despliega | Qué lo verifica |
|---|---|---|
| Local | `docker compose up` + `pnpm dev` | Smoke interno (`smoke.e2e-spec.ts`) |
| Integración continua | PostgreSQL como servicio, migraciones desde cero | Trabajos `migrations` y `e2e-api` |
| Despliegue efímero del pipeline | Imagen construida desde `Dockerfile.api`, arranque con `prisma migrate deploy` | Trabajo `smoke-deploy`: `/api/health`, registro, `GET /api/index-data` |
| Demostración (Railway) | Push a `main` | Mismo smoke apuntado al dominio público |
