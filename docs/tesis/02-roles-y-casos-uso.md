# Roles y Casos de Uso

## Roles

### Administrador de inmobiliaria

Es el rol con mayor nivel de permisos dentro de un tenant. Suele corresponder al dueño o socio de la inmobiliaria, o a un encargado administrativo con responsabilidad sobre la configuración del sistema.

Permisos principales:

- Alta, baja y modificación de usuarios agentes dentro de la inmobiliaria.
- Configuración de plantillas de contrato y de email.
- Carga y mantenimiento de índices (IPC, UVA) y parámetros de ajuste.
- Configuración de la conexión con ARCA (CUIT, certificados, punto de venta).
- Acceso a todos los contratos, liquidaciones, rendiciones y reportes.
- Acceso al dashboard de KPIs financieros completos.
- Visualización del log de auditoría.

### Agente

Usuario operativo. Trabaja sobre la cartera de propiedades, contratos y reclamos asignados a su inmobiliaria. No configura parámetros globales.

Permisos principales:

- Alta y edición de propiedades, propietarios e inquilinos.
- Gestión del pipeline comercial y de leads.
- Carga de visitas e interacciones.
- Generación de liquidaciones y registro de pagos.
- Apertura, asignación y cierre de tickets de mantenimiento.
- Emisión de comprobantes ARCA sobre liquidaciones existentes.
- Acceso de lectura a reportes operativos.

### Inquilino

Usuario externo a la inmobiliaria, autenticado contra el portal de autogestión. No comparte espacio de credenciales con los usuarios internos.

Permisos principales:

- Consulta del estado de su contrato y saldo.
- Descarga de comprobantes históricos y rendiciones que le competen.
- Apertura y seguimiento de tickets de mantenimiento sobre la propiedad alquilada.
- Actualización de datos de contacto.
- Recepción de notificaciones de vencimiento y nuevas liquidaciones.

## Casos de uso prioritarios

A continuación se listan los casos de uso considerados centrales para la operación del MVP. Cada uno indica actor primario y una descripción breve.

### Gestión de propiedades y personas

- **CU-01 Alta de propiedad** — Agente. Registra una propiedad con dirección, características, fotos y propietario asociado.
- **CU-02 Cambio de estado de propiedad** — Agente. Marca la propiedad como disponible, reservada, alquilada o fuera de servicio.
- **CU-03 Alta de persona** — Agente. Carga una persona física o jurídica y asigna uno o más roles (propietario, inquilino, garante, proveedor).
- **CU-04 Vinculación de garantías** — Agente. Asocia garantías propietarias, salariales o seguros de caución a un contrato.

### Contratos

- **CU-05 Alta de contrato** — Agente. Genera un contrato a partir de una propiedad disponible, un inquilino, sus garantías y una plantilla.
- **CU-06 Renovación de contrato** — Agente. Crea un nuevo contrato basado en uno vencido manteniendo las partes.
- **CU-07 Configurar ajuste** — Administrador o agente. Define la modalidad de ajuste (IPC, UVA, manual) y su periodicidad.
- **CU-08 Aplicar ajuste programado** — Sistema. Calcula el nuevo monto en la fecha pactada usando el índice vigente.

### Liquidaciones y pagos

- **CU-09 Generar liquidación mensual** — Agente. Produce la liquidación con sus líneas (alquiler, expensas, servicios, impuestos, honorarios).
- **CU-10 Registrar pago** — Agente. Asocia un pago total o parcial a una liquidación e imputa el saldo.
- **CU-11 Calcular punitorio** — Sistema. Aplica el recargo correspondiente al pasar la fecha de vencimiento sin pago.
- **CU-12 Marcar contrato en mora** — Sistema o agente. Cambia el estado del contrato al superar el umbral configurado.
- **CU-13 Generar rendición al propietario** — Agente. Consolida cobros y descuentos del mes y emite el documento del propietario.

### Facturación electrónica

- **CU-14 Emitir comprobante ARCA** — Agente. Envía la solicitud a ARCA, recibe el CAE y adjunta el comprobante a la liquidación.
- **CU-15 Anular comprobante** — Agente o administrador. Emite la nota de crédito correspondiente.

### Tickets y mantenimiento

- **CU-16 Abrir ticket** — Inquilino o agente. Registra un reclamo con categoría, descripción y adjuntos.
- **CU-17 Asignar proveedor** — Agente. Vincula un proveedor al ticket y notifica.
- **CU-18 Cerrar ticket** — Agente. Marca el reclamo como resuelto con comentario de cierre.

### CRM

- **CU-19 Captar lead** — Agente. Carga un interesado, lo ubica en una etapa del pipeline y registra origen.
- **CU-20 Agendar visita** — Agente. Programa una visita a una propiedad para un lead.
- **CU-21 Convertir lead en contrato** — Agente. Promueve el lead al alta de un contrato.

### Portal del inquilino

- **CU-22 Login del inquilino** — Inquilino. Accede al portal con credenciales propias.
- **CU-23 Consultar saldo y liquidaciones** — Inquilino. Visualiza liquidaciones del contrato y descarga comprobantes.
- **CU-24 Abrir reclamo desde el portal** — Inquilino. Genera un ticket que llega al backlog de la inmobiliaria.

<!-- Revisado por Manuel: refinamiento de casos para liquidaciones y ARCA -->
