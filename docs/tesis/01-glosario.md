# Glosario

Términos del dominio inmobiliario y técnicos utilizados a lo largo de la documentación.

## Términos del dominio

- **Inmobiliaria**: Entidad comercial que intermedia entre propietarios e inquilinos. En el sistema corresponde al nivel de `Tenant` en el modelo multi-inquilino.
- **Agente**: Usuario operativo de una inmobiliaria. Gestiona propiedades, contratos, liquidaciones y reclamos. Tiene permisos acotados frente al administrador.
- **Administrador de inmobiliaria**: Usuario con permisos plenos dentro de un `Tenant`. Configura plantillas, índices, usuarios y parámetros de facturación.
- **Propietario**: Persona física o jurídica titular del inmueble, que cede la administración a la inmobiliaria. Recibe la rendición mensual.
- **Inquilino**: Persona física o jurídica que firma el contrato de locación y abona el alquiler.
- **Garante**: Persona o garantía propietaria que respalda el contrato. Puede ser garante propietario, garante salarial o seguro de caución.
- **Contrato de locación**: Acuerdo entre propietario e inquilino, intermediado por la inmobiliaria, con duración, monto inicial, periodicidad de ajuste y garantías asociadas.
- **Liquidación**: Cálculo mensual del importe que debe pagar el inquilino, compuesto por alquiler, expensas, servicios, impuestos, punitorios y otros conceptos.
- **Rendición**: Documento mensual que recibe el propietario detallando lo cobrado, las comisiones de la inmobiliaria, los gastos descontados y el saldo a girar.
- **Ajuste IPC**: Actualización del monto del alquiler tomando como referencia el Índice de Precios al Consumidor publicado por el INDEC.
- **Ajuste UVA**: Actualización del monto del alquiler tomando como referencia la Unidad de Valor Adquisitivo publicada por el BCRA.
- **Ajuste manual**: Modalidad de actualización donde las partes pactan los nuevos valores en cada período, sin atarse a un índice publicado.
- **Comprobante ARCA**: Documento fiscal electrónico (factura A, B o C, recibo, nota de crédito) emitido contra los servicios web de ARCA (ex AFIP).
- **CAE**: Código de Autorización Electrónico devuelto por ARCA al aprobar un comprobante. Sin CAE, el comprobante no tiene validez fiscal.
- **Morosidad**: Estado del contrato cuando el inquilino registra una o más liquidaciones impagas vencidas.
- **Punitorio**: Recargo por mora aplicado sobre el saldo impago, calculado según la cláusula del contrato.
- **Derivación legal**: Marca interna que indica que un contrato moroso fue derivado al estudio jurídico de la inmobiliaria.
- **Pipeline comercial**: Secuencia de etapas por las que pasa un lead, desde la captación hasta la firma del contrato o el descarte.
- **Lead**: Interesado en alquilar o publicar un inmueble. Puede convertirse luego en inquilino o propietario.
- **Visita**: Evento de inspección de un inmueble por parte de un lead, agendado por un agente.
- **Tasación**: Estimación del valor de mercado de una propiedad, registrada con fecha y método de cálculo.
- **Scoring de inquilino**: Calificación interna del inquilino basada en historial de pagos, antigüedad y otros factores configurables.

## Términos técnicos

- **Multi-tenant**: Patrón arquitectónico en el que una única instancia de software atiende a múltiples organizaciones (inmobiliarias), separando datos por `tenantId`.
- **Row-level multi-tenancy**: Variante donde la separación se garantiza por una columna `tenantId` en cada tabla, con filtrado obligatorio en cada consulta.
- **Monorepo**: Repositorio único que contiene varias aplicaciones y librerías. En este proyecto se gestiona con Turborepo y workspaces de pnpm.
- **JWT**: JSON Web Token. Mecanismo utilizado para autenticar a usuarios y portales.
- **Refresh token**: Token de larga duración que permite renovar el JWT de acceso sin volver a pedir credenciales.
- **ADR**: Architecture Decision Record. Documento corto que registra una decisión arquitectónica, su contexto y consecuencias.
- **i18n**: Internacionalización. En este proyecto se implementa con `next-intl`, español por defecto e inglés como stub.
- **e2e**: Pruebas end-to-end. Se ejecutan con Playwright contra la aplicación corriendo.
