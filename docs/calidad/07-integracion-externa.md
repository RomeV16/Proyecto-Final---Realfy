# Integración externa: BCRA e INDEC

Versión 1.1 — 30 de octubre de 2026. Documenta el contrato con las dos
plataformas externas que consume el módulo, cómo se prueba ese contrato con
dobles y contra el entorno real, qué encontró la primera ejecución real y
por qué el IPC cambió de fuente (sección final).

## Fuentes

| Índice | Organismo | Endpoint | Formato | Forma del valor | Periodicidad |
|---|---|---|---|---|---|
| ICL | BCRA | `GET https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/40?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` | JSON | Nivel (ej. 36,94) | Diaria |
| UVA | BCRA | `GET .../Monetarias/31?desde=&hasta=` | JSON | Nivel en pesos (ej. 2159,10) | Diaria |
| IPC | INDEC vía infra.datos.gob.ar (dataset 145, distribución 145.3) | `GET https://infra.datos.gob.ar/catalog/sspm/dataset/145/distribution/145.3/download/indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv` | CSV | Columna 2: nivel base dic-2016 = 100; columna 9 (`ipc_ng_nacional_tasa_variacion_mensual`): variación mensual como fracción | Mensual |
| IPC (respaldo) | BCRA | `GET .../Monetarias/27?desde=&hasta=` ("Inflación mensual") | JSON | Variación mensual en porcentaje con un decimal (ej. 1,9), fechada el último día del mes | Mensual |

Hasta el 30 de octubre de 2026 el IPC se leía de la API de series de
datos.gob.ar (`148.3_INIVELNAL_DICI_M_26`) con el CSV como respaldo. La API
de series se dejó de usar; el motivo está en la última sección.

Sin autenticación en ninguna. Agente de usuario `Mozilla/5.0 (compatible; IndexScraper/1.0)`. Tiempo máximo de espera 10 s por petición.

## Contrato esperado por el módulo

### BCRA (ICL y UVA)

```json
{
  "status": 200,
  "results": [
    { "idVariable": 40, "detalle": [ { "fecha": "2026-10-19", "valor": 36.94 }, ... ] }
  ]
}
```

- `results[0].detalle[]` con `fecha` en `YYYY-MM-DD` y `valor` numérico.
- Orden descendente por fecha; el módulo no depende del orden porque
  reordena al calcular.
- El rango pedido es de 60 días; en la respuesta real del 19 de octubre de
  2026 vinieron 61 filas por índice.
- El certificado TLS del BCRA falló en el pasado: el módulo reintenta una
  vez sin verificación y lo registra como advertencia (CP-30).

### INDEC (IPC)

```text
indice_tiempo,ipc_ng_nacional,ipc_ng_gba,...,ipc_ng_nacional_tasa_variacion_mensual,...
2026-09-01,12514.1508,12523.1733,...,0.01933610203208236,...
```

- Una fila por mes, con `indice_tiempo` en `YYYY-MM-01`.
- La columna 9 (índice 8) es la **variación mensual como fracción** (0,0193 =
  1,93 %), con todos los decimales. El módulo la pasa a porcentaje, que es lo
  que el motor de ajustes espera, y se queda con los últimos 24 meses.
- Antes de leer, el módulo verifica que la columna 9 se llame
  `ipc_ng_nacional_tasa_variacion_mensual`: si el INDEC reordena el archivo,
  no trae nada antes que traer otra serie.

### BCRA (IPC de respaldo)

```json
{ "status": 200, "results": [ { "idVariable": 27, "detalle": [ { "fecha": "2026-09-30", "valor": 1.9 }, ... ] } ] }
```

- Mismo esquema que ICL y UVA. `fecha` es el último día del mes y `valor`
  ya está en porcentaje, redondeado a un decimal como lo comunica el INDEC.
- El mes se toma del texto de la fecha (`2026-09-30` → `2026-09`), sin pasar
  por `Date`, para que la zona horaria no lo corra al mes siguiente.

### Cómo se unen las dos fuentes del IPC

Las dos se piden en paralelo y se unen por mes:

1. Si un mes está en el CSV, vale el del CSV (variación completa).
2. Si solo lo trae el BCRA, se usa el del BCRA. Pasa en las semanas entre
   que el INDEC publica y que actualiza el archivo.
3. Como la clave es el mes, ningún mes queda dos veces aunque lo traigan las
   dos fuentes.
4. Al guardar, una fila del BCRA solo se crea si el mes no existe: nunca pisa
   un valor guardado. Una fila del CSV sí actualiza el valor, así que el mes
   que entró con un decimal se reemplaza por la variación completa en cuanto
   el CSV la publica.

No hubo cambio de base: el CSV sigue en base diciembre de 2016 = 100 y es
continuo, así que no hay empalme entre series distintas. Las variaciones del
CSV, encadenadas, reproducen exactamente el cociente entre niveles; las del
BCRA, por el redondeo, pueden diferir en hasta 0,05 puntos por mes.

## Lo que encontró la primera prueba contra el entorno real (19 oct 2026)

| # | Hallazgo | Consecuencia | Defecto |
|---|---|---|---|
| 1 | Con `limit=24` y sin `sort`, la API devuelve los **24 meses más viejos** (diciembre 2016 a noviembre 2018) | El scraper nunca obtiene el IPC reciente | DEF-06 |
| 2 | Los valores son **niveles** (100, 101,58, ..., 12514,15), no variaciones | El motor encadena `1 + valor/100`: un nivel de 12514 se trataría como un 12.514 % mensual | DEF-06 |
| 3 | El CSV de respaldo lee la columna 2, que también es nivel | Mismo problema por el camino alternativo | DEF-06 |
| 4 | Las filas se guardan bajo el identificador `__system__` y ninguna inmobiliaria las lee | Los tres puntos anteriores nunca se manifestaron | DEF-01 |

Es el error que el informe de tesis describe en 6.2 y 7.8.2: "aplicar como
porcentaje un número que en realidad es un nivel acumulado multiplica el
alquiler por un valor absurdo". La prueba unitaria no lo detectaba porque
los dobles reproducían el malentendido: la fixture del scraper tenía
valores como 7045,47 y la prueba solo verificaba que se parsearan.

## Cómo se prueba

| Nivel | Qué | Archivo | Comando | Cuándo corre |
|---|---|---|---|---|
| Contrato con dobles (CP-50) | El parser produce exactamente las filas esperadas a partir de respuestas reales grabadas el 19 de octubre de 2026 (la variable 27 del BCRA, el 30 de octubre) | `apps/api/test/integration/external.contract.spec.ts` con fixtures en `apps/api/test/fixtures/external/` | `pnpm --filter @realfy/api test:modulo` | Cada PR (trabajo `unit`) |
| Contrato contra entorno real (CP-51, CP-52) | El BCRA (ICL, UVA e inflación mensual) y el CSV del INDEC responden 200 con el esquema esperado y datos recientes: el último mes del IPC, en las dos fuentes, tiene menos de 120 días | `apps/api/test/integration/external.real.spec.ts` | `pnpm --filter @realfy/api test:integracion-real` | Cada PR y cada push a `main` (trabajo `integration-real`) |
| Flujo completo (CP-53, CP-54) | Refresco → listado → previsualización usando los índices obtenidos | `apps/api/test/e2e/index-data-scraper.e2e-spec.ts` | `pnpm --filter @realfy/api test:e2e:modulo` | Trabajo `e2e-api` |

Las pruebas contra el entorno real reintentan tres veces con espera para
distinguir una caída transitoria (riesgo R-07) de un cambio de contrato.
Si fallan las tres, el pipeline queda en rojo y el fallo se clasifica en el
informe como externo o como defecto propio según el mensaje.

## Dobles de prueba

Las fixtures son respuestas reales, sin editar, salvo el CSV, que se
recorta a la cabecera y las últimas 30 filas para no versionar 42 KB. Cada
archivo lleva la fecha de captura en el nombre. Regrabarlas es parte del
procedimiento cuando una prueba real detecta un cambio de contrato.

## Cambio de fuente del IPC (30 oct 2026)

El 28 de octubre el trabajo `integration-real` quedó en rojo porque CP-52
encontró el IPC con julio como último mes (120,09 días contra un tope de
120). Se clasificó como externo (R-07) pensando que el INDEC había dejado de
publicar. No era así: el INDEC ya había publicado agosto (1,7 %) y, el 13 de
octubre, septiembre (1,9 %). Lo que pasaba era del lado de la API de series de
datos.gob.ar:

| # | Hallazgo | Evidencia (30 oct 2026) |
|---|---|---|
| 1 | Con `representation_mode=percent_change` y `sort=desc`, la API **omite el último mes** que tiene | `…/series/?ids=148.3_INIVELNAL_DICI_M_26&representation_mode=percent_change&sort=desc&limit=3` empieza en 2026-07; el mismo pedido con orden ascendente y `start_date=2026-05-01` termina en 2026-08 |
| 2 | La API va un mes atrás del CSV del mismo dataset | El nivel por la API termina en 2026-08 (12276,77); el CSV 145.3 ya traía 2026-09 (12514,15) el 19 de octubre, como muestra la fixture `indec-ipc-2026-10-19.csv` |
| 3 | El módulo solo iba al CSV si la API fallaba o venía vacía | Una respuesta 200 con datos viejos ocultaba un respaldo más nuevo |

Por eso el IPC pasó a leerse del CSV del INDEC, con la variable 27 del BCRA
como respaldo, y la API de series se dejó de usar. CP-52 sigue con el mismo
tope de 120 días, ahora medido sobre lo que el módulo efectivamente lee. La
fixture `indec-series-pct-desc-2026-10-19.json` queda como registro del
hallazgo 1 (CP-50).

Si las dos fuentes fallaran a la vez, la pantalla **Configuración → Índices**
permite cargar el IPC a mano, de a un mes o pegando varios desde una planilla.
La carga manual tiene prioridad sobre el valor de sistema del mismo mes.
