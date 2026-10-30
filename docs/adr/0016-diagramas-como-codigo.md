# ADR-0016: Los diagramas se escriben como código dentro del documento

## Estado

Aceptado.

## Fecha

2026-10-30.

## Contexto

Los diagramas de la documentación —arquitectura, flujos de estados, secuencias—
se dibujaban con caracteres ASCII dentro de los archivos `.md`. Ese formato tiene
tres problemas, que se vieron en `docs/tesis/03-arquitectura.md`:

- No se puede editar con seguridad: mover una caja obliga a realinear a mano
  todas las líneas que la rodean, y en la revisión de un PR el diff es ilegible.
- Se desactualiza sin que nadie lo note. Cuando cambia un módulo, el texto se
  corrige y el dibujo queda como estaba, porque corregirlo cuesta mucho más.
- No hay forma de verificar que el dibujo sea válido ni de reutilizar un trozo en
  otro documento.

La alternativa de guardar imágenes exportadas desde una herramienta externa
resuelve la prolijidad pero agrava la divergencia: la fuente del diagrama vive
fuera del repositorio y la imagen es un binario que no se puede revisar.

## Decisión

Los diagramas son bloques de código `mermaid` dentro del mismo `.md` que los
usa. No se versionan imágenes exportadas ni dibujos ASCII.

- El bloque va junto al texto que explica, de modo que un cambio en uno se ve
  en el diff del otro.
- GitHub renderiza Mermaid en los archivos `.md` del repositorio, sin
  herramientas adicionales.
- Un diagrama nuevo o modificado se incluye en el mismo PR que el cambio que lo
  motiva, igual que el resto de la documentación.
- Los diagramas ASCII existentes se reemplazan cuando el documento que los
  contiene se toca por otra razón; no hay una migración masiva.

## Consecuencias

Positivas:

- El diagrama es texto: se revisa línea por línea y se corrige con un cambio
  chico.
- La fuente y el documento no se separan, así que es más difícil que uno quede
  atrasado respecto del otro.
- No hay binarios ni herramientas de dibujo que instalar.

Negativas:

- Mermaid controla la disposición: no se puede ajustar la posición de cada caja
  como en un dibujo manual, y los diagramas muy densos salen menos legibles.
- Un visor que no renderice Mermaid muestra el código en lugar del dibujo, por
  ejemplo al exportar la tesis a un formato que no lo soporte; en ese caso hay
  que generar la imagen a partir del bloque en el momento de exportar.
- Un error de sintaxis en el bloque rompe el dibujo y solo se nota al renderizar
  el documento.
