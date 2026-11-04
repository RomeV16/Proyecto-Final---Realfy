# Operación del ambiente piloto

Runbook para quien opera el ambiente `piloto`, el que usa la inmobiliaria con
datos reales. Complementa a `despliegue.md`, que explica cómo está armada la
infraestructura y por qué, y a `privacidad-datos.md`, que trata los datos
personales. La decisión de fondo está en
`adr/0014-ambiente-piloto-con-datos-reales.md`.

Todo lo que sigue se escribe sin nombres, dominios ni credenciales reales: las
URL y los secretos del ambiente se guardan en la configuración privada del
equipo.

## Despliegue paso a paso

1. Confirmar que el cambio está en `main` y que la integración continua de ese
   commit está en verde.
2. Armar una copia limpia del commit, fuera de cualquier copia de trabajo, y
   desplegar desde ahí (`railway up` sube el directorio entero, versionado o no):
   ```bash
   rm -rf /tmp/realfy-deploy && mkdir /tmp/realfy-deploy
   git archive <commit> | tar -x -C /tmp/realfy-deploy
   cd /tmp/realfy-deploy
   ```
3. Desplegar a `production`:
   ```bash
   railway up --service api --environment production --detach
   railway up --service web --environment production --detach
   ```
4. Verificar en `production`: `/api/health` responde `ok` con `db: connected`,
   se puede iniciar sesión y abre al menos una pantalla.
5. Tomar la copia previa de `piloto` y, si el commit trae migraciones, ensayarlas
   sobre su restauración (ver la sección siguiente).
6. Desplegar a `piloto` con los mismos comandos y `--environment piloto`.
7. Repetir la verificación del paso 4 en `piloto` y comparar las migraciones
   aplicadas con las del commit. Si hubo migraciones, tomar una segunda copia.
8. Si algo falla en `piloto`, ir a «Incidentes» antes de intentar corregir sobre
   la marcha.

No se despliega en horario de uso de la inmobiliaria ni en los días de cierre de
mes, salvo para corregir un incidente.

## Copia previa y ensayo de migraciones

Ningún despliegue a `piloto` se hace sin una copia tomada justo antes, y ninguna
migración se aplica por primera vez sobre los datos reales.

1. Tomar una copia lógica con `pg_dump -Fc` a través de `railway ssh`, guardarla
   en el servidor del equipo con permisos 600 y verificarla con `pg_restore -l`
   y un `sha256`. Esta copia se toma siempre, haya o no migraciones.
2. Si el commit trae migraciones, restaurar esa copia en un PostgreSQL local.
3. Aplicar las migraciones sobre la copia local con `prisma migrate deploy` y
   revisar los resultados: conteos antes y después, filas que un relleno debía
   tocar, ninguna fila huérfana.
4. Solo si el ensayo sale limpio, desplegar a `piloto`.

Si el ensayo falla, la migración se corrige en un PR nuevo; no se parcha en el
ambiente.

## Restauración

Se usa cuando la base del piloto se perdió o está corrupta. Es el último recurso:
antes se intenta el retroceso del despliegue (ver «Incidentes»).

1. Elegir el origen: la copia nativa diaria más reciente (RPO de 24 horas) o,
   si no está disponible, la copia externa semanal (RPO de 7 días).
2. Crear una base PostgreSQL vacía.
3. Restaurar con `pg_restore --no-owner --no-privileges` sobre ella.
4. Verificar: conteo de filas de las tablas principales y migraciones aplicadas
   iguales a las de la copia.
5. Apuntar `DATABASE_URL` del servicio `api` de `piloto` a la base restaurada y
   desplegar la configuración vigente del servicio.
6. Verificar con `/api/health`, iniciar sesión y revisar con la inmobiliaria
   los últimos movimientos, porque los posteriores a la copia hay que volver a
   cargarlos.
7. Registrar el tiempo total: es la medición del RTO del servicio (meta de 2 horas
   o menos).

La restauración se ensaya en local antes de cada cierre de ciclo, no solo cuando
hace falta. El 2026-11-02, con la copia tomada después de cargar la cartera real,
los pasos 2 a 4 tardaron unos 3 segundos (la copia pesa alrededor de 1 MB): con este
volumen el tiempo de recuperación lo dominan los pasos manuales 5 y 6, que todavía
no se midieron de punta a punta. El detalle de RPO y RTO está en `despliegue.md`.

## Carga del histórico de ICL y UVA

El lector diario del BCRA trae solo los últimos 60 días de ICL y UVA. Un ajuste
con esas series necesita el valor del día en que empieza y del día en que termina
su ventana (ADR-0011): si falta alguno, el ajuste queda como `MISSING_INDEX_DATA`
con la fecha que falta, y no se aplica. Para los contratos cuya ventana arranca
antes de lo que hay cargado se completa la serie de sistema, una vez por índice, con una
cuenta Admin (la serie de sistema es una sola para todas las inmobiliarias; no se
carga como valores propios de la inmobiliaria, que taparían los valores futuros):

```bash
API=https://<url-de-la-api-del-ambiente>
TOKEN=<access token de un Admin; ver POST $API/api/auth/login>
HOY=$(TZ=America/Argentina/Buenos_Aires date +%F)

curl -sS -X POST "$API/api/index-data/backfill" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"indexType\":\"ICL\",\"from\":\"2020-07-01\",\"to\":\"$HOY\"}"
curl -sS -X POST "$API/api/index-data/backfill" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"indexType\":\"UVA\",\"from\":\"2021-01-01\",\"to\":\"$HOY\"}"
```

- El rango admite hasta 3.660 días por llamada; para más historia, se divide en
  tramos. Repetir la carga es seguro: solo agrega los días que faltan y no pisa
  los ya cargados.
- La respuesta trae `inserted`, `existing`, `differing` (días ya cargados con otro
  valor que el del BCRA: se revisan a mano, la carga no los toca) y
  `missingCount` con `missingDays`. Con el rango completo, `missingCount` debe ser
  0; si el rango empieza antes de que exista la serie, los primeros días
  aparecen ahí y no es un problema para los contratos posteriores.
- Un 502 `INDEX_SOURCE_UNAVAILABLE` es el BCRA caído o lento: se reintenta.
- Después se vuelve a previsualizar el mes (Ajustes del mes): los contratos ICL y UVA
  que estaban en `MISSING_INDEX_DATA` por el histórico pasan a «listo».

## Prórrogas de contratos importados y ajustes que bajan el alquiler

Dos pasos de operación después del despliegue de DEF-173 a DEF-176:

- **Prórrogas de palabra.** En un contrato importado sin historial de ajustes, la
  prórroga deja salteado lo vencido hasta la fecha de importación (el alquiler
  importado ya lo incluye) y el primer pendiente es posterior. Antes de aprobar
  diciembre, revisar en cada contrato prorrogado antes del despliegue que su primer
  ajuste pendiente sea posterior a la importación; si quedó uno anterior, reenviar
  el lote de ese contrato (el importador alinea el cronograma pendiente con el
  calendario) antes de que el proceso de las 7 lo aplique.
- **Ajustes que bajan el alquiler.** El proceso diario y la generación no los
  aplican: quedan pendientes con el motivo `RENT_DECREASE_REQUIRES_REVIEW` y la
  liquidación del mes lleva `ADJUSTMENT_PENDING`. Se revisan en *Ajustes del mes*
  (aparecen con «El alquiler baja…» y no entran en *Elegir todos*); se aplican a mano,
  con confirmación, sólo si la inmobiliaria confirma esa baja. Si no, se corrige el
  dato del contrato (base, rezago o modalidad) y se vuelve a previsualizar.

## Cierre de mes

Lista de verificación, en el orden del ciclo (ver `tesis/30-piloto.md`). Mientras
el ciclo sea en sombra o en paralelo, cada paso se hace en Realfy además de en el
sistema actual de la inmobiliaria, y la reconciliación sigue
`calidad/12-piloto.md`.

- [ ] Copia de la base tomada antes de empezar el ciclo.
- [ ] Índices del mes: el IPC con el rezago pactado está publicado, o los ajustes
  que lo usen quedan como provisorios y se anotan.
- [ ] Ajustes: previsualizados, revisados y aplicados.
- [ ] Boletas de impuestos y servicios del período cargadas.
- [ ] Cargos del mes cargados en el centro de carga, con los que piden anticipo
  resueltos.
- [ ] Liquidaciones generadas, con los punitorios pendientes incluidos.
- [ ] Liquidaciones aprobadas y enviadas a los inquilinos.
- [ ] Cobros registrados en caja, con quién recibió cada pago y en qué cuenta.
- [ ] Estado de cuenta de cada locador generado (desde el ítem 37; hasta entonces,
  la rendición por contrato repartida entre los locadores).
- [ ] Reconciliación contra el método actual de la inmobiliaria, con las
  diferencias anotadas y convertidas en FB o defecto dentro de las 24 horas.
- [ ] Evidencia del ciclo guardada fuera del repositorio; en el repositorio, solo
  los totales agregados que autorice la inmobiliaria.
- [ ] Copia de seguridad: confirmar que la copia semanal más reciente existe y
  verificarla; si el cierre cae lejos de un lunes, tomar una copia manual.

## Canal de feedback

- Dentro de la aplicación: un ticket con la categoría «piloto», cuando esa
  categoría esté disponible.
- Una sesión semanal de 15 minutos con las personas que usan el sistema.

Todo hallazgo, venga del canal que venga, entra como FB en
`tesis/31-registro-de-feedback.md` dentro de las 24 horas, y de ahí se convierte
en un issue con la etiqueta `origen:uso-real`. El recorrido completo está en ese
documento.

## Incidentes

Quien detecta el problema avisa al equipo, que es quien atiende. La inmobiliaria
no resuelve nada de infraestructura.

1. **Estabilizar.** Mirar los registros del servicio afectado (`api` o `web`).
2. **Retroceder.** Si el problema empezó con un despliegue, volver a desplegar el
   despliegue anterior del servicio, desde el panel de Railway. El retroceso de
   `api` o `web` no toca la base: una migración ya aplicada no se revierte con
   esto.
3. **Restaurar la base.** Solo si hay pérdida o corrupción de datos y el
   retroceso no alcanza (ver «Restauración»).
4. **Registrar.** Anotar qué pasó, cuándo, cuánto duró y qué se hizo. Si
   corresponde, abrir un FB.

Si el incidente involucra datos personales, además se aplica lo que indica
`privacidad-datos.md`.

## Datos personales

El ambiente piloto guarda datos personales reales. Qué datos, con qué base
legal, quién accede y qué derechos tienen los titulares está en
`privacidad-datos.md`. En la operación: nada de capturas, exportaciones ni
cifras reales fuera del ambiente, y nunca dentro del repositorio.
