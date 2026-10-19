# Integración externa: BCRA e INDEC

Versión 1.0 — 20 de octubre de 2026. Documenta el contrato con las dos
plataformas externas que consume el módulo, cómo se prueba ese contrato con
dobles y contra el entorno real, y qué encontró la primera ejecución real.

## Fuentes

| Índice | Organismo | Endpoint | Formato | Forma del valor | Periodicidad |
|---|---|---|---|---|---|
| ICL | BCRA | `GET https://api.bcra.gob.ar/estadisticas/v4.0/Monetarias/40?desde=YYYY-MM-DD&hasta=YYYY-MM-DD` | JSON | Nivel (ej. 36,94) | Diaria |
| UVA | BCRA | `GET .../Monetarias/31?desde=&hasta=` | JSON | Nivel en pesos (ej. 2159,10) | Diaria |
| IPC | INDEC vía datos.gob.ar | `GET https://apis.datos.gob.ar/series/api/series/?ids=148.3_INIVELNAL_DICI_M_26&format=json&limit=24` | JSON | **Nivel** base dic-2016 = 100 (ej. 12514,15) | Mensual |
| IPC (respaldo) | INDEC vía infra.datos.gob.ar | `GET .../indice-precios-al-consumidor-nivel-general-base-diciembre-2016-mensual.csv` | CSV | Columna 2: nivel; columna 9: variación mensual como fracción | Mensual |

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

```json
{ "data": [ ["2016-12-01", 100.0], ["2017-01-01", 101.5859], ... ], "count": 119, "meta": [...], "params": {...} }
```

- `data[]` de pares `[fecha ISO, valor]`.
- La API admite `sort=desc` y `representation_mode=percent_change`. Con
  esos parámetros devuelve la **variación mensual como fracción** (0,0211 =
  2,11 %) de los últimos 24 meses, que es lo que el motor de ajustes espera
  (en porcentaje).

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
| Contrato con dobles (CP-50) | El parser produce exactamente las filas esperadas a partir de respuestas reales grabadas el 19 de octubre de 2026 | `apps/api/test/integration/external.contract.spec.ts` con fixtures en `apps/api/test/fixtures/external/` | `pnpm --filter @realfy/api test:modulo` | Cada PR (trabajo `unit`) |
| Contrato contra entorno real (CP-51, CP-52) | El BCRA y el INDEC responden 200 con el esquema esperado y datos recientes; la variante `percent_change` devuelve fracciones chicas | `apps/api/test/integration/external.real.spec.ts` | `pnpm --filter @realfy/api test:integracion-real` | Cada PR y cada push a `main` (trabajo `integration-real`) |
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
