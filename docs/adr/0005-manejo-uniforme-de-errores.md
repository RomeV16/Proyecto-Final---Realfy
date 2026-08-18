# ADR-0005: Manejo uniforme de errores

## Estado

Aceptado.

## Fecha

2026-08-18.

## Contexto

Hasta esta decisión, la forma de la respuesta de error dependía de dónde se había
originado el error. NestJS tiene un filtro por defecto que responde
`{ statusCode, message }` para las excepciones HTTP, pero eso cubre solo una
parte de los casos:

- La validación de entrada devuelve `message` como arreglo de textos, uno por
  campo rechazado, mientras el resto de los errores lo devuelve como texto.
- Varios servicios lanzan sus excepciones con un objeto que incluye un código de
  dominio: `new ConflictException({ error: 'EMAIL_EXISTS', message: '…' })`. Hay
  pantallas del frontend que ramifican sobre ese código en lugar del texto, que
  es lo correcto, pero eso quedaba dependiendo de que cada servicio armara el
  objeto de la misma manera.
- Los errores de Prisma no son excepciones HTTP. Una violación de unicidad
  llegaba al cliente como un 500 con el mensaje interno del motor, que incluye el
  nombre de la restricción y la tabla.
- Cualquier error no previsto se respondía con el filtro por defecto, que en modo
  de desarrollo expone información del stack.

El problema de fondo es doble. Para el cliente, no hay una forma que pueda
consumir sin ramificar por el origen del error. Para el servidor, no hay un punto
único donde quede registrado qué falló, en qué petición, para qué inmobiliaria y
para qué usuario: eso quedaba distribuido entre los servicios que se acordaban de
registrar y los que no.

Hay además un requisito de seguridad. Un mensaje de error es un canal de fuga:
el nombre de una restricción de la base, la ruta de un archivo del servidor o una
traza de ejecución le dicen a quien está probando la API cosas que no debería
saber.

## Decisión

Se incorpora un filtro global de excepciones,
`apps/api/src/common/filters/all-exceptions.filter.ts`, registrado como
`APP_FILTER` en el módulo raíz y declarado con `@Catch()` sin argumentos, de modo
que atrapa absolutamente todo lo que salga de un manejador.

Toda respuesta de error tiene esta forma:

```
{
  statusCode,          // siempre
  message,             // texto, o arreglo de textos si es de validación
  error, errorCode,    // el código, cuando hay uno
  correlationId,       // cuando la petición trae o genera un identificador de traza
  timestamp            // siempre
}
```

`error` y `errorCode` llevan el mismo valor. El primero es el nombre que ya
consumían los clientes; el segundo, el de la forma documentada. Se responden los
dos para no romper lo que había mientras la forma nueva queda establecida.

El filtro resuelve el estado y el código así:

| Origen | Estado | Código |
|---|---|---|
| `BadRequestException` | 400 | `VALIDATION_ERROR` |
| `UnauthorizedException` | 401 | `UNAUTHORIZED` |
| `ForbiddenException` | 403 | `FORBIDDEN` |
| `NotFoundException` | 404 | `NOT_FOUND` |
| Otra `HttpException` | el suyo | ninguno genérico |
| Prisma `P2002` | 409 | `CONFLICT` |
| Prisma `P2025` | 404 | `NOT_FOUND` |
| Cualquier otra cosa | 500 | `INTERNAL_ERROR` |

Dos comportamientos merecen explicación aparte.

El primero es que **el código de dominio le gana al genérico**. Si la excepción
se construyó con un objeto que trae `error` y ese valor tiene la forma de un
código —mayúsculas, dígitos y guión bajo—, el filtro lo respeta. La forma se
verifica con una expresión regular por una razón concreta: cuando una excepción
se construye con un string, Nest rellena `error` con el motivo HTTP —`Not Found`,
`Bad Request`—, que no es un código y no debe pisar al genérico.

El segundo es que **el contexto que agregó el servicio se conserva**. Las
máquinas de estado de liquidaciones, rendiciones y tickets adjuntan
`validTransitions` al error, así el cliente puede decir cuáles eran las
transiciones posibles en lugar de un "no se pudo". El filtro copia al cuerpo de
la respuesta todas las claves del objeto original que no pertenezcan al
envoltorio. Esto se hace solo para excepciones HTTP, que son las que el código
lanza a propósito: un error inesperado sigue saliendo sin nada adentro.

Sobre los errores no previstos la decisión es explícita: se responde siempre el
mismo texto genérico, sin código de origen, sin detalle y sin traza. Lo que sí
queda, en el registro del servidor, es una línea con el método, la ruta, el
estado resultante, el `correlationId`, la inmobiliaria y el usuario, más el stack
completo de la excepción.

## Alternativas consideradas

- **Dejar el filtro por defecto de NestJS y normalizar en cada servicio.** Es lo
  que había de hecho, y no funcionó: los errores de Prisma y los no previstos no
  pasan por ningún servicio, así que ninguna disciplina de escritura los cubre.
  Además obliga a repetir la misma construcción en decenas de lugares, con la
  garantía de que alguno va a quedar distinto.
- **Un interceptor en lugar de un filtro.** Un interceptor puede transformar la
  respuesta, pero no atrapa lo que ocurre antes de llegar al manejador —la
  validación de entrada, por ejemplo— ni lo que lanzan los guards. El filtro sí.
- **Envolver también las respuestas exitosas** en un `{ data, meta }` uniforme.
  Se descartó: obligaría a cambiar todos los consumidores del frontend a la vez,
  y el problema que había que resolver era el de los errores. La forma del error
  es la que el cliente no podía predecir.
- **Normalizar los errores en el cliente HTTP del frontend.** Resuelve el
  síntoma para una sola aplicación y deja la fuga de información intacta, que es
  la mitad del problema.

## Consecuencias

Positivas:

- El cliente ramifica sobre `errorCode` y no sobre el texto del mensaje, que
  cambia con el idioma y con cualquier reescritura.
- Ninguna respuesta de error puede llevar un stack ni el mensaje interno del
  motor de base de datos, porque no hay camino que evite el filtro.
- Cada error tiene una línea de registro con la inmobiliaria y el usuario, lo que
  convierte al `correlationId` que ve el cliente en algo accionable: alcanza para
  encontrar la traza.
- Una violación de unicidad llega como 409 y no como 500, que es lo que
  corresponde semánticamente y lo que permite al frontend distinguir "ya existe"
  de "algo se rompió".

Negativas:

- Un error de programación que no derive de `HttpException` se responde como 500
  con un texto genérico, y desde el cliente es indistinguible de una caída real.
  Eso es deliberado, pero implica que el diagnóstico depende enteramente del
  registro del servidor.
- El filtro es un punto único de falla en el camino de los errores: un bug ahí
  afecta a toda la API. Se mitiga con pruebas unitarias dedicadas
  (`apps/api/src/common/filters/all-exceptions.filter.spec.ts`), que cubren cada
  rama de la resolución.
- La convención de códigos de dominio no está centralizada en un enum: cada
  servicio escribe el suyo como string. El filtro valida la forma, no el
  vocabulario, así que un código mal escrito pasa igual.
