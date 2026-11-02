# Migración desde el sistema anterior

Este capítulo describe cómo se pasa la cartera de la inmobiliaria piloto del sistema que usa hoy a Realfy: los pasos, qué se valida en cada uno, cómo se ensaya contra una copia antes de tocar el ambiente `piloto` y cómo se reconcilia el primer ciclo en paralelo. Describe el procedimiento y no contiene datos de la inmobiliaria: el repositorio es público y las extracciones, los mapeos y las correcciones de datos viven fuera de él (ADR-0014 y ADR-0015). El contexto del piloto está en `30-piloto.md` y el registro de hallazgos en `31-registro-de-feedback.md`.

## Principios

- **Se migra lo vigente con su regla; lo no vigente, como historial; lo dudoso, marcado para revisión.** Un contrato vencido o rescindido se carga igual (puede reingresar, FB-04) pero no ocupa la propiedad ni genera ajustes pendientes. Un reparto entre locadores que el sistema anterior no distingue se carga con `needsReview` y se confirma en pantalla.
- **Todo se corre primero contra una copia.** Cada paso se ensaya con `dryRun` y se corrige en el origen hasta que no queden errores. Recién entonces se ejecuta en `piloto`.
- **La carga se puede repetir.** El importador hace upsert por la referencia externa de cada registro (ADR-0015): volver a enviar el mismo lote deja todo `SinCambios` y enviar una corrección actualiza solo lo que cambió. No hace falta vaciar la base entre ensayos.
- **Los datos reales no entran al repositorio.** Los scripts de extracción y mapeo, las planillas intermedias y los informes de diferencias se guardan fuera del repositorio. Lo que sí está en el repositorio es el formato del lote (`packages/shared`, `docs/api.md`) y las pruebas con datos sintéticos.

## Cómo funciona el importador

Un script de migración externo lee el sistema anterior, lo traduce al formato de lote y lo envía a `POST /import/batches` con una sesión de administrador. La respuesta trae, para cada fila, la acción (`Creado`, `Actualizado`, `SinCambios` o `Error`), el registro resultante y los errores con código y campo. El mismo registro queda guardado y se ve en Configuración, Importaciones, donde se filtra por acción y se descarga en CSV para corregir el origen.

| Modo | Cuándo se usa |
|---|---|
| `dryRun: true` | Siempre primero. Corre el lote entero dentro de una transacción que se deshace: devuelve las acciones exactas sin escribir nada. |
| `dryRun: false` | Carga por fila: cada fila en su transacción, una con error se registra y las demás siguen. Es el modo de los ensayos contra una copia. |
| `dryRun: false`, `atomic: true` | Todo o nada: si alguna fila falla no se escribe nada y el lote queda `Fallido`. Es el modo de la carga final en `piloto`. |

Las referencias entre filas se resuelven por `externalRef` dentro de la inmobiliaria. En un mismo lote se procesan primero las personas, luego las propiedades (los edificios antes que sus unidades) y por último los contratos, así que un lote puede traer todo junto. El formato completo de cada entidad y los códigos de error están en `docs/api.md`.

## Pasos

El plan numera doce pasos (M0 a M12). El importador cubre M3 a M7; los demás se hacen por otros caminos o esperan al modelo que los recibe.

| Paso | Qué | Cómo | Validación |
|---|---|---|---|
| M0 | Congelar las fuentes del corte (base de escritorio, recibos, acumuladores) | Copia de solo lectura fuera del repositorio, con su suma de verificación | La suma coincide con la de la entrega |
| M1 | Inmobiliaria y valores por defecto (vencimiento, día de generación, rezago del IPC, comisión, honorarios, tasación, umbral de anticipo, cadencia de cobranza) | Pantalla Configuración, Valores por defecto (`PUT /tenants/me/operational-defaults`) | La administración los revisa en pantalla |
| M2 | Usuarios: el administrador y cada persona del equipo con su rol | Pantalla Usuarios, invitación por correo | Cada persona entra con su rol |
| M3 | Personas: locadores (sin duplicados), inquilinos con su documento, garantes, apoderados, y sus cuentas bancarias | `persons[]` con `roles` y `bankAccounts` | El panel de calidad no muestra duplicados abiertos; cada locador con cuenta tiene CBU o alias válido |
| M4 | Propiedades: una por cada unidad del sistema anterior, con dirección normalizada, catastro, edificio y titularidad | `properties[]` con `parentExternalRef` y `owners` | La cantidad de propiedades es la esperada y ninguna tiene la dirección cortada |
| M5 | Contratos administrados con locadores y porcentaje de cobro, inquilinos, garantes, fechas, fin real donde hubo prórroga de palabra, reglas (índice, período, rezago, base, día de pago, flujo de cobro) y comisión | `contracts[]` con `status: Activo`, `lessors`, `terms` y `commission` | Todos los activos esperados y locadores que suman 100 % (`LESSOR_SHARES_INVALID` si no) |
| M6 | Contratos no vigentes y de sola intermediación, como historial | `contracts[]` con `status` `Vencido`, `Rescindido` o `Archivado`; `selfManaged: true` para el locador que cobra directo | La cuenta por estado coincide con el sistema anterior |
| M7 | Historial de alquileres y ajustes de los vigentes | `adjustmentsHistory` de cada contrato | El monto vigente reproduce el del mes de corte (`RENT_MISMATCH` si no) |
| M8 | Servicios y reglas de traslado (quién paga y en qué porcentaje) | Cuando exista su modelo (ADR-0008) | Por contrato, igual al recibo |
| M9 | Boletas del primer período en paralelo | Carga del mes en pantalla | Los totales coinciden con la planilla |
| M10 | Saldos iniciales por locador, efectivo en custodia, deudas y adelantos | Cuando exista su modelo (ADR-0009 y ADR-0012) | La administración confirma cada saldo |
| M11 | Plantillas de contrato | Pantalla de plantillas | Contratos de prueba generados y comparados con los reales |
| M12 | Ventas en curso y documentación | Cuando exista su modelo | Estado confirmado |

### Qué valida el importador en M3 a M7

- **Forma de cada fila.** Los esquemas de `packages/shared` rechazan campos desconocidos, fechas mal escritas, enumeraciones inexistentes, CBU que no tienen 22 dígitos y CUIT con dígito verificador inválido. Cada problema queda en la fila, con su campo, y no frena al resto.
- **Referencias.** Una persona, una propiedad o un edificio que no existe en la inmobiliaria es `REFERENCE_NOT_FOUND`. Una referencia repetida dentro del lote es `DUPLICATE_IN_BATCH`; un CUIT ya usado por otra persona, `DUPLICATE_KEY`.
- **Contrato activo.** Locadores que suman 100 % en toda la vigencia, al menos un inquilino y ninguna otra locación activa que se superponga en la propiedad. La operación de alquiler de la propiedad queda `Alquilado` sin enviar ningún aviso.
- **Fechas.** El fin no puede ser anterior al inicio ni el fin real al inicio (`INVALID_DATES`).
- **Historial de ajustes.** Ordenado por período, sin períodos repetidos y encadenado: cada ajuste parte de donde terminó el anterior, el primero del alquiler inicial y el último termina en el monto vigente.
- **Rezago.** Un contrato nuevo toma el rezago de la fila o el de la inmobiliaria (2 meses por defecto); uno que ya está cargado conserva el suyo (ADR-0011).

## Ensayo contra una copia

1. Restaurar una copia reciente del ambiente `piloto` (o una base vacía con las migraciones aplicadas) en un ambiente de prueba, con su propia inmobiliaria y un usuario administrador.
2. Cargar los valores por defecto (M1) igual que en `piloto`.
3. Enviar el lote completo con `dryRun: true` y mirar los errores por fila (pantalla de Importaciones o `GET /import/batches/:id/rows?action=Error`). Corregir en el origen y repetir hasta que no haya errores.
4. Enviar el lote con `dryRun: false` y verificar contra el sistema anterior las cuentas de cada paso (cantidad de personas, propiedades, contratos por estado, montos vigentes).
5. Enviar el mismo lote otra vez: todas las filas tienen que dar `SinCambios`. Una fila `Actualizada` sin que el origen haya cambiado es un defecto del mapeo o del importador y se registra.
6. Producir el informe de diferencias contra los datos del relevamiento. Cada vez que cambia el modelo se repite el ensayo completo. Se sigue hasta que no queden diferencias sin explicar; cada diferencia explicada se registra como hallazgo (FB) o defecto (DEF).

Recién con el ensayo en cero se hace la carga en `piloto`: primero un `dryRun`, y después el lote final con `atomic: true`.

## Carga en `piloto`

1. Hacer una copia de seguridad del ambiente (`docs/operacion-piloto.md`).
2. Enviar el lote con `dryRun: true`. Sin errores, seguir.
3. Enviar el lote con `dryRun: false` y `atomic: true`. Si queda `Fallido`, no se escribió nada: corregir y repetir.
4. Revisar en Importaciones el resumen por entidad y contrastarlo con las cuentas del ensayo.
5. Confirmar en pantalla los repartos marcados con `needsReview` y los datos que el relevamiento dejó como dudosos.

## Reconciliación del primer ciclo

La aceptación del piloto es que el ciclo del mes en paralelo coincida con el del sistema anterior (`30-piloto.md`). Para ese mes se compara:

- por cada contrato: el total del recibo, la comisión y el neto al locador;
- por cada locador: el total del estado de cuenta.

La diferencia tiene que ser cero o estar explicada y registrada como hallazgo o defecto. Como la importación es repetible, una corrección de datos descubierta en la reconciliación se arregla en el origen y se vuelve a enviar el lote: las filas que cambian dan `Actualizado` y las demás `SinCambios`, y el registro de cada corrida queda como evidencia.

## Cerrar la reconciliación dentro de la aplicación

La lista de diferencias que queda después de la carga (documentos faltantes, personas cargadas dos veces, repartos que no suman 100 %, contratos vencidos sin resolver) se trabaja en `/calidad-de-datos` (manual de usuario, *Calidad de datos*), sin salir de Realfy y sin volver a enviar el lote:

| Qué deja la migración | Dónde se ve | Cómo se cierra |
|---|---|---|
| Personas cargadas dos veces con el CUIT, el DNI, la cuenta, el teléfono, el correo o el nombre escritos distinto | *Personas repetidas* | *Unir* (Admin): los contratos, titularidades y cuentas pasan a una sola persona y la otra queda dada de baja, con auditoría |
| Reparto en partes iguales marcado `needsReview` que no suma 100 % | *Locadores que no suman 100 %* | corregir los locadores del contrato |
| Propiedades sin titular o con partes que no suman, locadores sin CUIT ni DNI, cobros por transferencia sin cuenta | *Titularidades* | completar la ficha de la persona o de la propiedad |
| Contratos que el sistema anterior dejó vencidos sin renovación ni cierre | *Vencidos sin decisión* | renovar o cerrar el contrato |
| Contratos activos sin inquilino, alquiler o porcentaje de ajuste | *Contratos activos incompletos* | completar el contrato |

Cada corrección hace desaparecer el hallazgo en la consulta siguiente, así que el recuento de arriba es el avance de la reconciliación: se llega a cero, o lo que queda se explica como dato legítimo (un teléfono compartido por una familia). Una persona unida conserva su `externalRef`: si el origen se vuelve a enviar, la fila se aplica sobre la persona dada de baja y no la reactiva, por lo que las uniones se hacen una vez que el lote es el definitivo. El panel no guarda nada propio: no hay "resuelto" ni "ignorado", sólo el estado actual de los datos.

## Qué no cubre

- Lo que el lote no informa no se modifica, y lo que desaparece del origen no se borra: una cuenta bancaria o un ajuste que se quita debe quitarse a mano en Realfy.
- Los conjuntos que la fila informa (titulares, inquilinos y garantes, locadores) se reemplazan completos: la fila debe traerlos todos.
- Servicios, boletas, saldos iniciales, plantillas y ventas (M8 a M12) se incorporan al importador cuando existan los modelos que los reciben.
