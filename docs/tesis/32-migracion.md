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

El plan numera doce pasos (M0 a M12). El importador cubre M3 a M8; M9 entra por el circuito de obtención automática de boletas; M10 a M12 se hacen por otros caminos o esperan al modelo que los recibe. El estado de cada paso al 4/11/2026 está en «Estado de la migración» más abajo.

| Paso | Qué | Cómo | Validación |
|---|---|---|---|
| M0 | Congelar las fuentes del corte (base de escritorio, recibos, acumuladores) | Copia de solo lectura fuera del repositorio, con su suma de verificación | La suma coincide con la de la entrega |
| M1 | Inmobiliaria y valores por defecto (vencimiento, día de generación, rezago del IPC, comisión, honorarios, tasación, umbral de anticipo, cadencia de cobranza) | Pantalla Configuración, Valores por defecto (`PUT /tenants/me/operational-defaults`) | La administración los revisa en pantalla |
| M2 | Usuarios: el administrador y cada persona del equipo con su rol | Pantalla Usuarios, invitación por correo | Cada persona entra con su rol |
| M3 | Personas: locadores (sin duplicados), inquilinos con su documento, garantes, apoderados, y sus cuentas bancarias | `persons[]` con `roles` y `bankAccounts` | El panel de calidad no muestra duplicados abiertos; cada locador con cuenta tiene CBU o alias válido |
| M4 | Propiedades: una por cada unidad del sistema anterior, con dirección normalizada, catastro, edificio y titularidad | `properties[]` con `parentExternalRef` y `owners` | La cantidad de propiedades es la esperada y ninguna tiene la dirección cortada |
| M5 | Contratos administrados con locadores y porcentaje de cobro, inquilinos, garantes, fechas, fin real donde hubo prórroga de palabra, reglas (índice, período, rezago, base, día de pago, flujo de cobro) y comisión | `contracts[]` con `status: Activo`, `lessors`, `terms` y `commission` | Todos los activos esperados y locadores que suman 100 % (`LESSOR_SHARES_INVALID` si no) |
| M6 | Contratos no vigentes y de sola intermediación, como historial | `contracts[]` con `status` `Vencido`, `Rescindido` o `Archivado`; `selfManaged: true` para el locador que cobra directo | La cuenta por estado coincide con el sistema anterior |
| M7 | Historial de alquileres y ajustes de los vigentes | `adjustmentsHistory` de cada contrato | El monto vigente reproduce el del mes de corte (`RENT_MISMATCH` si no); la fecha de cada ajuste cae en el calendario del contrato (`ADJUSTMENT_HISTORY_INVALID` si no) y de ella sale el período; los períodos posteriores al último ajuste quedan pendientes |
| M8 | Servicios y reglas de traslado (quién paga y en qué porcentaje) | `services[]` (uno por servicio o impuesto de cada propiedad o edificio) y `chargeRules[]` (una por contrato, servicio y fecha de inicio) | Por contrato, igual al recibo |
| M9 | Boletas del primer período en paralelo | Circuito de obtención automática (ADR-0018): PDF subido en *Boletas recibidas*, mail reenviado o, para lo que no se lee con certeza, revisión; la planilla *Boletas del mes* sigue sirviendo para corregir | Los totales coinciden con la planilla; cada boleta quedó asociada a su servicio por proveedor y cuenta |
| M10 | Saldos iniciales por locador (cuenta corriente), efectivo en custodia y de cada caja o banco, deudas y adelantos | Cuenta corriente: `POST /owners/:personId/opening-balance` (ADR-0009). Caja, banco y custodia: `POST /financial-accounts/:id/opening-balance`, pantalla Caja, Cuentas, *Saldo inicial* (ADR-0012). Un asiento por cuenta, con fecha de corte y motivo; reenviar lo mismo no cambia nada | La administración confirma cada saldo; la caja de cada moneda coincide con el arqueo del corte y la custodia con la suma de lo que se debe a los locadores en efectivo |
| M11 | Plantillas de contrato | Pantalla de plantillas, con el motor de bloques condicionales y listas | Contratos de prueba generados y comparados con los reales |
| M12 | Ventas en curso y documentación | Inventario de operaciones en curso; carga por el importador cuando se agregue la entidad | Estado confirmado |

### Qué valida el importador en M3 a M8

- **Forma de cada fila.** Los esquemas de `packages/shared` rechazan campos desconocidos, fechas mal escritas, enumeraciones inexistentes, CBU que no tienen 22 dígitos y CUIT con dígito verificador inválido. Cada problema queda en la fila, con su campo, y no frena al resto.
- **Referencias.** Una persona, una propiedad o un edificio que no existe en la inmobiliaria es `REFERENCE_NOT_FOUND`. Una referencia repetida dentro del lote es `DUPLICATE_IN_BATCH`; un CUIT ya usado por otra persona, `DUPLICATE_KEY`.
- **Contrato activo.** Locadores que suman 100 % en toda la vigencia, al menos un inquilino y ninguna otra locación activa que se superponga en la propiedad. La operación de alquiler de la propiedad queda `Alquilado` sin enviar ningún aviso.
- **Fechas.** El fin no puede ser anterior al inicio ni el fin real al inicio (`INVALID_DATES`).
- **Historial de ajustes.** Ordenado por período, sin períodos repetidos y encadenado: cada ajuste parte de donde terminó el anterior, el primero del alquiler inicial y el último termina en el monto vigente.
- **Servicios y reglas (M8).** Cada servicio lleva el `externalRef` que tenía en el sistema anterior y la referencia de su propiedad. Cada regla une un contrato y un servicio de la misma propiedad (o del edificio que la contiene) con quién paga y en qué proporción, y rige desde `validFrom`. Cada servicio puede traer `providerKey` (proveedor del catálogo de boletas automáticas, ADR-0018): con él la cuenta se guarda normalizada con el formato del proveedor, que es lo que permite que una boleta recibida por PDF encuentre al servicio aunque la fuente tuviera guiones, espacios o ceros de menos; una clave fuera del catálogo es `UNKNOWN_PROVIDER_KEY`, una cuenta que no cumple el formato `INVALID_PROVIDER_ACCOUNT` y un proveedor que no emite ese tipo de servicio `PROVIDER_SERVICE_TYPE_MISMATCH`. Un servicio de otra propiedad es `SERVICE_NOT_APPLICABLE`; un reparto `Fijo` sin importe, `VALIDATION_ERROR`; una fecha anterior al inicio del contrato, `INVALID_DATES`. Si el sistema anterior tenía un cambio de quién paga a mitad del contrato, se envían dos reglas con su fecha: la primera se cierra sola el día anterior a la segunda. Las reglas se cargan después de los contratos y los servicios, en el mismo lote o en uno posterior.
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

## Estado de la migración al 4 de noviembre de 2026

El 2/11/2026 se creyó completa la migración porque estaban cargados los pasos M0 a M7. El 3/11 se verificó que no lo estaba: faltaban los servicios y las reglas de traslado (M8), las boletas (M9), los saldos iniciales (M10), las plantillas (M11) y las ventas (M12). Esa corrección es un desvío declarado (`29-informe-final.md`, sección 9.8). Las cantidades de la cartera (contratos, servicios, reglas, filas cargadas) no se publican mientras el consentimiento de la inmobiliaria esté pendiente y figuran como «a completar tras el consentimiento de la inmobiliaria»; los datos de la cartera, la lista de revisión y las propuestas de carga viven fuera del repositorio.

| Paso | Estado | Qué hay |
|---|---|---|
| M0, M1 | Hecho | Fuentes congeladas con su suma de verificación; inmobiliaria y valores por defecto cargados |
| M2 | Parcial | Está el usuario Admin de la dirección, con un enlace de contraseña todavía sin usar; falta el resto del equipo |
| M3 a M7 | Hecho el 2/11 | Carga completa con el importador, después de un `dryRun` idéntico y sin filas con error. Contratos por estado, propiedades alquiladas y locadores de los activos reconciliados contra el origen |
| M8 | Hecho el 3/11 | Importador de servicios y reglas de traslado (#187); proveedor y cuenta normalizada (#227); formulario web de servicios (#231). Cantidad de servicios y reglas cargados: a completar tras el consentimiento de la inmobiliaria. Todos los contratos activos tienen sus reglas y el reenvío da todo `SinCambios` |
| M9 | Pendiente del ciclo | Las boletas de diciembre se cargan por el circuito automático antes de generar la liquidación; todavía no hay boletas cargadas en `piloto` |
| M10 | Propuesta lista, sin confirmar | Una propuesta de renglones (con los candidatos descartados explicados) para que la inmobiliaria confirme. El saldo inicial de una cuenta de caja o custodia tiene su endpoint desde el PR #197, integrado el 4/11; falta que la inmobiliaria confirme los saldos |
| M11 | PR abierto | Dos plantillas de contrato de vivienda preparadas (con y sin depósito). El motor ampliado está en el PR #199, abierto al 4/11 |
| M12 | Inventario hecho, carga pendiente | Operaciones de venta relevadas, separadas en las que están en curso y las históricas, que no se cargan (cantidades: a completar tras el consentimiento de la inmobiliaria). Faltan la entrada por lote y campos de la operación (ver abajo) |

### M8: servicios y reglas de traslado

M8 es el paso que más movía el importe del recibo, porque define qué parte de cada impuesto y servicio paga el inquilino, el locador o la inmobiliaria. Los servicios y las reglas se armaron desde las planillas y la base de escritorio. Los servicios que vienen sin importe en la ficha quedan en cero hasta que llega la boleta del período, igual que en la planilla. Con la ficha tomada como si fuera la boleta, el traslado de octubre reproduce el recibo salvo diferencias de centavos por redondeo en cuentas compartidas, donde Realfy reparte la boleta exacta y la ficha guardaba las partes redondeadas a mano.

El 4/11 se cargó además el proveedor y la cuenta normalizada de cada servicio (#227): los servicios cuyo proveedor está en el catálogo de boletas quedaron con la clave y la cuenta en el formato que lee el lector; los que tienen la cuenta faltante o inválida, o un proveedor que el catálogo no cubre, quedan sin clave y sus boletas irán a revisión en lugar de cargarse solas (cantidades: a completar tras el consentimiento de la inmobiliaria).

### M9: boletas por el circuito automático

La planilla del mes no escala con la cantidad de servicios, y los proveedores no ofrecen una interfaz de consulta, así que M9 dejó de ser una carga manual y pasó por la obtención automática de boletas (ADR-0018 y `29-informe-final.md`, sección 9.4). Lo que importa para la migración es el orden: las reglas de M8 rigen desde el 1/11/2026, de modo que sin boletas de diciembre el recibo sale sin impuestos y sin ninguna advertencia. En el primer ensayo del C1 esa falta explicó casi todas las diferencias del mes ensayado (ver `../calidad/12-piloto.md`, sección 10). Por eso las boletas de diciembre se cargan antes de generar la liquidación del C1.

### M10: saldos iniciales

Para M10 hay una propuesta armada con lo que el origen dice de cada locador y cada cuenta, que la inmobiliaria confirma renglón por renglón. La propuesta dejó dos brechas: el saldo inicial de una cuenta de custodia, que no tenía endpoint y que agregó el PR #197, integrado el 4/11 (un movimiento `SaldoInicial` por cuenta, auditado, con el negativo rechazado en una custodia), y el interés sobre los adelantos, que no tiene asiento y es una regla de dinero a decidir. Mientras no se confirme ni se cargue, la caja no cuadra desde el primer día con el efectivo que la inmobiliaria ya guarda por cuenta de sus locadores.

### M11: plantillas

Al probar el motor con el modelo de locación de vivienda de la inmobiliaria aparecieron brechas que no se resuelven con más plantillas: condicionales (con o sin depósito), listas (de uno a tres locatarios y de cero a cuatro garantes, singular y plural), importes y fechas en letras, canon inicial y datos de matrícula, y un Word y un PDF que no distinguían títulos ni negritas. El PR #199, abierto al 4/11, amplía el motor para eso sin evaluar código; hasta que se integre, las dos plantillas preparadas no se pueden cargar.

### M12: ventas en curso

El inventario de ventas dejó cuatro brechas del modelo actual, todas fuera del importador: dar de alta una operación en una etapa avanzada o con la reserva vencida, la falta de referencia externa y de entrada por lote, la falta de adjuntos y los campos de reserva, seña y escribano. El plan es agregar la entidad al lote en un pedido propio, después del importador de servicios, porque tocan los mismos archivos.

## Correcciones desde los documentos de contrato

La carga del 2/11 salió de la base de escritorio y las planillas. El 3/11 se comparó, por contrato activo, lo cargado contra el documento de contrato firmado, y el resultado cambió lo que Realfy haría en diciembre: algunos contratos no tenían documento, en una parte había una diferencia que cambia el importe de diciembre y en otra la diferencia era ambigua; además, había contratos con el ajuste del 1/11 salteado al importar y contratos activos con el fin pactado vencido y ningún ajuste (cantidades: a completar tras el consentimiento de la inmobiliaria). Las diferencias de datos eran de tipos repetidos: el rezago del índice, la cantidad de locatarios y garantes, los depósitos, los domicilios y los documentos de identidad.

Las correcciones se cargaron como un lote más, aprovechando que la importación es idempotente: filas de personas nuevas, personas actualizadas y contratos con cambios de términos (cantidades: a completar tras el consentimiento de la inmobiliaria); el reenvío inmediato dio todo `SinCambios`. De esto salió una regla de procedimiento: **el lote de reenvío es siempre el original más las correcciones fusionadas.** Reenviar solo el lote original desharía las correcciones, porque el importador aplica lo que el lote dice.

Después de arreglar el importador (DEF-125 a DEF-129) se reenvió el lote con las correcciones fusionadas: se corrigieron cronogramas, la mayoría de los contratos quedó sin cambios y algunos fueron rechazados con `ADJUSTMENT_HISTORY_INVALID` porque su historial no encadena con el calendario del contrato; esos conservan el cronograma anterior. Hay correcciones de alta confianza preparadas, otras condicionadas a la respuesta de la inmobiliaria y preguntas abiertas; antes de cargarlas hay que borrar los ajustes huérfanos de algunos contratos, y se ensaya primero en una copia restaurada (cantidades: a completar tras el consentimiento de la inmobiliaria). En la misma fecha se cargó el histórico del ICL (2.252 valores) y de la UVA (2.068) en la serie de sistema (DEF-121), sin días faltantes.

## Ensayos generales del primer ciclo

Antes del C1 se hicieron dos ensayos generales sobre una copia restaurada de `piloto` (ver `../calidad/12-piloto.md`, sección 10, con el método y los resultados): el 3/11, con el código de ese momento, y el 3 y 4/11, con las correcciones ya desplegadas. Del primero salieron once problemas (D1 a D11, registrados como veinte defectos, DEF-115 a DEF-143, en `../calidad/06-registro-de-defectos.md`) y del segundo dos más (E1 y E2, DEF-173 a DEF-176). Lo que importa para la migración es que casi todos estaban en cómo el importador deja el cronograma de ajustes, y que se descubrieron antes de que corriera el primer proceso diario de ajustes con efecto sobre datos reales.

Esa precaución se resume en una regla: **no se despliega a `piloto` un cambio que haga aplicar ajustes mientras el cronograma importado pueda estar mal.** Hasta que no estuvieron juntas las correcciones de índices, de cronograma, de prórroga y de ventana, el proceso diario habría aplicado sobre datos reales ajustes con ventanas o fechas equivocadas. Se desplegaron juntas el 3/11 (copia previa y ensayo de las migraciones sobre una copia restaurada: de 65 a 69). Aun así, antes del primer proceso de ajustes del 4/11 a las 07:00 quedaron retenidos algunos ajustes de contratos concretos: se marcaron como salteados en `piloto`, dentro de una transacción verificada, porque unos pertenecen a un contrato cuyo historial no coincide con su tipo de índice y otros a un contrato cuyo documento y cuyo lote difieren en la periodicidad. Hasta tener la respuesta de la inmobiliaria no se reenvía ningún lote que los toque, porque el importador los volvería a dejar pendientes.

## Qué no cubre

- Lo que el lote no informa no se modifica, y lo que desaparece del origen no se borra: una cuenta bancaria o un ajuste que se quita debe quitarse a mano en Realfy.
- Los conjuntos que la fila informa (titulares, inquilinos y garantes, locadores) se reemplazan completos: la fila debe traerlos todos.
- Las boletas (M9) no pasan por el importador sino por el circuito de ADR-0018. Los saldos iniciales, las plantillas y las ventas (M10 a M12) tienen todavía brechas, descriptas en «Estado de la migración».
