# Hito 2: MVP operativo demostrable

## Fecha

2026-08-14.

## Resumen del hito

El Hito 2 cierra la construcción del núcleo operativo de Realfy: el circuito completo que una inmobiliaria recorre todos los meses, desde el alta de una propiedad hasta la cobranza y el reclamo de mantenimiento. A diferencia del Hito 1, cuyo entregable era documental, acá el entregable es software funcionando: una instancia desplegada, con datos representativos, que se puede recorrer de punta a punta frente al director de tesis.

El criterio de aceptación del hito fue poder demostrar, sin intervención manual sobre la base de datos, la secuencia: crear una propiedad con fotos, registrar propietario e inquilino, firmar un contrato con su garantía, aplicar un ajuste por índice, generar la liquidación del mes, registrar el pago, ver el estado de deuda y abrir un reclamo con su proveedor asignado.

## Alcance entregado

- **Autenticación, roles y permisos**: sesión con token de acceso y refresco rotativo, y control de acceso por rol sobre cada endpoint.
- **Multi-inmobiliaria, auditoría y registro**: aislamiento de datos por inmobiliaria y traza de las operaciones sensibles.
- **Interfaz base y panel**: navegación, sistema de componentes y panel con métricas reales de la cartera.
- **Propiedades**: alta, estados, operaciones de venta y alquiler, y carga de imágenes con procesamiento y almacenamiento externo.
- **Personas**: propietarios, inquilinos y garantes, con roles múltiples sobre la misma persona.
- **Contratos**: garantías, documentos asociados y generación a partir de plantillas.
- **Actualización de alquiler**: ajustes por IPC, por UVA o por valor manual, con obtención automática de los índices publicados.
- **Liquidaciones mensuales**: alquiler, servicios, impuestos y honorarios, con comprobante en PDF.
- **Registro de pagos y estados de deuda**: imputación de pagos y situación de cada contrato.
- **Morosidad y punitorios**: cálculo de intereses por atraso y derivación legal.
- **Reclamos, tickets y proveedores**: circuito de mantenimiento con responsable, proveedor, costo y acuerdo de nivel de servicio.
- **Portal del inquilino**: acceso propio para consultar facturas, estado de cuenta y contrato.
- **Notificaciones**: avisos por vencimientos, deudas y cambios de estado.
- **CRM**: leads, embudo comercial configurable e historial de interacciones.
- **Portal público por inmobiliaria**: catálogo de propiedades disponibles con formulario de consulta que genera un lead.

## Demostración

La demostración se hizo sobre el ambiente desplegado en Railway, con una inmobiliaria de ejemplo con propiedades, personas, contratos vigentes, liquidaciones, pagos y reclamos en distintos estados, y usuarios con los cuatro roles internos más dos accesos de inquilino, uno al día y uno con deuda, para mostrar el portal en ambas situaciones.

## Lecciones aprendidas

- El acoplamiento entre módulos es más fuerte de lo que sugiere el diagrama de arquitectura: liquidaciones depende de contratos, de ajustes y de servicios, y los reclamos dependen de propiedades y proveedores. Construir en el orden del backlog fue lo que evitó tener que reescribir.
- Las decisiones de dominio pesan más que las técnicas. El caso más claro fue el motor de ajustes: los índices se consumen como variación mensual y no como nivel absoluto, y confundir ambas cosas produce factores de ajuste sin sentido. Es el tipo de error que ninguna prueba unitaria detecta si la prueba asume el mismo malentendido.
- Cargar datos de demostración realistas encontró más errores que el desarrollo mismo. Varias pantallas leían claves que la API nunca devolvía, y eso solo se ve con datos de verdad, no con un registro de prueba.
- Las tareas programadas son invisibles cuando fallan. Faltaba registrar el planificador de tareas en la aplicación, así que durante un tiempo no corrían ni las notificaciones, ni el cálculo de punitorios, ni la obtención de índices, y nada lo indicaba.
- Un portal para usuarios externos no es una pantalla más: obliga a revisar el aislamiento de datos con otro criterio, porque quien entra no pertenece a la inmobiliaria.

## Próximos pasos hacia el Hito 3

- Completar los módulos complementarios que quedan fuera del núcleo operativo: facturación electrónica, puntaje de inquilinos, tasaciones, importación y exportación de datos, y reportes de gestión.
- Cerrar la rendición al propietario, que hoy se calcula por fuera del sistema.
- Sumar los indicadores de ocupación y rentabilidad al panel.
- Revisar el aislamiento entre inmobiliarias con una mirada de seguridad antes de la etapa de pruebas integrales.
