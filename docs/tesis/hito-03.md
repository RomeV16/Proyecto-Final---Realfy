# Hito 3: Beta integrada

## Fecha

2026-08-17.

## Resumen del hito

El Hito 3 cierra la construcción funcional del sistema. Sobre el núcleo operativo aprobado en el Hito 2 se integraron los módulos complementarios que hacen a la operación real de una inmobiliaria argentina: la emisión de comprobantes electrónicos ante ARCA, la rendición al propietario, el puntaje interno de inquilinos, las tasaciones, la importación y exportación de datos, y los reportes de gestión con sus indicadores en el panel.

La diferencia con el hito anterior no es la cantidad de pantallas sino el grado de integración: los módulos dejaron de ser islas. La rendición al propietario se alimenta de los pagos registrados y de la comisión pactada en el contrato; el comprobante electrónico se emite a partir de un pago; los reportes agregan sobre contratos, pagos, liquidaciones, rendiciones y comprobantes; el puntaje del inquilino convive con su ficha y su historial. Lo que queda del proyecto ya no es construir funcionalidad nueva, sino probarla, endurecerla y documentarla.

## Alcance entregado

- **Facturación electrónica ante ARCA**: certificados por inmobiliaria con la clave privada cifrada, emisores propios y delegados, numeración por punto de venta, facturas A, B y C, notas de crédito, consulta de padrón y libro IVA ventas exportable.
- **Rendición al propietario**: liquidación de lo que el propietario efectivamente recibe, con la comisión configurable por contrato, los conceptos deducidos discriminados, el comprobante en PDF y su envío por correo.
- **Puntaje interno de inquilinos**: cinco componentes ponderables por inmobiliaria, con el total calculado siempre en el servidor.
- **Tasaciones de propiedades**: historial por propiedad con su método, y comparables de la propia cartera por ciudad, tipo y ambientes.
- **Importación y exportación**: carga de propiedades y personas desde planilla con validación previa fila por fila, y exportación de los listados a Excel y CSV.
- **Reportes de gestión**: estado de cuenta del propietario, rentabilidad por propiedad, flujo de caja, resumen de comisiones, analítica del embudo comercial y morosidad, descargables en Excel y PDF, con envío programado por correo.
- **Indicadores en el panel**: tendencia de ocupación de los últimos doce meses y rentabilidad por propiedad, sobre un caché de métricas por inmobiliaria.

## Estado del sistema

El backend expone treinta módulos sobre un modelo de cincuenta y cuatro entidades y quince migraciones aplicadas. La interfaz cubre diecinueve secciones internas más el portal del inquilino y el portal público. La integración continua compila los cuatro paquetes en cada cambio y la suite de pruebas de la API está en cuatrocientas setenta y seis pruebas. El ambiente de demostración se redespliega con cada avance y se verifica en vivo.

## Lecciones aprendidas

- Integrar es donde aparecen los errores que el desarrollo aislado no muestra. La transición de estado de la rendición nunca había funcionado desde la interfaz porque la pantalla enviaba un nombre de campo distinto al que esperaba el servidor; las pruebas del servicio pasaban porque no atravesaban la pantalla.
- Un despliegue puede romperse por algo que ninguna prueba mira. Una migración quedó con una línea que no era SQL, arrastrada al generarla, y como la integración continua compila pero nunca ejecuta migraciones, el error apareció recién contra la base real. Y al quedar registrada como fallida, bloqueó también las migraciones siguientes.
- Conviene desconfiar de lo que parece un valor sensato por defecto. El formulario de emisión, ante cualquier error al pedir el próximo número, mostraba el número uno: un usuario podía confirmar una emisión contra un número que el organismo nunca asignó.
- Las credenciales de terceros no deberían condicionar el arranque del sistema. La clave maestra que protege los certificados se valida recién cuando se la necesita, así una inmobiliaria que no factura electrónicamente no depende de una configuración que no le corresponde.
- Documentar en paralelo evita contradicciones: el modelo de datos documentado describía entidades de facturación que el modelo entregado no tenía, y esa clase de desfase es exactamente lo que se detecta en una defensa.

## Próximos pasos hacia el Hito 4

- Construir el panel de priorización diaria y el resumen de gestión al cierre de contrato.
- Armar la infraestructura de pruebas completa: pruebas de extremo a extremo, cobertura mínima exigida en integración continua y un trabajo que ejecute las migraciones desde cero contra una base limpia.
- Endurecer el aislamiento entre inmobiliarias para que falle cerrado cuando no haya contexto de sesión.
- Escribir los manuales por rol, la guía de despliegue y la referencia de API.
- Preparar el informe final y la demostración de defensa.
