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
2. Desplegar a `production`:
   ```bash
   railway up --service api --environment production --detach
   railway up --service web --environment production --detach
   ```
3. Verificar en `production`: `/api/health` responde `ok` con `db: connected`,
   se puede iniciar sesión y abre al menos una pantalla.
4. Si el cambio incluye una migración con relleno de datos, hacer antes la copia
   previa (ver la sección siguiente).
5. Desplegar a `piloto` con los mismos comandos y `--environment piloto`.
6. Repetir la verificación del paso 3 en `piloto`.
7. Si algo falla en `piloto`, ir a «Incidentes» antes de intentar corregir sobre
   la marcha.

No se despliega en horario de uso de la inmobiliaria ni en los días de cierre de
mes, salvo para corregir un incidente.

## Copia previa a una migración con relleno

Una migración que reescribe o rellena datos existentes no se aplica por primera
vez sobre los datos reales.

1. Tomar una copia lógica con `pg_dump -Fc` a través de `railway ssh`, guardarla
   en el servidor del equipo con permisos 600 y verificarla con `pg_restore -l`
   y un `sha256`.
2. Restaurar esa copia en un PostgreSQL local.
3. Aplicar la migración sobre la copia local con `prisma migrate deploy` y
   revisar los resultados: conteos antes y después, filas que el relleno debía
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
7. Registrar el tiempo total: es la medición del RTO (meta de 2 horas o menos).

La restauración se ensaya en local después de cargar los datos reales y antes de
cada cierre de ciclo, no solo cuando hace falta.

## Cierre de mes

Lista de verificación, en el orden del ciclo (ver `tesis/30-piloto.md`):

- [ ] Ajustes: previsualizados, revisados y aplicados.
- [ ] Boletas de impuestos y servicios del período cargadas.
- [ ] Liquidaciones generadas.
- [ ] Liquidaciones aprobadas y enviadas a los inquilinos.
- [ ] Cobros registrados.
- [ ] Estado de cuenta de cada locador generado.
- [ ] Reconciliación contra el método actual de la inmobiliaria, con las
  diferencias anotadas.
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
