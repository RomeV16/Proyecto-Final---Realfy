# ADR-0007: Locadores por contrato, apoderados y titularidad de propiedades

## Estado

Aceptado.

## Fecha

2026-10-31.

## Contexto

El modelo original tenía una sola idea para todo lo que tiene que ver con quién
está del lado del dueño de un alquiler: la persona con el rol `Propietario`.
Ese rol se usaba para tres cosas distintas:

- **Quién firma el contrato como locador.** Es quien tiene la potestad de
  alquilar el inmueble: el titular, pero también un usufructuario, un
  sublocador o un acreedor al que se le cedió el cobro.
- **Quién cobra y a quién se le rinde.** La rendición mensual tomaba al primer
  propietario del contrato y le asignaba todo el neto.
- **Quién es titular de la propiedad.** Un vínculo opcional entre la asignación
  de rol y una propiedad.

Las tres cosas coinciden en el caso más simple y se separan en cuanto aparece un
caso real de administración:

- Un inmueble puede tener varios locadores, y lo que cobra cada uno es un
  acuerdo del contrato que no tiene por qué coincidir con su porcentaje de
  titularidad.
- Un locador puede cobrar por medio de otra persona, que actúa con un poder, y
  cotitulares pueden darse poder entre sí.
- Los poderes pueden exigir que firmen todos los apoderados juntos (firma
  conjunta) o permitir que firme cualquiera (indistinta), y pueden ser generales
  o valer solo para un contrato o una propiedad.
- Cuando el inmueble se transmite a mitad de un contrato cambia quién cobra a
  partir de una fecha, sin que cambie el contrato.

Con el modelo original nada de esto se podía expresar. Además el código tenía
doce lugares que "buscaban al propietario del contrato" cada uno a su manera, una
copia del alta de roles en cuatro servicios, y una regla incorrecta: para firmar
un contrato la persona tenía que tener ya el rol de propietario, de modo que un
apoderado, o un locador que no fuera titular, no podía figurar.

## Decisión

**El locador es una relación del contrato, no un rol de la persona.**

- Se agrega `ContractLessor`: persona, capacidad (`Propietario`, `Usufructuario`,
  `Sublocador`, `Acreedor` u `Otro`), porcentaje de cobro (`payoutPct`, hasta 4
  decimales), vigencia (`validFrom` incluido, `validTo` excluido), cobrador
  opcional (`payeePersonId`), cuenta opcional (`bankAccountId`) y una marca
  `needsReview` para lo que se migró por suposición.
- **El porcentaje de cobro es del contrato.** Los locadores vigentes en cada
  fecha del contrato suman exactamente 100 %. Se valida en los puntos donde
  importa: la activación (`LESSOR_SHARES_INVALID`, con las fechas que no
  cierran), cada cambio de los locadores de un contrato que ya salió de
  borrador, y la generación de la rendición. Como cambiar un reparto suele
  tocar varias filas a la vez, existe el reemplazo atómico del conjunto
  (`PUT /contracts/:id/lessors`); en borrador las altas sueltas no exigen la
  suma, que se exige al activar. Una cesión es dar de baja a un locador con
  `validTo` y dar de alta a otro con `validFrom` en la misma fecha.
- **El cobrador es un apoderado.** `payeePersonId` solo se acepta si esa persona
  tiene un poder vigente con alcance `Cobrar` del locador, sobre el contrato,
  su propiedad o general (`PAYEE_WITHOUT_POWER`). La cuenta tiene que ser del
  locador (`BANK_ACCOUNT_NOT_OF_LESSOR`). Un poder en uso no se puede revocar ni
  recortar (`POWER_IN_USE`).
- **Los poderes son una relación propia.** `PowerOfAttorney`: poderdante,
  apoderado, alcances (`Cobrar`, `Firmar`, `Administrar`), modo de firma
  (`Indistinta` o `Conjunta`), clave de grupo para la firma conjunta, contrato o
  propiedad opcionales (sin ninguno es un poder general), vigencia y documento.
  Con firma conjunta, los apoderados del mismo alcance comparten la clave de
  grupo y firman juntos. Dar un poder le agrega a la persona el rol `Apoderado`.
- **La titularidad es opcional y no decide pagos.** `PropertyOwnership`: persona,
  porcentaje opcional, título, desde y hasta. No se exige que sume 100: cuando
  los datos existen sirven para informar y para un aviso de calidad, nunca para
  repartir dinero.
- **El rol `Propietario` pasa a ser una etiqueta de cliente.** Un solo lugar la
  pone (`ensureRole`) y las altas de locadores, de titulares y de contratos la
  usan en vez de rechazar a quien no la tiene. `PersonRoleAssignment.propertyId`
  deja de escribirse (la titularidad vive en `PropertyOwnership`); la columna se
  conserva para poder volver atrás.
- **Una sola forma de leer las partes.** `getParty` y `getLessorsAt` reemplazan
  las búsquedas sueltas; `ContractPerson` queda para inquilino, garante y
  comprador. Los propietarios que llegan en `persons` al crear un contrato se
  guardan como locadores en partes iguales.
- **La rendición se reparte entre los locadores vigentes.** Se genera una
  rendición por locador con su parte de cada renglón, repartida por el método
  del mayor resto: la suma de las partes es el renglón y la de los netos es el
  neto total. No cambia ninguna regla de comisión; con un solo locador el
  resultado es el mismo que antes.
- **Migración de datos.** Cada propietario de un contrato pasa a ser locador con
  `100 / n` por ciento (la última fila lleva el resto para sumar exacto) y
  `needsReview` si `n > 1`; cada asignación de rol con propiedad pasa a
  titularidad sin porcentaje. Los datos viejos no se borran: la versión anterior
  puede seguir leyéndolos. El enum `PersonRole` suma `Apoderado` en una migración
  aparte, porque un valor nuevo de un enum no se puede usar en la transacción que
  lo agrega.

## Alternativas consideradas

- **Derivar el cobro del porcentaje de titularidad** (un modelo de titularidad
  con porcentajes que sumen 100, y de ahí el reparto). Es la propuesta que
  este ADR reemplaza. Se rechazó porque el cobro no es la titularidad: un
  titular puede cobrar más o menos de lo que le corresponde por acuerdo, un
  locador puede no ser titular, y obligar a que la titularidad sume 100 impide
  cargar inmuebles de los que solo se conoce una parte de los titulares. Cargaba
  además con un dato difícil de obtener para poder pagar.
- **Más roles en `ContractPerson`** (por ejemplo `Locador` y `Apoderado` como
  roles del contrato). No alcanza para el porcentaje, la vigencia, la cuenta ni
  el cobrador, y no permite que un poder exista fuera de un contrato.
- **Un campo `payoutPct` en la persona.** El reparto cambia por contrato y por
  fecha; en la persona no se puede.
- **Modelar el poder como un atributo del locador.** Un poder tiene sentido sin
  contrato (general) y lo usan varias personas; una tabla propia lo permite.

## Consecuencias

Positivas:

- El caso simple no cambia: un propietario es un locador con 100 %.
- Los casos reales se pueden cargar: varios locadores con reparto desigual,
  cobro por apoderado, cesión a mitad de contrato, poderes generales o acotados.
- La plata se reparte según lo acordado en el contrato y no según una titularidad
  que puede no estar cargada.
- Las partes del contrato y las etiquetas de rol se leen y se escriben en un solo
  lugar cada una.
- Un apoderado o un locador que no es titular puede firmar.

Negativas:

- Hay dos fuentes durante la transición: `ContractPerson` con rol `Propietario`
  (datos viejos, ya no se lee) y `ContractLessor`. Una migración posterior
  elimina las filas viejas cuando se confirme la nueva.
- Los porcentajes migrados con más de un propietario son una suposición; quedan
  marcados con `needsReview` hasta que alguien los confirme.
- Una rendición pasa a ser varias cuando hay varios locadores, y quien la
  consume (listados, correos, estado de cuenta) tiene que contemplarlo; la
  respuesta de generar devuelve la primera y la lista completa.
- Cambiar el reparto de un contrato activo exige reemplazar el conjunto de una
  vez, que es menos directo que editar una fila.
- La web solo muestra a los locadores en el detalle del contrato; las pantallas
  para cargarlos y para gestionar poderes y titularidad son un cambio aparte.
