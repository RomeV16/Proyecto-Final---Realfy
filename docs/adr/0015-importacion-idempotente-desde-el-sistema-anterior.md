# ADR-0015: Importación idempotente desde el sistema anterior

## Estado

Aceptado.

## Fecha

2026-11-01.

## Contexto

La inmobiliaria piloto administra hoy su cartera con una base de escritorio y
planillas. Para el primer ciclo en paralelo hay que cargar en el ambiente
`piloto` (ADR-0014) las personas con sus cuentas, las propiedades, los contratos
vigentes con locadores, porcentajes y reglas, los contratos no vigentes como
historial (FB-04: pueden reingresar) y el historial de ajustes de los vigentes,
de modo que el monto vigente reproduzca el del mes de corte.

Tres hechos condicionan cómo se carga:

- **Se va a cargar más de una vez.** El plan de migración exige ensayar contra
  una copia cada vez que cambia el modelo, comparar con los datos del relevamiento
  y repetir hasta que no queden diferencias sin explicar. Una carga que no se
  pueda repetir sin duplicar obliga a vaciar la base entre ensayos, y eso no se
  puede hacer en `piloto` una vez que hay uso real.
- **Los datos reales no pueden estar en el repositorio.** El repositorio es
  público. Las extracciones, las correcciones de datos y los mapeos del sistema
  anterior viven fuera de él, en scripts de migración que solo conocen el formato
  del sistema anterior.
- **El importador de planillas existente no alcanza.** `POST /import/upload`,
  `validate` y `execute` crean personas y propiedades sueltas a partir de un CSV
  con columnas mapeadas a mano; no conocen contratos, locadores, reglas ni
  historial, no pueden actualizar lo ya cargado (cada corrida crea de nuevo) y
  guardan el archivo subido en la memoria del proceso.

## Decisión

**El importador es una API de lotes en JSON que hace upsert por la referencia
externa de cada registro, con ensayo (`dryRun`) y un registro por fila; las
extracciones y los mapeos se quedan en scripts externos.**

- **Contrato JSON, no archivo.** `POST /import/batches` recibe
  `{ dryRun, atomic?, kind?, persons?, properties?, contracts?, services?,
  chargeRules? }`. Los esquemas de cada fila están en `packages/shared`
  (`ImportPersonSchema`, `ImportPropertySchema`, `ImportContractSchema`,
  `ImportServiceSchema`, `ImportChargeRuleSchema`). El script externo traduce el
  sistema anterior a ese formato; el repositorio solo conoce el formato de
  Realfy. La carga por CSV de la pantalla de importación sigue como está.
- **Idempotencia por `[tenantId, externalRef]`.** Cada fila se busca por su
  referencia externa dentro de la inmobiliaria. Si no existe se crea; si existe
  se comparan los campos que la fila informa y solo se escribe lo que cambió. El
  resultado de cada fila es `Creado`, `Actualizado` o `SinCambios` (o `Error`), de
  modo que volver a correr el mismo lote termina con todo en `SinCambios`. Un
  campo que la fila no informa no se toca: la fila no borra lo que el sistema
  guardó después. Las referencias entre filas (propietario de una propiedad,
  locador o inquilino de un contrato, edificio de una unidad) se resuelven por
  referencia externa dentro de la misma inmobiliaria, nunca por id.
- **Orden y alcance de lo que reemplaza.** Dentro del lote se procesan personas,
  propiedades (los edificios antes que sus unidades) y contratos. Los conjuntos
  hijos que la fila informa (titulares, inquilinos y garantes, locadores) se
  reemplazan como conjunto si difieren; las cuentas bancarias y el historial de
  ajustes se agregan y corrigen, pero no se borran. Los roles de una persona se
  aseguran con `ensureRole` y no se quitan.
- **Ensayo y registro.** Con `dryRun` el lote corre entero dentro de una
  transacción que se deshace al final: las acciones que devuelve son exactamente
  las que habría hecho la ejecución, incluidas las referencias a filas del mismo
  lote. Cada corrida deja un `ImportBatch` (modo, estado, totales por entidad y
  acción) y un `ImportRowLog` por fila (entidad, referencia, acción, id resultante
  y los errores con código y campo), que se consulta por la API y por la pantalla
  de configuración, y se descarga como CSV para corregir el origen.
- **Una fila con error no frena el lote.** Por defecto cada fila va en su propia
  transacción: la que falla se deshace y queda registrada con su código
  (`REFERENCE_NOT_FOUND`, `LESSOR_SHARES_INVALID`, `RENT_MISMATCH`...), y el lote
  termina `Completado` con la cuenta de errores. Con `atomic` el lote entero es
  una transacción: si alguna fila falla no se escribe nada y queda `Fallido`.
  Ambos modos conviven porque sirven a momentos distintos: el ensayo y la carga
  inicial toleran errores y se corrigen en el origen; la carga final de un corte
  se quiere todo o nada.
- **Servicios y reglas de traslado (M8).** El servicio se identifica como las
  demás entidades, por `[tenantId, externalRef]` (columna nueva en `Service`, con
  varios NULL permitidos), y se liga a su propiedad con `propertyRef`. La regla no
  tiene referencia propia: su clave es `[contrato, servicio, validFrom]`, la misma
  del modelo (`ContractChargeRule`). Respeta la semántica de versiones de ADR-0008:
  una regla nueva cierra la vigente el día anterior y nunca la pisa. Esa lógica
  (`insertRuleVersion`) es la misma que usa el alta manual, no una copia. Con la
  misma fecha y otros valores la regla se corrige en su lugar, salvo que ya se
  haya usado en una liquidación (`CHARGE_RULE_IN_USE`); con otra fecha y los
  mismos valores que la vigente no se agrega una versión. Al cambiar una regla se
  recalculan las partes de las boletas del servicio, como en el alta manual. A
  diferencia del alta manual, el lote no exige el acuerdo `CambioCargo` en un
  contrato en vigencia: carga el estado ya pactado, no un cambio. Se procesan
  después de los contratos (personas, propiedades, contratos, servicios, reglas),
  así que una regla puede apuntar a un servicio del mismo lote. Un servicio de otra
  propiedad (que no sea la del contrato ni su edificio) es `SERVICE_NOT_APPLICABLE`.
- **Los datos importados no disparan efectos.** Un contrato importado como
  `Activo` no pasa por la activación: no envía avisos ni genera nada más que sus
  datos; solo deja la operación de alquiler de la propiedad en `Alquilado`, por el
  mismo camino de transiciones que la activación (`property-occupancy.ts`), y la
  libera si el contrato deja de estar activo. Se exigen las invariantes que el
  alta manual también exige a un contrato activo: locadores que suman 100 %, al
  menos un inquilino y ningún otro contrato activo que se superponga en la
  propiedad.
- **El rezago de un contrato nuevo es el de la inmobiliaria; el de uno ya cargado
  no se pisa** (ADR-0011): al crear, `indexLagMonths` toma el valor de la fila o el
  `ipcLagMonths` de los valores por defecto; al actualizar se conserva el
  guardado, de modo que cambiar el valor por defecto no mueve contratos ya
  importados.
- **El historial de ajustes se valida antes de escribirse.** Cada ajuste parte de
  donde terminó el anterior, el primero del alquiler inicial y el último tiene que
  dar el monto vigente de la fila (`rentAmount`). Si no, la fila falla con
  `ADJUSTMENT_HISTORY_INVALID` o `RENT_MISMATCH`: "el monto vigente reproduce el
  de octubre" es una condición de la carga y no una comprobación posterior.
- **Aislamiento.** El importador es solo para el administrador. Todo se lee y
  escribe con la inmobiliaria del usuario: un lote de otra inmobiliaria no se ve
  (404 y no 403, como el resto de la API, ADR-0006), y una referencia externa no
  resuelve registros ajenos aunque coincida. `ImportBatch` e `ImportRowLog`
  están en el filtro por inmobiliaria.
- **Tamaño.** El cuerpo JSON admite hasta 25 MB, suficiente para una cartera de
  cientos de contratos con su historial en un solo lote.

```mermaid
sequenceDiagram
    autonumber
    participant S as Script de migración (fuera del repo)
    participant A as POST /import/batches
    participant D as Base de datos
    S->>A: persons, properties, contracts (JSON) con dryRun = true
    A->>D: transacción única con un punto de guarda por fila
    A-->>S: acción y errores de cada fila; todo se deshace
    S->>S: corrige el origen hasta que no queden errores
    S->>A: el mismo lote con dryRun = false
    A->>D: upsert por externalRef (una transacción por fila, o todo junto con atomic)
    A->>D: ImportBatch y ImportRowLog
    A-->>S: Creado, Actualizado, SinCambios o Error por fila
    S->>A: de nuevo el mismo lote
    A-->>S: todo SinCambios (idempotente)
```

## Alternativas consideradas

- **Scripts de SQL de una sola vez, escritos contra la base.** Se rechazó. No se
  pueden repetir sin duplicar ni deshacer (hay que vaciar y recargar), no validan
  nada de lo que valida la API (locadores que suman 100 %, contratos que se
  superponen, rezago, estados de la propiedad), se saltean el filtro por
  inmobiliaria y se acoplan al esquema: cada migración del modelo los rompe sin
  aviso. Tampoco dejan registro de qué pasó con cada fila.
- **Ampliar el importador de CSV con más entidades y columnas.** Se rechazó. El
  mapeo por columnas no representa estructuras anidadas (locadores con porcentaje
  y cuenta, historial de ajustes por contrato) y obliga a aplanar los datos en
  planillas que alguien tiene que armar a mano. El CSV se conserva para la carga
  manual de personas y propiedades sueltas.
- **Poner los extractores y los mapeos en el repositorio.** Se rechazó: son
  específicos del sistema anterior y de la inmobiliaria, y trabajan con datos
  reales, que no pueden estar en un repositorio público.
- **Resolver las referencias por id.** Se rechazó: el sistema anterior no conoce
  los ids de Realfy, y exigirlos obligaría a guardar una tabla de equivalencias
  fuera de la base. La referencia externa ya existe, es única por inmobiliaria y
  es estable entre ensayos.

## Consecuencias

- Los ensayos son baratos y seguros: se corre el lote con `dryRun`, se corrige el
  origen y se repite, sin tocar la base. El mismo lote sirve para el ensayo contra
  una copia y para `piloto`.
- Una fila corregida en el origen se vuelve a enviar y actualiza lo cargado sin
  duplicarlo ni borrar lo que el sistema creó después; los hijos informados
  (locadores, titulares, partes) se reemplazan como conjunto, así que la fila debe
  traerlos completos.
- Lo que el lote no informa no se toca, pero tampoco se borra lo que ya no figura:
  una cuenta bancaria o un ajuste que se quita del origen sigue en Realfy hasta que
  se borre a mano. Es el costo de no destruir datos al reimportar.
- El registro por fila queda como evidencia de la migración (cuántas filas, cuáles
  fallaron y por qué) para la reconciliación y para el informe.
- El importador cubre personas, propiedades, contratos con sus reglas, comisión e
  historial de ajustes, y servicios con sus reglas de traslado por contrato (pasos
  M3 a M8). Boletas, saldos iniciales y plantillas (pasos M9 a M11 del plan) se
  agregan al registro de importadores cuando existan sus modelos.
- Cada modelo nuevo importable debe sumarse al registro `ENTITY_IMPORTERS` con su
  esquema y su upsert, y a las pruebas de idempotencia (`SinCambios` al repetir).
