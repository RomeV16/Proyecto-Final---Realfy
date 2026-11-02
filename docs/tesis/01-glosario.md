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
- **Propietario**: Persona física o jurídica titular del inmueble, que cede la administración a la inmobiliaria. Desde el piloto, el sistema distingue tres papeles que el término mezclaba: quién es dueño (**titular**), quién alquila y cobra en cada contrato (**locador**) y quién actúa en nombre de otro (**apoderado**). El rol de persona «propietario» se conserva como etiqueta de cliente y se asigna solo al cargar a alguien como titular o como locador.
- **Inquilino**: Persona física o jurídica que firma el contrato de locación y abona el alquiler.
- **Garante**: Persona o garantía propietaria que respalda el contrato. Puede ser garante propietario, garante salarial o seguro de caución.
- **Contrato de locación**: Acuerdo entre uno o varios locadores —que firman por sí o por apoderado— y el inquilino, intermediado por la inmobiliaria, con duración, monto inicial, reglas de ajuste, reglas de liquidación y garantías asociadas. Sus reglas se versionan con acuerdos fechados (ver **Versión de reglas**).
- **Liquidación**: Cálculo mensual del importe que debe pagar el inquilino, compuesto por alquiler, ajuste, impuestos y servicios, cargos, punitorios y otros conceptos. Cada renglón lleva su destino —locador o inmobiliaria— y si es comisionable: la comisión se calcula sobre el alquiler y los punitorios, nunca sobre reparaciones, impuestos o servicios. Se genera unos diez días antes del mes y se identifica con un recibo numerado con el monto en letras.
- **Rendición**: Documento mensual por contrato que detalla lo cobrado, las comisiones de la inmobiliaria, los gastos descontados y el saldo a girar. Desde el piloto se emite una por cada locador vigente, con su parte según el porcentaje de cobro. Queda como histórico de consulta: la reemplazan la cuenta corriente y el estado de cuenta del locador (ADR-0009).
- **Cuenta corriente del locador**: Libro de movimientos con signo de cada locador (su parte de los cobros, comisiones, gastos, pagos a entes, compensaciones, pagos recibidos y saldo inicial). Saldo positivo: la inmobiliaria le debe; negativo: el locador le debe a la inmobiliaria.
- **Ajuste IPC**: Actualización del monto del alquiler tomando como referencia el Índice de Precios al Consumidor publicado por el INDEC.
- **Ajuste ICL**: Actualización tomando como referencia el Índice para Contratos de Locación publicado por el BCRA, que es el índice previsto por la normativa de alquileres.
- **Ajuste CCP**: Actualización tomando como referencia el Coeficiente Casa Propia.
- **Ajuste por porcentaje fijo**: Modalidad donde el contrato pacta de antemano el porcentaje de aumento de cada período, sin atarse a un índice publicado.
- **Ajuste personalizado**: Modalidad donde las partes acuerdan el nuevo valor en cada período y se carga a mano.
- **UVA**: Unidad de Valor Adquisitivo publicada por el BCRA. El sistema la registra como tipo de índice —igual que el CVS y el CER— y, desde el piloto, también como modalidad de ajuste: el cálculo la resuelve como el ICL, con el cociente entre el primer y el último valor diario de la ventana (ADR-0011).
- **Ajuste escalonado**: Modalidad donde el contrato pacta porcentajes de aumento por tramos, cada uno desde un mes de contrato; se aplica el porcentaje del último tramo que ya empezó.
- **Comprobante ARCA**: Documento fiscal electrónico (factura A, B o C, recibo, nota de crédito) emitido contra los servicios web de ARCA (ex AFIP).
- **CAE**: Código de Autorización Electrónico devuelto por ARCA al aprobar un comprobante. Sin CAE, el comprobante no tiene validez fiscal.
- **Morosidad**: Estado del contrato cuando el inquilino registra una o más liquidaciones impagas vencidas.
- **Derivación legal**: Marca interna que indica que un contrato moroso fue derivado al estudio jurídico de la inmobiliaria.
- **Pipeline comercial**: Secuencia de etapas por las que pasa un lead, desde la captación hasta la firma del contrato o el descarte.
- **Lead**: Interesado en alquilar o publicar un inmueble. Puede convertirse luego en inquilino o propietario.
- **Visita**: Evento de inspección de un inmueble por parte de un lead, agendado por un agente.
- **Tasación**: Estimación del valor de mercado de una propiedad, registrada con fecha y método de cálculo.
- **Scoring de inquilino**: Calificación interna del inquilino basada en historial de pagos, antigüedad y otros factores configurables.

## Términos del piloto

Términos que incorporó el piloto en una inmobiliaria real (ver `30-piloto.md`), en orden alfabético. Donde el concepto todavía no está implementado, la definición lo dice e indica el ítem del cronograma que lo trae.

- **Acuerdo**: Convenio con fecha entre las partes que cambia las reglas de un contrato (renegociación, rebaja, bonificación, cambio de reglas, de reparto o de cargo). No pisa lo anterior: crea una versión de reglas desde su fecha.
- **Anticipo**: Pago por adelantado que la inmobiliaria pide al inquilino cuando un cargo supera un umbral, en lugar de sumarlo a la liquidación siguiente. El umbral se mide en comisiones mensuales (dos por defecto) y se pacta por contrato. Un cargo marcado para anticipo no entra solo en la liquidación: se cobra por adelantado o se fuerza su imputación.
- **Apoderado**: Persona con poder para actuar en nombre de otra, con los alcances cobrar, firmar o administrar, y con firma conjunta (deben firmar todos) o indistinta (alcanza con uno). Los cotitulares pueden apoderarse entre sí para cobrar.
- **Boleta**: Factura de un impuesto o servicio de la unidad para un período (agua, tasa municipal, impuesto inmobiliario, luz, gas, expensas), cargada en Realfy individualmente o por planilla. Se reparte entre inquilino, inmobiliaria y locador según la regla de traslado del contrato, y la parte del inquilino entra en su liquidación sin comisión.
- **Cargo**: Gasto puntual imputado al inquilino, al locador o a la inmobiliaria: reparación, expensa extraordinaria, devolución, honorario de gestión o ajuste retroactivo. El del inquilino entra una sola vez en su próxima liquidación, sin comisión; el del locador se descuenta de lo que se le rinde; una devolución resta a favor del inquilino. Puede cargarse en cuotas.
- **Carta documento**: Comunicación postal con valor de notificación fehaciente. En la cobranza escalonada es la etapa prejudicial: intima al inquilino con un plazo de diez días corridos antes de derivar el caso al abogado. Planificada en el ítem 43.
- **Centro de carga**: Pantalla donde se cargan, uno por uno, en cuotas o por planilla, los cargos del mes, y donde se ven los pendientes, los imputados y los que esperan anticipo.
- **Ciclo en paralelo**: Ciclo mensual del piloto en el que la inmobiliaria mira y compara los resultados de Realfy contra los de su sistema actual, que sigue siendo el oficial.
- **Ciclo en sombra**: Ciclo mensual del piloto en el que el equipo replica en el ambiente `piloto` lo que la inmobiliaria hace con su sistema actual, sin que ella opere en Realfy.
- **Compensación**: Ajuste entre locadores cuando el inquilino de uno paga a otro: la inmobiliaria salda la diferencia, por ejemplo en efectivo, y el movimiento queda registrado para cada locador, pagándolo si hace falta con su custodia.
- **Corrección de ajuste**: Diferencia entre un ajuste provisorio, calculado con un índice estimado porque el oficial no estaba publicado, y el ajuste definitivo, calculado cuando el índice se publica. Entra como renglón de ajuste retroactivo en la liquidación siguiente, a favor o en contra del inquilino.
- **Custodia**: Dinero que la inmobiliaria guarda por cuenta de un locador: el efectivo cobrado en la oficina hasta que se le entrega, o fondos en moneda extranjera que el locador prefiere no convertir. Cada custodia es una cuenta propia del locador con su moneda, separada de la caja de la inmobiliaria, y su entrega al locador queda registrada.
- **Estado de cuenta**: Documento mensual por locador que consolida todas sus unidades: ingresos por unidad, gastos, honorarios, transferencias y compensaciones, y el saldo que se arrastra al mes siguiente. Reemplaza al acumulador que la inmobiliaria arma a mano en planillas. Implementado en el ítem 37 (ADR-0009): se genera por mes y moneda, se emite y se imprime o se comparte.
- **FB (feedback)**: Entrada del registro de hallazgos del piloto, con identificador `FB-nn`, que recorre el camino issue, PR, verificación y métrica. Distingue el origen relevamiento del origen uso real.
- **Fin real**: Fecha en que el contrato terminó o terminará de hecho (`actualEndDate`), cuando difiere del fin pactado por una prórroga de palabra o por un acuerdo de salida. Es opcional. El fin efectivo es el fin real si se registró y, si no, el pactado; la liquidación no genera meses posteriores al fin efectivo. Un contrato pasado de su fin pactado sin fin real sigue activo y se sigue liquidando.
- **Incidencia**: Problema de una unidad que requiere una reparación y que recorre caso, preautorización, presupuesto, ejecución, pago e imputación del costo al inquilino o al locador, con un honorario de gestión opcional. Amplía el ticket de mantenimiento actual y está planificada en el ítem 42.
- **Locador**: Persona que tiene la potestad de alquilar el inmueble y firma el contrato en ese carácter. Puede ser el titular, un usufructuario, un sublocador o un acreedor. Un contrato puede tener varios locadores, cada uno con su porcentaje de cobro y su vigencia, que en cada fecha suman exactamente cien por ciento y que no tienen por qué coincidir con los porcentajes de titularidad.
- **Outbox**: Cola de salida de mensajes. Cada correo o mensaje se guarda con una clave de idempotencia en la misma transacción que la operación que lo origina, y un proceso aparte lo envía y reintenta; así un envío fallido no deshace ni repite la operación de negocio. Planificada en el ítem 43 y en el ADR-0013.
- **Pago a cuenta**: Alquiler provisorio que se liquida cuando el índice oficial del mes de ajuste todavía no está publicado: se calcula con un índice estimado y se corrige después (ver **Corrección de ajuste**). La inmobiliaria puede desactivarlo; entonces el ajuste espera al índice oficial.
- **Pago partido**: Modalidad de cobro en la que el inquilino paga una parte a la inmobiliaria (la comisión) y el resto directamente al locador. Las otras modalidades son pagar todo a la inmobiliaria o todo al locador. El flujo de cobro se pacta por contrato, y al registrar cada cobro se indica quién recibió el dinero; el sistema reparte el importe y, si cobró el locador, registra lo que le debe a la inmobiliaria.
- **Preautorización**: Conformidad que el locador da antes de una reparación, por un monto máximo o sobre un presupuesto, para que la inmobiliaria la encargue y la impute. Planificada en el ítem 42.
- **Prórroga de palabra**: Continuidad del alquiler más allá del fin pactado, acordada sin un convenio escrito. Se registra cargando un fin real posterior al pactado.
- **Punitorio**: Recargo por mora sobre el saldo impago, calculado por día según la regla del contrato —por ejemplo, el doble de la tasa activa del Banco Nación o un porcentaje diario, la mayor— o, si el contrato no la fija, según los parámetros de la inmobiliaria. Se cobra como renglón «Multa» de la liquidación, es comisionable y su condonación queda auditada con motivo.
- **Reconciliación**: Comparación, por contrato y por locador, de los resultados de Realfy (total del recibo, comisión, neto y estado de cuenta) contra los del sistema actual. El criterio de aceptación es diferencia cero o explicada y registrada. El procedimiento está en `../calidad/12-piloto.md`.
- **Regla de traslado**: Regla de un contrato, con vigencia, que dice quién paga un impuesto o servicio —el inquilino, la inmobiliaria o el locador—, en qué proporción (porcentaje, consumo o importe fijo) y con qué plan (mensual, o anual en cuotas con su descuento). Cambia por acuerdo fechado y no se pisa: la anterior se cierra.
- **Reintegro**: Devolución a quien adelantó un pago que no le correspondía; típicamente, el impuesto o servicio a cargo del inquilino que pagó el locador o la inmobiliaria, y que vuelve a ellos a través de la liquidación del inquilino. En Realfy no es un tipo de renglón propio: es el renglón del impuesto, servicio o cargo con su destino.
- **Rezago**: Cantidad de meses de atraso con que se toma un índice al ajustar. Con rezago 2, el ajuste de un mes usa el IPC publicado dos meses antes. El rezago por defecto del IPC es de 2 meses y se pacta por contrato.
- **Semáforo de vencimientos**: Indicador de color que muestra qué tan cerca o vencido está el fin de cada contrato y dispara su plan de seguimiento (devolución o renovación). Un contrato vencido sin fin real cargado sigue liquidando mientras esté activo, con el semáforo en rojo. Los umbrales ya son valores por defecto de la inmobiliaria; el indicador y el seguimiento están planificados en el ítem 40.
- **Titular**: Persona que figura como dueña del inmueble, con su porcentaje si se conoce. La titularidad es opcional e independiente de quién es locador de un contrato: una persona puede ser titular sin ser locador, y al revés.
- **Versión de reglas**: Foto de las reglas de un contrato (ajuste, base, rezago, vencimiento, flujo de cobro, descuentos, punitorios y convenciones de liquidación) vigente desde una fecha. La regla de un día es la de la última versión con fecha anterior o igual. Los valores que la versión no fija salen de los valores por defecto de la inmobiliaria.

## Términos técnicos

- **Multi-tenant**: Patrón arquitectónico en el que una única instancia de software atiende a múltiples organizaciones (inmobiliarias), separando datos por `tenantId`.
- **Row-level multi-tenancy**: Variante donde la separación se garantiza por una columna `tenantId` en cada tabla, con filtrado obligatorio en cada consulta.
- **Monorepo**: Repositorio único que contiene varias aplicaciones y librerías. En este proyecto se gestiona con Turborepo y workspaces de pnpm.
- **JWT**: JSON Web Token. Mecanismo utilizado para autenticar a usuarios y portales.
- **Refresh token**: Token de larga duración que permite renovar el JWT de acceso sin volver a pedir credenciales.
- **ADR**: Architecture Decision Record. Documento corto que registra una decisión arquitectónica, su contexto y consecuencias.
- **i18n**: Internacionalización. En este proyecto se implementa con `next-intl`, español por defecto e inglés como stub.
- **e2e**: Pruebas de extremo a extremo. En este proyecto son de nivel HTTP: levantan la aplicación NestJS completa con Jest y le pegan contra una base PostgreSQL real, con las migraciones aplicadas desde cero. Recorren el camino entero —petición, autenticación, contexto de inmobiliaria, servicio, base de datos y respuesta— pero no son recorridos de navegador. El detalle está en `docs/pruebas.md`.
