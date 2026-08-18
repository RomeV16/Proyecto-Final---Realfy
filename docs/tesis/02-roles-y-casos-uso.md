# Roles y Casos de Uso

## Roles

El sistema define siete roles internos en el enum `UserRole`, compartido entre el backend y el frontend. Un usuario tiene exactamente un rol, y al crearse sin especificarlo queda en Lectura, que es el más restringido.

El control de acceso se aplica endpoint por endpoint sobre las operaciones que modifican datos. La mayoría de las lecturas están disponibles para cualquier usuario autenticado de la inmobiliaria: lo que se restringe por rol es crear, editar, borrar, transicionar estados y configurar.

### Admin

Es el rol con mayor nivel de permisos dentro de un tenant. Suele corresponder al dueño o socio de la inmobiliaria, o a un encargado administrativo con responsabilidad sobre la configuración del sistema. Es el único que llega a la configuración de la conexión con ARCA y a la administración de roles.

Permisos principales:

- Cambio de rol y desactivación de usuarios dentro de la inmobiliaria.
- Configuración de la conexión con ARCA: certificado, emisores y puntos de venta.
- Carga, edición y borrado de valores de índices, y disparo de su obtención automática.
- Configuración de los parámetros de punitorios de la inmobiliaria, y condonación de multas.
- Disparo manual de las corridas de notificaciones y de punitorios.
- Acceso a todos los contratos, liquidaciones, rendiciones y reportes.
- Visualización del log de auditoría.

### Gerente

Responsable operativo. Trabaja sobre todo el circuito con el mismo alcance que el Admin, salvo la configuración de índices, punitorios y certificados fiscales. Puede invitar usuarios, pero no cambiarles el rol ni desactivarlos.

Permisos principales:

- Alta, edición y baja de propiedades, personas, contratos y proveedores.
- Plantillas de contrato y de email.
- Aplicación de ajustes y rescisión de contratos.
- Aprobación y envío de liquidaciones en lote.
- Rendiciones, comprobantes, tickets, leads y embudos.
- Reportes, envíos programados, importación y auditoría.

### Ventas

Usuario comercial. Trabaja sobre la cartera de propiedades, las personas y el embudo de leads. No configura parámetros globales ni aplica ajustes.

Permisos principales:

- Alta y edición de propiedades, con sus operaciones, imágenes y tasaciones.
- Alta y edición de personas, con sus roles y documentos.
- Alta y edición de contratos, y generación del documento a partir de una plantilla.
- Cálculo del ajuste de un contrato, sin aplicarlo.
- Gestión del embudo comercial y de leads, con visitas e interacciones.
- Exportación de propiedades y personas.
- Acceso de lectura a comprobantes y reportes operativos.

### Liquidaciones

Usuario de administración y cobranzas. Es el rol que recorre el circuito del dinero de punta a punta.

Permisos principales:

- Generación de las liquidaciones del período, edición de sus líneas y transición de sus estados.
- Registro de pagos e imputación de saldos.
- Generación, edición y envío de rendiciones al propietario.
- Emisión de comprobantes ARCA y notas de crédito, y administración de emisores.
- Acceso a los reportes financieros y a los indicadores de flujo de caja y morosidad.

### Soporte

Mesa de reclamos. Atiende el circuito de mantenimiento.

Permisos principales:

- Apertura, edición y cierre de tickets, con comentarios y adjuntos.
- Transición de estados del ticket y asignación de proveedores.
- Carga del costo del trabajo realizado.
- Acceso de lectura a propiedades, personas, contratos y comprobantes.

### Marketing

Rol acotado a la comunicación con los leads.

Permisos principales:

- Alta, edición, borrado y previsualización de plantillas de email.
- Envío de un correo a un lead a partir de una plantilla.
- Acceso de lectura general.

### Lectura

Rol de consulta. Ve los listados y los detalles sin ninguna acción disponible. Sobre pagos y comprobantes tiene lectura explícita.

### Inquilino

Usuario externo a la inmobiliaria, autenticado contra el portal de autogestión. No comparte espacio de credenciales con los usuarios internos y no tiene rol: lo que puede ver está delimitado por la persona a la que pertenece su token.

Permisos principales:

- Consulta del estado de su contrato y de su saldo pendiente.
- Consulta de sus liquidaciones y descarga del comprobante en PDF de cada una.
- Apertura y seguimiento de reclamos de mantenimiento sobre la propiedad alquilada, con adjuntos y comentarios.

El inquilino no edita sus propios datos desde el portal: los cambios de contacto los hace la inmobiliaria sobre la ficha de la persona.

## Casos de uso prioritarios

A continuación se listan los casos de uso considerados centrales para la operación del MVP. Cada uno indica actor primario y una descripción breve. Donde se nombra un rol, es el rol real que habilita la operación.

### Gestión de propiedades y personas

- **CU-01 Alta de propiedad** — Ventas. Registra una propiedad con dirección, características, fotos y propietario asociado.
- **CU-02 Cambio de estado de una operación** — Ventas. Transiciona el estado de la operación de venta o alquiler de la propiedad: borrador, disponible, reservada, alquilada, vendida, ocupada, suspendida o archivada. El estado vive en la operación, no en la propiedad, de modo que un mismo inmueble puede estar publicado en venta y alquilado a la vez.
- **CU-03 Alta de persona** — Ventas. Carga una persona física o jurídica y asigna uno o más roles: propietario, inquilino, garante, comprador, proveedor o lead.
- **CU-04 Vinculación de garantías** — Ventas. Asocia al contrato una garantía propietaria, bancaria, un seguro de caución o un depósito.

### Contratos

- **CU-05 Alta de contrato** — Ventas. Genera un contrato a partir de una propiedad, un inquilino, sus garantías y su esquema de ajuste, y produce el documento a partir de una plantilla.
- **CU-06 Renovación de contrato** — Ventas. Da de alta un contrato nuevo tomando como base uno vencido y manteniendo las partes. No es una operación automática: el contrato anterior queda en estado Renovado y el nuevo se carga como cualquier otro.
- **CU-07 Configurar ajuste** — Ventas o Gerente. Define la modalidad de ajuste —IPC, ICL, CCP, porcentaje fijo o personalizado— y su periodicidad, de mensual a anual.
- **CU-08 Calcular y aplicar ajuste** — Ventas calcula, Admin o Gerente aplica. El cálculo toma el índice publicado para el período; la aplicación escribe el nuevo monto en el contrato.

### Liquidaciones y pagos

- **CU-09 Generar las liquidaciones del mes** — Liquidaciones. Recibe el período y produce las liquidaciones de todos los contratos activos, informando cuántas creó y cuántas omitió por ya existir. Cada liquidación se compone de líneas de tipo alquiler, ajuste, extra, descuento y multa.
- **CU-10 Registrar pago** — Liquidaciones. Asocia un pago total o parcial a una liquidación e imputa el saldo. Si el pago completa el total, la liquidación pasa sola a Pagada.
- **CU-11 Calcular punitorio** — Sistema. Aplica el recargo correspondiente al pasar la fecha de vencimiento sin pago, según los parámetros de la inmobiliaria.
- **CU-12 Condonar punitorio** — Admin. Anula la multa acumulada de un caso, con motivo registrado.
- **CU-13 Generar rendición al propietario** — Liquidaciones. Consolida lo cobrado en el período, descuenta la comisión pactada en el contrato y los conceptos deducidos, y emite el documento del propietario.

### Facturación electrónica

- **CU-14 Emitir comprobante ARCA** — Liquidaciones. Envía la solicitud a ARCA, recibe el CAE y persiste el comprobante.
- **CU-15 Anular comprobante** — Liquidaciones. Emite la nota de crédito que referencia al comprobante original.

### Tickets y mantenimiento

- **CU-16 Abrir reclamo** — Inquilino o Soporte. Registra un reclamo con categoría, descripción y adjuntos.
- **CU-17 Asignar proveedor** — Soporte. Vincula al ticket un proveedor de los habilitados por rubro y zona, y lo lleva al estado correspondiente.
- **CU-18 Cerrar ticket** — Soporte. Recorre la máquina de estados hasta Resuelto o Cerrado, con el costo del trabajo cargado.

### CRM

- **CU-19 Captar lead** — Ventas. Carga un interesado, lo ubica en una etapa del embudo y registra su origen. Una consulta enviada desde el micrositio público entra por esta vía sin intervención.
- **CU-20 Agendar visita** — Ventas. Programa una visita a una propiedad para un lead.
- **CU-21 Convertir lead** — Ventas. Promueve el lead a `Person`, desde donde se puede dar de alta el contrato como una operación aparte.

### Portal del inquilino

- **CU-22 Login del inquilino** — Inquilino. Accede al portal con credenciales propias.
- **CU-23 Consultar saldo y liquidaciones** — Inquilino. Visualiza liquidaciones del contrato y descarga comprobantes.
- **CU-24 Abrir reclamo desde el portal** — Inquilino. Genera un ticket que llega al backlog de la inmobiliaria.

<!-- Revisado por Manuel: refinamiento de casos para liquidaciones y ARCA -->
