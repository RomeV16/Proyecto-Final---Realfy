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

