# ADR-0014: Ambiente piloto con datos reales

## Estado

Aceptado.

## Fecha

2026-10-31.

## Contexto

Hasta ahora Realfy tuvo un único ambiente desplegado, el de demostración de la
defensa, con datos sintéticos. El piloto (ver `docs/tesis/30-piloto.md`) cambia
eso: una inmobiliaria real va a llevar su ciclo mensual en el sistema, con datos
personales reales de locadores, inquilinos y garantes, y con dinero de por medio.

Eso no puede convivir con la demostración. La base de la demostración se
reinicia y se vuelve a cargar cuando hace falta, y nadie debería tener que
pensarlo dos veces antes de hacerlo. Comparte además secretos con el resto del
trabajo de la tesis. Mezclar datos reales con ese ambiente expondría a la
inmobiliaria a un borrado accidental y a un acceso más amplio del que
corresponde.

A esto se suma que el repositorio es público: cualquier dato, dominio o
credencial que se escriba en él queda expuesto.

Y hay un tercer problema que apareció al preparar el ambiente: la imagen
`minio/minio` fue retirada de Docker Hub, con lo cual el almacenamiento de los
dos ambientes dependía de una imagen que ya no se podía descargar.

## Decisión

- **Ambiente separado en el mismo proyecto.** El proyecto de Railway tiene dos
  ambientes: `production`, que es la demostración con datos sintéticos, y
  `piloto`, con los datos reales. Cada uno tiene su propia base, su propio
  almacenamiento, su API y su web, y sus propios secretos: contraseña de la
  base, contraseña del almacenamiento, `JWT_SECRET` y `ARCA_MASTER_KEY`.
- **Despliegues manuales y controlados.** Se hacen con `railway up`, solo desde
  `main` con la integración continua en verde, primero en `production` y, una
  vez verificado, en `piloto`.
- **Copias de seguridad en dos capas.** Copias nativas de Railway diarias y
  semanales sobre la base y el almacenamiento del piloto, más una copia lógica
  semanal fuera del proveedor, con restauración probada.
- **Nada real en el repositorio.** Ni datos, ni dominios, ni credenciales, ni
  identificadores de recursos del ambiente piloto. Las URL se guardan en la
  configuración privada del equipo.
- **Demostración sintética.** `production` no recibe nunca datos reales.
- **Imagen de almacenamiento fijada por versión.** Ambos ambientes usan
  `bitnamilegacy/minio:2025.7.23-debian-12-r5`.

Los procedimientos están en `docs/despliegue.md` y `docs/operacion-piloto.md`.

## Alternativas consideradas

- **Un proyecto de Railway aparte.** Aísla todavía más, incluso en permisos y
  facturación. Se descartó por ahora porque duplica la configuración que hay que
  mantener sincronizada y no agrega una protección que los ambientes separados
  con secretos propios no den para el tamaño de este piloto. Sigue siendo el
  camino natural cuando el trabajo pase a una organización propia.
- **El mismo ambiente con una inmobiliaria separada (tenant).** El aislamiento
  por inmobiliaria (ADR-0003 y ADR-0006) ya impide que una vea los datos de otra.
  Se descartó porque la demostración se reinicia y se carga con datos de prueba,
  y porque comparte secretos y base física con los datos reales: un reinicio, un
  `migrate reset` o una clave filtrada alcanzarían a ambos. El aislamiento por
  tenant protege de errores de la aplicación, no de errores de operación.

## Consecuencias

Positivas:

- Un error en la demostración no puede tocar los datos reales, y viceversa.
- Un secreto del ambiente de demostración comprometido no compromete al piloto.
- La política de despliegue usa a `production` como ensayo de cada cambio antes
  de que llegue a `piloto`.
- La pérdida de datos queda cubierta por dos capas: las copias nativas del
  proveedor y una copia fuera de él.

Negativas:

- Cada despliegue se hace dos veces y a mano. Es lento y depende de que alguien
  se acuerde de verificar; el runbook existe para reducir ese riesgo.
- Las variables del proyecto son valores literales, así que al duplicar un
  ambiente hay que sobrescribir a mano todas las que apuntan a otro ambiente. Un
  olvido hace que el piloto hable con la demostración.
- La copia externa semanal deja un RPO de 7 días si la nativa no está
  disponible, y el RTO todavía no está medido con datos reales.
- La imagen de almacenamiento sigue siendo de un tercero, ahora en un
  repositorio «legacy»: fijarla por versión evita cambios sorpresivos pero no
  garantiza que siga publicada. A mediano plazo hay que evaluar otro
  almacenamiento compatible con S3.
