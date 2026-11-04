# ADR-0019: Motor de plantillas de contrato con condicionales y listas

## Estado

Aceptado.

## Fecha

2026-11-03.

## Contexto

El documento de un contrato se genera con `renderTemplatePlain`: un texto plano con
`{{variable}}`, sin escapar HTML, en el que una variable sin valor queda escrita tal
cual. Al preparar la plantilla de locación de vivienda de la inmobiliaria piloto
(paso M11 de la migración, con datos sintéticos en las pruebas) se vio que eso no
alcanza:

- Un mismo modelo tiene variantes por contrato: con o sin depósito, uno a tres
  locatarios, cero a cuatro garantes, singular y plural. Con solo variables hace
  falta una plantilla por combinación o editar el documento a mano.
- Había un solo `inquilino`: con varios locatarios el armador pisaba al anterior y,
  peor, mezclaba campos opcionales (DEF-110). Los garantes eran `garante`,
  `garante2`, … y no había cantidad ni lista.
- Faltaban datos que el contrato cita: descripción, catastro, cuenta de Rentas y
  unidad de Aguas del inmueble; matrícula y domicilio de la inmobiliaria; el canon
  inicial (el vigente cambia con cada ajuste); importes y fechas en letras; la
  fecha de firma; el documento con puntos.
- El PDF y el Word no distinguían títulos ni negritas.

El motor lo usan solo las plantillas de contrato (las de correo tienen su propio
`renderTemplate`, que escapa HTML, y no cambian).

## Decisión

**Dos construcciones de bloque, sin evaluar código.**

- `{{#si condición}}…{{#sino}}…{{/si}}`. La condición es una variable (se cumple si
  tiene valor distinto de vacío, `0`, `0,00` o `false`), `no variable`, o una
  comparación de una variable con un número o un texto entre comillas (`==`, `!=`,
  `>`, `>=`, `<`, `<=`). Un valor que no es número solo admite `==` y `!=`.
- `{{#cada lista [como alias]}}…{{/cada}}`. Repite el bloque por cada elemento; sin
  alias el elemento es `item`. Cada elemento trae los campos de la persona y `n`,
  `total`, `primero` y `ultimo`. Las variables del contrato valen dentro del bloque.
- `\{{…}}` deja la etiqueta como texto. Una etiqueta de bloque sola en su renglón
  no deja un renglón vacío.

No hay expresiones, filtros, funciones ni acceso a nada que no sea el mapa de
variables y las listas que arma el servidor: la plantilla no puede ejecutar código ni
leer datos que el armador no expuso. El anidamiento se limita a seis niveles y el
documento a 2.000.000 de caracteres, para que una plantilla con listas anidadas no
pueda agotar la memoria.

**Compatibilidad.** Una plantilla que solo usa variables sale idéntica (una prueba
compara la salida contra el motor anterior con las plantillas por defecto y casos de
borde). Cambian dos cosas, ambas antes inofensivas: una etiqueta `{{#…}}` o `{{/…}}`
que no es del motor ahora es un error en lugar de quedar escrita, y una barra
invertida pegada a `{{` ahora escapa. Un texto entre llaves que no es un nombre de
variable (`{{ esto no }}`) sigue quedando igual.

**Errores claros.** Una plantilla mal formada lanza `TemplateSyntaxError` con un
código (`UNCLOSED_BLOCK`, `UNEXPECTED_CLOSE`, `MISPLACED_ELSE`, `DUPLICATE_ELSE`,
`BAD_CONDITION`, `BAD_LOOP`, `UNKNOWN_BLOCK`, `UNKNOWN_LIST`, `TOO_DEEP`,
`TOO_LARGE`), la línea y la columna. La API la rechaza al crear o editar la
plantilla y al generar el documento con 400 `TEMPLATE_SYNTAX_ERROR` y
`details: { code, line, column }` (ADR-0005); la pantalla de plantillas valida con el
mismo código mientras se escribe. Una lista que el catálogo no tiene también es un
error al guardar, no al generar. Una variable sin valor sigue quedando como etiqueta
(y en una condición es falso): sirve de aviso de dato faltante.

**Datos.** El catálogo (`packages/shared/src/contract-template-catalog.ts`) es la
lista de variables, listas y bloques; una prueba exige que todo lo que arma el
servicio esté en el catálogo y otra, en la web, que cada entrada tenga su
descripción en español e inglés. Las listas son `inquilinos`, `locadores` (solo los
vigentes, DEF-111), `garantes` y `apoderados`; `inquilino.*` es siempre el primer
locatario y `garante`, `garante2`, … se conservan. El servicio suma lo que el contrato
no trae: cuentas de Rentas (impuesto inmobiliario) y de Aguas de los servicios de la
propiedad, el canon inicial del período original (o, sin período, el que fijan las
reglas o el contrato), la fecha de firma (la del período original, o `signingDate` al
generar, que gana) y matrícula y domicilio de la inmobiliaria (dos columnas nulas
nuevas en `tenants`). Los importes y las fechas en letras reutilizan `amountInWords`
y suman `dateInWords`; las fechas del contrato se leen en UTC (son fechas sin hora).

**Documento.** El PDF y el Word siguen siendo texto resuelto, un renglón por párrafo,
ahora justificado; `# ` abre un título centrado y `**x**` es negrita
(`parseDocumentText`, compartido). No se agregan más formatos.

## Alternativas descartadas

- **Un motor de terceros (Handlebars, Mustache).** Trae helpers y, según la
  configuración, acceso a propiedades de objetos; para dos construcciones no justifica
  la superficie ni la dependencia, y los mensajes de error serían los suyos.
- **Una plantilla por combinación.** Es lo que obligaba el motor anterior: no escala
  con varias variantes y duplica el texto legal.
- **Plantilla en HTML o .docx con campos.** Cambia el formato de edición y obliga a un
  editor que hoy no hay; queda como mejora si la inmobiliaria necesita el formato
  exacto de su modelo (tipografía, numeración, tablas).

## Consecuencias

- Una plantilla única cubre las variantes del modelo de vivienda de la inmobiliaria
  piloto (depósito, cantidad de locatarios y garantes, singular y plural).
- No se cambia `ContractType`: las plantillas de local, oficina y cochera esperan a
  que haya un modelo vigente.
- El formato sigue siendo mínimo: sin tablas, numeración automática ni tamaños.
- Quien edita plantillas debe conocer la sintaxis; la pantalla muestra el catálogo y
  ejemplos, y el error con la línea ayuda a corregir.
- La ficha del garante tiene lo que hay en la persona (nombre, documento, CUIT,
  domicilio, estado civil, nacionalidad); el empleador o el inmueble en garantía no
  son datos del modelo y quedan para cuando se carguen.
