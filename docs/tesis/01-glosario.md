# Glosario

Términos del dominio inmobiliario y técnicos utilizados a lo largo de la documentación.

## Términos del dominio

- **Inmobiliaria**: Entidad comercial que intermedia entre propietarios e inquilinos. En el sistema corresponde al nivel de `Tenant` en el modelo multi-inquilino.
- **Admin**: Usuario con permisos plenos dentro de un `Tenant`. Es el único rol que configura la facturación electrónica, los índices, los parámetros de punitorios y los roles de los demás usuarios.
- **Gerente**: Responsable operativo. Mismo alcance que el Admin sobre el trabajo diario, sin la configuración de índices, punitorios ni certificados fiscales.
- **Ventas**: Usuario comercial. Trabaja sobre la cartera de propiedades, las personas, los contratos y el embudo de leads.
- **Liquidaciones**: Usuario de administración y cobranzas. Genera liquidaciones, registra pagos, rinde al propietario y emite comprobantes.
- **Soporte**: Usuario de la mesa de reclamos. Atiende el circuito de tickets y proveedores.
- **Marketing**: Usuario acotado a las plantillas de correo y al envío de correos a leads.
- **Lectura**: Usuario de consulta, sin operaciones de escritura. Es el rol que recibe un usuario creado sin especificar rol.
- **Propietario**: Persona física o jurídica titular del inmueble, que cede la administración a la inmobiliaria. Recibe la rendición mensual.
- **Inquilino**: Persona física o jurídica que firma el contrato de locación y abona el alquiler.
- **Garante**: Persona o garantía propietaria que respalda el contrato. Puede ser garante propietario, garante salarial o seguro de caución.
- **Contrato de locación**: Acuerdo entre propietario e inquilino, intermediado por la inmobiliaria, con duración, monto inicial, periodicidad de ajuste y garantías asociadas.
- **Liquidación**: Cálculo mensual del importe que debe pagar el inquilino, compuesto por alquiler, expensas, servicios, impuestos, punitorios y otros conceptos.
- **Rendición**: Documento mensual que recibe el propietario detallando lo cobrado, las comisiones de la inmobiliaria, los gastos descontados y el saldo a girar.
- **Ajuste IPC**: Actualización del monto del alquiler tomando como referencia el Índice de Precios al Consumidor publicado por el INDEC.
- **Ajuste ICL**: Actualización tomando como referencia el Índice para Contratos de Locación publicado por el BCRA, que es el índice previsto por la normativa de alquileres.
- **Ajuste CCP**: Actualización tomando como referencia el Coeficiente Casa Propia.
- **Ajuste por porcentaje fijo**: Modalidad donde el contrato pacta de antemano el porcentaje de aumento de cada período, sin atarse a un índice publicado.
- **Ajuste personalizado**: Modalidad donde las partes acuerdan el nuevo valor en cada período y se carga a mano.
- **UVA**: Unidad de Valor Adquisitivo publicada por el BCRA. El sistema la registra como tipo de índice —igual que el CVS y el CER—, pero no es una modalidad de ajuste que un contrato pueda pactar: las modalidades disponibles son las cinco anteriores.
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
- **e2e**: Pruebas de extremo a extremo. En este proyecto son de nivel HTTP: levantan la aplicación NestJS completa con Jest y le pegan contra una base PostgreSQL real, con las migraciones aplicadas desde cero. Recorren el camino entero —petición, autenticación, contexto de inmobiliaria, servicio, base de datos y respuesta— pero no son recorridos de navegador. El detalle está en `docs/pruebas.md`.
