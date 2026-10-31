# ADR-0010: Reglas versionadas del contrato y valores por defecto de la inmobiliaria

## Estado

Aceptado.

## Fecha

2026-10-31.

## Contexto

Las reglas de un alquiler (cómo y cada cuánto se ajusta, sobre qué base, con qué
rezago, qué día vence, quién cobra, qué descuento rige) vivían en columnas del
contrato (`adjustmentType`, `adjustmentPeriod`, `customAdjustmentPct`) y en
constantes del código (vencimiento, honorarios, rezago del IPC). Eso alcanzaba
mientras un contrato no cambiara, pero la administración real cambia contratos
todo el tiempo:

- una renegociación o una rebaja a mitad del contrato cambia el alquiler o la
  modalidad desde una fecha, y los períodos anteriores siguen siendo los que
  fueron;
- hay acuerdos de palabra (una prórroga sin contrato nuevo) y convenios con
  fecha de entrada en vigencia, a veces posterior a hoy;
- cada inmobiliaria tiene sus propios valores de arranque (día de vencimiento,
  comisión, honorarios, cadencia de cobranza) y hoy están fijos en el código;
- un ajuste ya calculado tiene que poder reconstruirse con las reglas que
  regían entonces, no con las de hoy.

Con columnas que se pisan, cada cambio destruye la regla anterior y deja la
historia en el registro de auditoría, de donde no se puede calcular nada.

## Decisión

**Una regla se resuelve por capas: defecto, contrato, acuerdo, y las reglas del
contrato se versionan en lugar de pisarse.**

- **Defecto.** `Tenant.operationalDefaults` (JSON, validado con
  `OperationalDefaultsSchema` del paquete compartido) guarda los valores de
  arranque de la inmobiliaria: vencimiento (día 10), anticipación de la
  liquidación (10 días, es decir el día 20), rezago del IPC (2 meses), comisión
  (7 %), honorarios (5 % alta, 5 % renovación, 3 % venta de construido, 5 % venta
  de lote), tasación (USD 100), umbral de anticipo (2 honorarios), cadencia de
  cobranza (primer recordatorio a los 5 días y luego cada 5) y umbrales del
  semáforo de vencimientos (rojo 0, amarillo 60). Si es nulo rigen los del
  código. Cada campo tiene su valor por defecto en el esquema, de modo que un
  JSON parcial es válido.
- **Contrato.** `ContractTermsVersion` es una foto de las reglas del contrato
  desde `validFrom`: modalidad y período de ajuste, base (`Original` o
  `Vigente`), rezago, meses fijos iniciales, porcentaje, escalones
  (`customSteps`), alquiler acordado, descuento (porcentaje o monto), día de
  vencimiento, flujo de cobro y configuración de punitorios. La clave es
  `[contractId, validFrom]`. La regla vigente a una fecha es la versión más
  reciente con `validFrom` anterior o igual (`getTermsAt`); lo que una versión
  no fija se toma del defecto (`resolveRule`).
- **Acuerdo.** `ContractAgreement` es un convenio fechado (renegociación,
  rebaja, bonificación, cambio de regla, de reparto o de cargo). Los cuatro
  primeros llevan un `termsPatch` que crea una versión nueva: copia de la
  vigente a la fecha del acuerdo más el cambio, en la misma transacción que el
  acuerdo. Un acuerdo se corrige o se borra solo si ninguna versión posterior
  depende de él.
- **Nunca se pisa la historia.** Un cambio de reglas es una versión nueva. Las
  columnas de ajuste de `contracts` quedan como la **vista vigente
  desnormalizada** y se actualizan en la misma transacción que crea o borra una
  versión cuando esta rige desde hoy o antes. Para un contrato sin convenios, la
  corrección directa de esas columnas (`PATCH /contracts/:id`) corrige también su
  versión inicial; con más de una versión, cambiar la modalidad por `PATCH` se
  rechaza (409 `RULES_CHANGE_REQUIRES_AGREEMENT`).
- **Períodos y fin efectivo.** `ContractPeriod` (original, renovación, prórroga)
  registra los tramos del contrato con su alquiler inicial, y `Contract` suma
  `actualEndDate` (fin real o prórroga de palabra) y `previousContractId`. El fin
  efectivo es `coalesce(actualEndDate, endDate)`. Un contrato pasado de su fin
  pactado sin fin real sigue liquidándose mientras esté `Activo` (decisión D-3):
  no hay vencimiento automático.
- **Índices estimados.** `IndexData.isEstimate` y `estimateSource` (por ejemplo
  REM) permiten cargar un valor esperado; el oficial lo reemplaza bajo la misma
  clave `[tenantId, indexType, period]`, y queda registrado qué se había estimado
  (`GET /index-data/estimates-replaced`). El cálculo de ajustes sigue usando solo
  valores oficiales hasta que el motor de ajuste (PR siguiente) use los
  estimados con ajuste provisional (`ContractAdjustment.isProvisional`,
  `trueUpOfId`).
- **Migración.** Cada contrato existente recibe un período original y una
  versión inicial con sus columnas de hoy: base `Vigente` (es lo que el motor
  actual hace, aplica el índice sobre el alquiler vigente), rezago 0 (el motor
  actual cierra la ventana del índice en el mes del ajuste), vencimiento el día
  10 y flujo `Partido`. El cálculo de los contratos existentes no cambia. Los
  contratos nuevos, y los importados del sistema anterior, toman el rezago de la
  inmobiliaria: 2 meses por defecto, la regla de la inmobiliaria piloto.

## Alternativas descartadas

- **Pisar las columnas y dejar la historia en la auditoría.** Es lo que había.
  Obliga a reconstruir las reglas de una fecha leyendo el registro de cambios, y
  un cambio con fecha futura no se puede expresar sin un planificador aparte.
- **Event sourcing completo** (reconstruir todo el contrato desde sus eventos).
  Resuelve la historia pero obliga a reescribir todos los lectores del contrato y
  a mantener proyecciones; para un puñado de reglas que cambian pocas veces por
  contrato es desproporcionado.
- **Guardar el cambio como una lista de modificaciones sobre el contrato** (sin
  foto completa). Obliga a replicar todos los cambios para saber la regla de una
  fecha; la foto completa hace que la consulta sea una sola búsqueda.

## Consecuencias

Positivas:

- La regla de cualquier fecha sale de una consulta, y un ajuste aplicado se puede
  reconstruir con las reglas de entonces.
- Los acuerdos con fecha futura entran sin planificador: la versión ya existe y
  rige cuando llega su fecha.
- Cada inmobiliaria cambia sus valores de arranque sin tocar el código, y un
  contrato nuevo nace con ellos.

Negativas:

- Hay dos fuentes durante la transición: las columnas del contrato y la versión
  vigente. Se mantienen en sincronía al escribir, y el cálculo de ajustes ya lee
  la versión; el resto de los lectores sigue con las columnas.
- Un acuerdo con fecha futura no actualiza las columnas hasta que se escriba
  otra versión o se edite el contrato: quien lea las columnas ve la regla
  anterior. Los lectores nuevos deben pedir la versión a la fecha.
- Los tableros y las notificaciones de vencimiento siguen leyendo `endDate`;
  pasar al fin efectivo es un cambio posterior.
- Base, rezago, escalonado y UVA se guardan pero todavía no cambian el cálculo.
