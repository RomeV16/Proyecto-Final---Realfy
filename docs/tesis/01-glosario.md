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
- **Locador**: Persona que tiene la potestad de alquilar el inmueble y firma el contrato en ese carácter. Puede ser el titular, un usufructuario, un sublocador o un acreedor. Un contrato puede tener varios locadores, cada uno con su porcentaje de cobro, que no tiene por qué coincidir con su porcentaje de titularidad.
- **Titular**: Persona que figura como dueña del inmueble. La titularidad es independiente de quién es locador de un contrato: una persona puede ser titular sin ser locador, y al revés.
- **Apoderado**: Persona con poder para actuar en nombre de otra, con firma conjunta (deben firmar todos) o indistinta (alcanza con uno). Los cotitulares pueden apoderarse entre sí para cobrar.
- **Inquilino**: Persona física o jurídica que firma el contrato de locación y abona el alquiler.
- **Garante**: Persona o garantía propietaria que respalda el contrato. Puede ser garante propietario, garante salarial o seguro de caución.
- **Contrato de locación**: Acuerdo entre propietario e inquilino, intermediado por la inmobiliaria, con duración, monto inicial, periodicidad de ajuste y garantías asociadas.
- **Liquidación**: Cálculo mensual del importe que debe pagar el inquilino, compuesto por alquiler, expensas, servicios, impuestos, punitorios y otros conceptos.
- **Rendición**: Documento mensual que recibe el propietario detallando lo cobrado, las comisiones de la inmobiliaria, los gastos descontados y el saldo a girar.
- **Estado de cuenta**: Documento mensual por locador que consolida todas sus unidades: ingresos por unidad, gastos, honorarios, transferencias y compensaciones, y el saldo que se arrastra al mes siguiente. Reemplaza al acumulador que se armaba a mano en planillas.
- **Pago partido**: Modalidad de cobro en la que el inquilino paga una parte a la inmobiliaria (la comisión) y el resto directamente al locador. Las otras modalidades son pagar todo a la inmobiliaria o todo al locador.
- **Compensación**: Ajuste entre locadores cuando el inquilino de uno paga a otro: la inmobiliaria salda la diferencia, por ejemplo en efectivo, y el movimiento queda asentado en la cuenta de cada locador.
- **Ajuste IPC**: Actualización del monto del alquiler tomando como referencia el Índice de Precios al Consumidor publicado por el INDEC.
- **Ajuste ICL**: Actualización tomando como referencia el Índice para Contratos de Locación publicado por el BCRA, que es el índice previsto por la normativa de alquileres.
- **Ajuste CCP**: Actualización tomando como referencia el Coeficiente Casa Propia.
- **Ajuste por porcentaje fijo**: Modalidad donde el contrato pacta de antemano el porcentaje de aumento de cada período, sin atarse a un índice publicado.
- **Ajuste personalizado**: Modalidad donde las partes acuerdan el nuevo valor en cada período y se carga a mano.
- **UVA**: Unidad de Valor Adquisitivo publicada por el BCRA. El sistema la registra como tipo de índice —igual que el CVS y el CER— y el modelo la reconoce como modalidad de ajuste, pero el cálculo todavía no la resuelve: hoy las modalidades que un contrato puede pactar son las cinco anteriores.
- **Fin real**: Fecha en que el contrato terminó o terminará de hecho (`actualEndDate`), distinta del fin pactado. El fin efectivo es el fin real si se registró y, si no, el pactado. Un contrato pasado de su fin pactado sin fin real sigue activo y se sigue liquidando.
- **Prórroga de palabra**: Continuación del alquiler más allá del fin pactado, sin contrato nuevo. Se registra con un fin real posterior al pactado.
- **Acuerdo**: Convenio con fecha entre las partes que cambia las reglas de un contrato (renegociación, rebaja, bonificación, cambio de reglas, de reparto o de cargo). No pisa lo anterior: crea una versión de reglas desde su fecha.
- **Versión de reglas**: Foto de las reglas de un contrato (ajuste, base, rezago, vencimiento, flujo de cobro, descuentos) vigente desde una fecha. La regla de un día es la de la última versión con fecha anterior o igual. Los valores que la versión no fija salen de los valores por defecto de la inmobiliaria.
- **Rezago**: Cantidad de meses de atraso con que se toma un índice al ajustar. Con rezago 2, el ajuste de un mes usa el IPC publicado dos meses antes. El rezago por defecto del IPC es de 2 meses.
- **Comprobante ARCA**: Documento fiscal electrónico (factura A, B o C, recibo, nota de crédito) emitido contra los servicios web de ARCA (ex AFIP).
- **CAE**: Código de Autorización Electrónico devuelto por ARCA al aprobar un comprobante. Sin CAE, el comprobante no tiene validez fiscal.
- **Morosidad**: Estado del contrato cuando el inquilino registra una o más liquidaciones impagas vencidas.
- **Punitorio**: Recargo por mora aplicado sobre el saldo impago, calculado según la cláusula del contrato.
- **Derivación legal**: Marca interna que indica que un contrato moroso fue derivado al estudio jurídico de la inmobiliaria.
- **Prórroga de palabra**: Continuidad del alquiler acordada sin firmar un convenio escrito, de modo que la fecha de fin real difiere de la contractual.
- **Fin real**: Fecha efectiva de terminación del contrato cuando difiere de la pactada, por prórroga de palabra o por un acuerdo de salida. Es opcional.
- **Semáforo de vencimientos**: Indicador de color que muestra qué tan cerca o vencido está el fin de cada contrato y dispara su plan de seguimiento (devolución o renovación). Un contrato vencido sin fin real cargado sigue liquidando mientras esté activo, con el semáforo en rojo.
- **Pipeline comercial**: Secuencia de etapas por las que pasa un lead, desde la captación hasta la firma del contrato o el descarte.
- **Lead**: Interesado en alquilar o publicar un inmueble. Puede convertirse luego en inquilino o propietario.
- **Visita**: Evento de inspección de un inmueble por parte de un lead, agendado por un agente.
- **Tasación**: Estimación del valor de mercado de una propiedad, registrada con fecha y método de cálculo.
- **Scoring de inquilino**: Calificación interna del inquilino basada en historial de pagos, antigüedad y otros factores configurables.
- **Ciclo en sombra**: Ciclo mensual del piloto en el que el equipo replica en el ambiente `piloto` lo que la inmobiliaria hace con su sistema actual, sin que ella opere en Realfy.
- **Ciclo en paralelo**: Ciclo mensual del piloto en el que la inmobiliaria mira y compara los resultados de Realfy contra los de su sistema actual, que sigue siendo el oficial.
- **Reconciliación**: Comparación, por contrato y por locador, de los resultados de Realfy (total del recibo, comisión, neto y estado de cuenta) contra los del sistema actual. El criterio de aceptación es diferencia cero o explicada y registrada.
- **FB (feedback)**: Entrada del registro de hallazgos del piloto, con identificador `FB-nn`, que recorre el camino issue, PR, verificación y métrica. Distingue el origen relevamiento del origen uso real.

## Términos técnicos

- **Multi-tenant**: Patrón arquitectónico en el que una única instancia de software atiende a múltiples organizaciones (inmobiliarias), separando datos por `tenantId`.
- **Row-level multi-tenancy**: Variante donde la separación se garantiza por una columna `tenantId` en cada tabla, con filtrado obligatorio en cada consulta.
- **Monorepo**: Repositorio único que contiene varias aplicaciones y librerías. En este proyecto se gestiona con Turborepo y workspaces de pnpm.
- **JWT**: JSON Web Token. Mecanismo utilizado para autenticar a usuarios y portales.
- **Refresh token**: Token de larga duración que permite renovar el JWT de acceso sin volver a pedir credenciales.
- **ADR**: Architecture Decision Record. Documento corto que registra una decisión arquitectónica, su contexto y consecuencias.
- **i18n**: Internacionalización. En este proyecto se implementa con `next-intl`, español por defecto e inglés como stub.
- **e2e**: Pruebas de extremo a extremo. En este proyecto son de nivel HTTP: levantan la aplicación NestJS completa con Jest y le pegan contra una base PostgreSQL real, con las migraciones aplicadas desde cero. Recorren el camino entero —petición, autenticación, contexto de inmobiliaria, servicio, base de datos y respuesta— pero no son recorridos de navegador. El detalle está en `docs/pruebas.md`.
