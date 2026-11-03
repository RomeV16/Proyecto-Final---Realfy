export enum UserRole {
  Admin = 'Admin',
  Gerente = 'Gerente',
  Ventas = 'Ventas',
  Liquidaciones = 'Liquidaciones',
  Marketing = 'Marketing',
  Soporte = 'Soporte',
  Lectura = 'Lectura',
}

export enum TenantTier {
  Free = 'Free',
  Starter = 'Starter',
  Professional = 'Professional',
  Enterprise = 'Enterprise',
}

export enum Currency {
  ARS = 'ARS',
  USD = 'USD',
  EUR = 'EUR',
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export enum Province {
  BuenosAires = 'Buenos Aires',
  CABA = 'CABA',
  Catamarca = 'Catamarca',
  Chaco = 'Chaco',
  Chubut = 'Chubut',
  Cordoba = 'Córdoba',
  Corrientes = 'Corrientes',
  EntreRios = 'Entre Ríos',
  Formosa = 'Formosa',
  Jujuy = 'Jujuy',
  LaPampa = 'La Pampa',
  LaRioja = 'La Rioja',
  Mendoza = 'Mendoza',
  Misiones = 'Misiones',
  Neuquen = 'Neuquén',
  RioNegro = 'Río Negro',
  Salta = 'Salta',
  SanJuan = 'San Juan',
  SanLuis = 'San Luis',
  SantaCruz = 'Santa Cruz',
  SantaFe = 'Santa Fe',
  SantiagoDelEstero = 'Santiago del Estero',
  TierraDelFuego = 'Tierra del Fuego',
  Tucuman = 'Tucumán',
}

export enum PropertyType {
  Departamento = 'Departamento',
  Casa = 'Casa',
  PH = 'PH',
  Duplex = 'Duplex',
  Triplex = 'Triplex',
  Local = 'Local',
  Oficina = 'Oficina',
  Consultorio = 'Consultorio',
  Galpon = 'Galpon',
  Deposito = 'Deposito',
  Terreno = 'Terreno',
  Lote = 'Lote',
  Campo = 'Campo',
  Cochera = 'Cochera',
  Quincho = 'Quincho',
  Hotel = 'Hotel',
  Fondo_de_comercio = 'Fondo_de_comercio',
  Edificio = 'Edificio',
  Otro = 'Otro',
}

export enum PropertyOperationType {
  Venta = 'Venta',
  Alquiler = 'Alquiler',
  Temporario = 'Temporario',
}

/** Estado de un aviso en un portal. `Vencido` también se deduce de la fecha de vencimiento. */
export enum ListingStatus {
  NoPublicado = 'NoPublicado',
  Publicado = 'Publicado',
  Pausado = 'Pausado',
  Vencido = 'Vencido',
}

export enum PropertyState {
  Borrador = 'Borrador',
  Disponible = 'Disponible',
  Reservado = 'Reservado',
  Alquilado = 'Alquilado',
  Vendido = 'Vendido',
  Ocupado = 'Ocupado',
  Suspendido = 'Suspendido',
  Archivado = 'Archivado',
}

export enum PersonRole {
  Propietario = 'Propietario',
  Inquilino = 'Inquilino',
  Garante = 'Garante',
  Lead = 'Lead',
  Comprador = 'Comprador',
  Proveedor = 'Proveedor',
  Apoderado = 'Apoderado',
}

export enum LessorCapacity {
  Propietario = 'Propietario',
  Usufructuario = 'Usufructuario',
  Sublocador = 'Sublocador',
  Acreedor = 'Acreedor',
  Otro = 'Otro',
}

export enum SignatureMode {
  Indistinta = 'Indistinta',
  Conjunta = 'Conjunta',
}

export enum PowerScope {
  Cobrar = 'Cobrar',
  Firmar = 'Firmar',
  Administrar = 'Administrar',
}

export enum PersonType {
  Fisica = 'Fisica',
  Juridica = 'Juridica',
}

export enum PayoutMethod {
  Transferencia = 'Transferencia',
  Efectivo = 'Efectivo',
  Custodia = 'Custodia',
}

export enum FiscalCondition {
  ResponsableInscripto = 'ResponsableInscripto',
  Monotributista = 'Monotributista',
  ConsumidorFinal = 'ConsumidorFinal',
  Exento = 'Exento',
  NoResponsable = 'NoResponsable',
}

// ─── Contract Enums ─────────────────────────────────────

export enum ContractStatus {
  Borrador = 'Borrador',
  Activo = 'Activo',
  Vencido = 'Vencido',
  Rescindido = 'Rescindido',
  Renovado = 'Renovado',
  Archivado = 'Archivado',
}

export enum ContractType {
  Alquiler = 'Alquiler',
  AlquilerTemporario = 'AlquilerTemporario',
  Venta = 'Venta',
}

export enum AdjustmentType {
  IPC = 'IPC',
  ICL = 'ICL',
  CCP = 'CCP',
  FixedPercent = 'FixedPercent',
  Custom = 'Custom',
  UVA = 'UVA',
  Escalonado = 'Escalonado',
}

export enum AdjustmentPeriod {
  Mensual = 'Mensual',
  Bimestral = 'Bimestral',
  Trimestral = 'Trimestral',
  Cuatrimestral = 'Cuatrimestral',
  Semestral = 'Semestral',
  Anual = 'Anual',
}

export enum GuaranteeType {
  Seguro_de_caucion = 'Seguro_de_caucion',
  Garantia_propietaria = 'Garantia_propietaria',
  Garantia_bancaria = 'Garantia_bancaria',
  Deposito = 'Deposito',
  Otra = 'Otra',
}

export enum GuaranteeStatus {
  Vigente = 'Vigente',
  Vencida = 'Vencida',
  Cancelada = 'Cancelada',
}

export enum IndexType {
  IPC = 'IPC',
  ICL = 'ICL',
  CVS = 'CVS',
  CER = 'CER',
  UVA = 'UVA',
  TasaActivaBNA = 'TasaActivaBNA',
}

/** Tramo de vigencia de un contrato. */
export enum ContractPeriodKind {
  Original = 'Original',
  Renovacion = 'Renovacion',
  Prorroga = 'Prorroga',
}

/** Tipo de convenio que modifica las reglas de un contrato. */
export enum ContractAgreementKind {
  Renegociacion = 'Renegociacion',
  Rebaja = 'Rebaja',
  Bonificacion = 'Bonificacion',
  CambioRegla = 'CambioRegla',
  CambioReparto = 'CambioReparto',
  CambioCargo = 'CambioCargo',
  /** Prórroga de palabra: mueve el fin real sin cambiar el fin pactado. */
  Prorroga = 'Prorroga',
  /** Renovación como período del mismo contrato. */
  Renovacion = 'Renovacion',
}

/** Qué se prepara cuando se acerca el fin de un contrato. */
export enum FollowUpKind {
  Devolucion = 'Devolucion',
  Renovacion = 'Renovacion',
}

export enum DepositHolder {
  Locador = 'Locador',
  Inmobiliaria = 'Inmobiliaria',
}

/** Cómo se devuelve el depósito: pesos actualizados al último alquiler o la misma moneda. */
export enum DepositRefundRule {
  PesosActualizado = 'PesosActualizado',
  MismaMoneda = 'MismaMoneda',
}

export enum DepositStatus {
  Pendiente = 'Pendiente',
  Parcial = 'Parcial',
  Cobrado = 'Cobrado',
  Devuelto = 'Devuelto',
}

export enum MoveOutStatus {
  Borrador = 'Borrador',
  Confirmada = 'Confirmada',
}

export enum FollowUpStatus {
  Abierto = 'Abierto',
  Cerrado = 'Cerrado',
}

/** Cómo terminó el seguimiento de un vencimiento. */
export enum FollowUpOutcome {
  Pendiente = 'Pendiente',
  Renovado = 'Renovado',
  Devuelto = 'Devuelto',
  Prorrogado = 'Prorrogado',
}

/** Sobre qué alquiler se aplica un ajuste: el original del período o el vigente. */
export enum AdjustmentBase {
  Original = 'Original',
  Vigente = 'Vigente',
}

/** Quién cobra el alquiler: se reparte, todo la inmobiliaria o todo el locador. */
export enum PaymentFlow {
  Partido = 'Partido',
  TodoInmobiliaria = 'TodoInmobiliaria',
  TodoLocador = 'TodoLocador',
}

/**
 * Convenciones de liquidación, pactables por contrato (con valor por defecto de
 * la inmobiliaria). Cómo se prorratea un mes parcial.
 */
export enum ProrationMode {
  /** Días reales del mes; el día de inicio cuenta. */
  DiasReales = 'DiasReales',
  /** Mes comercial de 30 días. */
  Mes30 = 'Mes30',
  /** Mes completo, sin prorrateo. */
  SinProrrateo = 'SinProrrateo',
}

/** Cuándo rige un ajuste de alquiler que cae a mitad de mes. */
export enum MidMonthAdjustmentMode {
  DesdePeriodoSiguiente = 'DesdePeriodoSiguiente',
  Prorrateado = 'Prorrateado',
  DesdeEsePeriodo = 'DesdeEsePeriodo',
}

/** Cómo se cobra el primer mes cuando el contrato empieza pasado el día de vencimiento (o al firmar). */
export enum FirstDueMode {
  DiaDeInicio = 'DiaDeInicio',
  VencimientoMesSiguiente = 'VencimientoMesSiguiente',
  AlFirmar = 'AlFirmar',
}

/** Si un descuento de monto fijo se prorratea en un mes parcial. */
export enum FixedDiscountProration {
  Proporcional = 'Proporcional',
  Completo = 'Completo',
}

export enum ScheduleStatus {
  Pending = 'Pending',
  Calculated = 'Calculated',
  Applied = 'Applied',
  Skipped = 'Skipped',
}

// ─── Liquidacion Enums ──────────────────────────────────

export enum LiquidacionStatus {
  Borrador = 'Borrador',
  Revision = 'Revision',
  Aprobada = 'Aprobada',
  Pendiente = 'Pendiente',
  Enviada = 'Enviada',
  Pagada = 'Pagada',
  Vencida = 'Vencida',
  Anulada = 'Anulada',
}

export enum PaymentMethod {
  Transferencia = 'Transferencia',
  Efectivo = 'Efectivo',
  MercadoPago = 'MercadoPago',
  Cheque = 'Cheque',
  /** Pago interno de la liquidación de egreso: el depósito aplicado a las deudas; no se elige a mano. */
  AplicacionDeposito = 'AplicacionDeposito',
}

export enum LineItemType {
  Alquiler = 'Alquiler',
  Ajuste = 'Ajuste',
  Extra = 'Extra',
  Descuento = 'Descuento',
  Multa = 'Multa',
  Impuesto = 'Impuesto',
  Servicio = 'Servicio',
  Cargo = 'Cargo',
  Honorario = 'Honorario',
  AjusteRetroactivo = 'AjusteRetroactivo',
}

/** A quién le corresponde el importe de un renglón de la liquidación. */
export enum LineBeneficiary {
  Locador = 'Locador',
  Inmobiliaria = 'Inmobiliaria',
  Ente = 'Ente',
}

export enum LiquidacionKind {
  Mensual = 'Mensual',
  PagoACuenta = 'PagoACuenta',
  Egreso = 'Egreso',
}

// ─── Service Enums ──────────────────────────────────────

export enum ServiceType {
  Electricidad = 'Electricidad',
  Gas = 'Gas',
  Agua = 'Agua',
  Internet = 'Internet',
  Expensas = 'Expensas',
  Municipal = 'Municipal',
  /** Impuesto inmobiliario provincial (Rentas). */
  ImpuestoInmobiliario = 'ImpuestoInmobiliario',
  Otro = 'Otro',
}

/** Cada cuánto llega la boleta de un servicio o impuesto. */
export enum BillingFrequency {
  Mensual = 'Mensual',
  Bimestral = 'Bimestral',
  Trimestral = 'Trimestral',
  Anual = 'Anual',
}

/** Quién paga un impuesto o servicio según lo pactado en el contrato. */
export enum ChargePayer {
  /** Paga directo al ente; no pasa por la inmobiliaria. */
  Inquilino = 'Inquilino',
  /** El inquilino le paga a la inmobiliaria y ésta paga al ente. */
  Inmobiliaria = 'Inmobiliaria',
  /** El inquilino paga con el alquiler y todo pasa al locador (por cuenta y orden). */
  Propietario = 'Propietario',
}

/** Cómo se calcula la parte de la boleta que le toca al inquilino. */
export enum ChargeSplitMode {
  Porcentaje = 'Porcentaje',
  Consumo = 'Consumo',
  Fijo = 'Fijo',
}

export enum ServicePaymentPlan {
  Mensual = 'Mensual',
  Anual = 'Anual',
}

/** Cómo se recupera del inquilino una boleta anual. */
export enum AnnualRecovery {
  Unico = 'Unico',
  Prorrateado = 'Prorrateado',
}

/** A quién va el descuento por pago anual de una boleta. */
export enum AnnualDiscountBeneficiary {
  /** El inquilino: se le cobra lo efectivamente pagado. */
  Inquilino = 'Inquilino',
  /** Se cobra el importe sin descuento y la diferencia es del locador. */
  Locador = 'Locador',
  /** Se cobra el importe sin descuento y la diferencia es de la inmobiliaria. */
  Inmobiliaria = 'Inmobiliaria',
}

/** Qué se hace con las cuotas anuales que quedan cuando el contrato termina antes. */
export enum RemainingInstallmentsOnEnd {
  CobrarEnLiquidacionFinal = 'CobrarEnLiquidacionFinal',
  Descartar = 'Descartar',
}

export enum ServiceBillStatus {
  Pendiente = 'Pendiente',
  Pagada = 'Pagada',
  Anulada = 'Anulada',
}

/** Cómo se originó una boleta: la cargó una persona o la leyó el sistema de un documento (ADR-0018). */
export enum ServiceBillSource {
  Manual = 'Manual',
  Automatica = 'Automatica',
}

/** Por dónde llegó una boleta al circuito de obtención automática (ADR-0018). */
export enum BillChannel {
  Consulta = 'Consulta',
  Mail = 'Mail',
  Portal = 'Portal',
  Archivo = 'Archivo',
}

/**
 * Estado de un documento de boleta. Recibida: guardado y sin procesar; Procesada: se
 * leyó y dio de alta la boleta; RequiereRevision: una persona decide; Rechazada: una
 * persona lo descartó; Duplicada: la boleta ya estaba cargada con el mismo importe.
 */
export enum BillDocumentStatus {
  Recibida = 'Recibida',
  Procesada = 'Procesada',
  RequiereRevision = 'RequiereRevision',
  Rechazada = 'Rechazada',
  Duplicada = 'Duplicada',
}

/** Resultado de un intento de consulta a un proveedor. */
export enum BillFetchResult {
  Ok = 'Ok',
  SinNovedad = 'SinNovedad',
  Error = 'Error',
  Bloqueado = 'Bloqueado',
}

/** Quién pagó la boleta al ente. */
export enum BillPaidBy {
  Inquilino = 'Inquilino',
  Inmobiliaria = 'Inmobiliaria',
  Propietario = 'Propietario',
}

/** Quién soporta un cargo puntual del centro de carga. */
export enum ChargeTarget {
  Inquilino = 'Inquilino',
  Locador = 'Locador',
  Inmobiliaria = 'Inmobiliaria',
}

export enum PendingChargeKind {
  Reparacion = 'Reparacion',
  ExpensaExtra = 'ExpensaExtra',
  Devolucion = 'Devolucion',
  HonorarioGestion = 'HonorarioGestion',
  AjusteRetroactivo = 'AjusteRetroactivo',
  Otro = 'Otro',
}

/**
 * Ajuste aplicado después de emitir la liquidación de un mes en que ya regía
 * (DEF-134): `Retroactivo` deja la diferencia de cada mes emitido como cargo
 * `AjusteRetroactivo` para la próxima liquidación; `SinRetroactivo`, el ajuste
 * rige desde la próxima y los meses emitidos quedan como se cobraron.
 */
export enum LateAdjustmentBilling {
  Retroactivo = 'Retroactivo',
  SinRetroactivo = 'SinRetroactivo',
}

/** Comisión mensual con la que se mide el umbral de anticipo del centro de carga. */
export enum UpfrontBasis {
  ComisionPactada = 'ComisionPactada',
  PorcentajePorDefecto = 'PorcentajePorDefecto',
}

export enum PendingChargeStatus {
  Pendiente = 'Pendiente',
  Imputado = 'Imputado',
  CobradoAnticipado = 'CobradoAnticipado',
  Anulado = 'Anulado',
}

// ─── Caja y cobros ──────────────────────────────────────

export enum FinancialAccountKind {
  Caja = 'Caja',
  Banco = 'Banco',
  Custodia = 'Custodia',
}

export enum CashDirection {
  In = 'In',
  Out = 'Out',
}

/** Categoría de un movimiento del libro de la inmobiliaria. `Sena` es la seña. */
export enum CashCategory {
  AlquilerCobrado = 'AlquilerCobrado',
  PagoLocador = 'PagoLocador',
  PagoEnte = 'PagoEnte',
  PagoProveedor = 'PagoProveedor',
  Honorario = 'Honorario',
  Gasto = 'Gasto',
  ComisionEmpleado = 'ComisionEmpleado',
  Sena = 'Sena',
  Custodia = 'Custodia',
  Deposito = 'Deposito',
  Compensacion = 'Compensacion',
  Conversion = 'Conversion',
}

/**
 * Qué le debe el locador a la inmobiliaria cuando el inquilino le paga
 * directamente. Lo fija la inmobiliaria y se puede pactar por contrato.
 */
export enum LessorDirectOwes {
  /** Todo lo que no es del locador: comisión, renglones de la inmobiliaria y renglones de entes. */
  TodoLoAjeno = 'TodoLoAjeno',
  /** Solo comisión y renglones de la inmobiliaria; el locador paga los entes. */
  SoloInmobiliaria = 'SoloInmobiliaria',
}

/** Quién recibió un cobro: la inmobiliaria o el locador directamente. */
export enum PaymentReceiver {
  Inmobiliaria = 'Inmobiliaria',
  Locador = 'Locador',
}

// ─── Cuenta corriente del locador ───────────────────────

/**
 * Concepto de un asiento de la cuenta corriente del locador (ADR-0009). El
 * importe lleva signo: positivo, la inmobiliaria le debe al locador; negativo,
 * le descuenta o le pagó.
 */
export enum OwnerLedgerEntryType {
  SaldoInicial = 'SaldoInicial',
  Alquiler = 'Alquiler',
  Punitorio = 'Punitorio',
  ReintegroImpuesto = 'ReintegroImpuesto',
  Comision = 'Comision',
  Honorario = 'Honorario',
  Cargo = 'Cargo',
  PagoEnte = 'PagoEnte',
  Transferencia = 'Transferencia',
  EntregaEfectivo = 'EntregaEfectivo',
  /** Lo que el locador cobró directamente del inquilino (flujo "cobra el locador"). */
  CobroDirecto = 'CobroDirecto',
  Compensacion = 'Compensacion',
  Custodia = 'Custodia',
  Ajuste = 'Ajuste',
}

export enum OwnerStatementStatus {
  Borrador = 'Borrador',
  Emitido = 'Emitido',
  Enviado = 'Enviado',
  Anulado = 'Anulado',
}

// ─── Honorarios ─────────────────────────────────────────

/** Operación por la que se cobra un honorario. */
export enum FeeKind {
  AltaAlquiler = 'AltaAlquiler',
  Renovacion = 'Renovacion',
  Venta = 'Venta',
  Tasacion = 'Tasacion',
  GestionReparacion = 'GestionReparacion',
}

/** Sobre qué se calcula el honorario. */
export enum FeeBasis {
  /** Porcentaje del total del contrato (o del período renovado). */
  TotalContrato = 'TotalContrato',
  /** Porcentaje del valor real de la operación (venta). */
  ValorOperacion = 'ValorOperacion',
  /** Importe fijo (tasación, honorario pactado). */
  MontoFijo = 'MontoFijo',
}

/** Quién paga el honorario. */
export enum FeePayerRole {
  Inquilino = 'Inquilino',
  Locador = 'Locador',
  Comprador = 'Comprador',
  Vendedor = 'Vendedor',
  Otro = 'Otro',
}

export enum FeeStatus {
  Pendiente = 'Pendiente',
  Parcial = 'Parcial',
  Pagado = 'Pagado',
  SinCargo = 'SinCargo',
  Anulado = 'Anulado',
}

export enum FeeInstallmentStatus {
  Pendiente = 'Pendiente',
  Pagada = 'Pagada',
  Anulada = 'Anulada',
}

/** Cómo se cobró una cuota: entró a una cuenta de la inmobiliaria o se descontó de la cuenta del locador. */
export enum FeeSettlement {
  Caja = 'Caja',
  CuentaLocador = 'CuentaLocador',
}

/** IVA del honorario: no corresponde, va incluido en el porcentaje o se suma. */
export enum FeeVatMode {
  NoAplica = 'NoAplica',
  Incluido = 'Incluido',
  Adicional = 'Adicional',
}

// ─── Notification Enums ─────────────────────────────────

export enum NotificationType {
  ServiceDueReminder = 'ServiceDueReminder',
  ContractExpiring = 'ContractExpiring',
  LiquidacionOverdue = 'LiquidacionOverdue',
  /**
   * @deprecated Sin emisor: el aviso de un cobro le llega a quien pagó como
   * mensaje de la bandeja de salida (plantilla `receipt`, ADR-0013). Queda en
   * la base por las filas viejas.
   */
  PaymentReceived = 'PaymentReceived',
  /** Configuración que impide operar (por ejemplo, mensajes trabados sin proveedor). */
  SystemAlert = 'SystemAlert',
  StaleLeadAlert = 'StaleLeadAlert',
  TicketCreated = 'TicketCreated',
  /**
   * @deprecated Sin emisor: el cambio de estado de un ticket se le avisa al
   * inquilino por la bandeja de salida (plantilla `ticket_status`, ADR-0013).
   */
  TicketStatusChanged = 'TicketStatusChanged',
  TicketCommentAdded = 'TicketCommentAdded',
  FiscalCertExpiry = 'FiscalCertExpiry',
  FiscalDelegationRevoked = 'FiscalDelegationRevoked',
  LibroIvaGenerated = 'LibroIvaGenerated',
  /** Un mensaje de la bandeja de salida agotó los intentos o el proveedor lo rechazó. */
  MessageFailed = 'MessageFailed',
  /** Una persona pidió la baja respondiendo BAJA o STOP. */
  ContactOptedOut = 'ContactOptedOut',
  /** Llegó un mensaje a la bandeja de consultas (consulta nueva sin responsable o mensaje nuevo en una abierta). */
  InboundMessageReceived = 'InboundMessageReceived',
  /** Una consulta de la bandeja pasó su plazo de primera respuesta sin que nadie contestara. */
  InboxSlaBreached = 'InboxSlaBreached',
  /** Le asignaron una consulta de la bandeja. */
  InboxAssigned = 'InboxAssigned',
}

// ─── Mensajería saliente (ADR-0013) ─────────────────────

export enum MessageChannel {
  Email = 'Email',
  WhatsApp = 'WhatsApp',
}

/**
 * Estado de un mensaje de la bandeja de salida. Pending espera al despacho (con
 * el motivo en `statusReason` si algo lo frena); Sending está tomado por el
 * despacho; Sent lo aceptó el proveedor; Delivered y Read llegan por webhook;
 * Failed agotó los intentos o fue rechazado; Blocked no se manda por el modo
 * del ambiente o por el consentimiento; Cancelled lo canceló una persona.
 */
export enum MessageStatus {
  Pending = 'Pending',
  Sending = 'Sending',
  Sent = 'Sent',
  Delivered = 'Delivered',
  Read = 'Read',
  Failed = 'Failed',
  Blocked = 'Blocked',
  Cancelled = 'Cancelled',
}

export enum ConsentStatus {
  OptIn = 'OptIn',
  OptOut = 'OptOut',
}

/** Quién registró el consentimiento: el personal, la persona escribiendo, o una queja de spam. */
export enum ConsentSource {
  Manual = 'Manual',
  Inbound = 'Inbound',
  Complaint = 'Complaint',
}

// ─── Cobranza escalonada (ADR-0013) ─────────────────────

/**
 * Etapa de un caso de cobranza. Recordatorio: avisos amistosos por el canal del
 * inquilino. Prejudicial: carta documento preparada para el envío físico.
 * Abogado: derivado a un profesional. Judicial: en juicio o desalojo. Cerrado:
 * pagado, acordado o dado de baja a mano.
 */
export enum CollectionStage {
  Recordatorio = 'Recordatorio',
  Prejudicial = 'Prejudicial',
  Abogado = 'Abogado',
  Judicial = 'Judicial',
  Cerrado = 'Cerrado',
}

/** Qué pasó (o qué toca) en un caso de cobranza. */
export enum CollectionActionKind {
  /** Primer aviso, tono amable. */
  Recordatorio = 'Recordatorio',
  /** Segundo y tercer aviso, de tono más firme (`level` 2 y 3). */
  RecordatorioFirme = 'RecordatorioFirme',
  CartaDocumento = 'CartaDocumento',
  DerivacionAbogado = 'DerivacionAbogado',
  Nota = 'Nota',
  Pago = 'Pago',
  Acuerdo = 'Acuerdo',
}

/** Una carta documento se prepara (borrador) y recién queda realizada cuando alguien confirma el envío. */
export enum CollectionActionStatus {
  Preparada = 'Preparada',
  Realizada = 'Realizada',
}

// ─── Pipeline Enums ─────────────────────────────────────

export enum PipelineType {
  Alquiler = 'Alquiler',
  Venta = 'Venta',
}

// ─── Lead Enums ─────────────────────────────────────────

/** Canal por el que llega una consulta a la bandeja (ADR-0013, bandeja de consultas). */
export enum ConversationChannel {
  WhatsApp = 'WhatsApp',
  Email = 'Email',
  Web = 'Web',
  Telefono = 'Telefono',
}

/**
 * Estado de una consulta. Nueva: nadie la tomó; Asignada: tiene responsable y
 * nadie contestó; EnCurso: se está atendiendo; Esperando: se espera al cliente;
 * Resuelta: cerrada (si el cliente escribe de nuevo dentro de la ventana, se reabre);
 * Archivada: fuera de la bandeja.
 */
export enum ConversationStatus {
  Nueva = 'Nueva',
  Asignada = 'Asignada',
  EnCurso = 'EnCurso',
  Esperando = 'Esperando',
  Resuelta = 'Resuelta',
  Archivada = 'Archivada',
}

/** Sentido de un mensaje de una consulta: In lo escribió el cliente; Out, la inmobiliaria. */
export enum MessageDirection {
  In = 'In',
  Out = 'Out',
}

export enum LeadSource {
  WebInquiry = 'WebInquiry',
  PhoneCall = 'PhoneCall',
  Email = 'Email',
  WalkIn = 'WalkIn',
  Referral = 'Referral',
  Portal = 'Portal',
  SocialMedia = 'SocialMedia',
  Other = 'Other',
}

export enum LeadStatus {
  Nuevo = 'Nuevo',
  Contactado = 'Contactado',
  Calificado = 'Calificado',
  Convertido = 'Convertido',
  Perdido = 'Perdido',
}

// ─── Interaction & Visit Enums ──────────────────────────

export enum InteractionType {
  Llamada = 'Llamada',
  Email = 'Email',
  WhatsApp = 'WhatsApp',
  Visita = 'Visita',
  Nota = 'Nota',
}

export enum VisitStatus {
  Programada = 'Programada',
  Completada = 'Completada',
  Cancelada = 'Cancelada',
  NoShow = 'NoShow',
}

export enum VisitOutcome {
  Interesado = 'Interesado',
  NoInteresado = 'NoInteresado',
  Pendiente = 'Pendiente',
  Oferta = 'Oferta',
}

// ─── Comprobante Enums ──────────────────────────────────

// ─── Facturación por cuenta del locador ─────────────────

export enum LessorInvoiceSource {
  Payment = 'Payment',
  OwnerStatement = 'OwnerStatement',
}

export enum LessorInvoiceKind {
  Factura = 'Factura',
  NotaCredito = 'NotaCredito',
}

export enum LessorInvoiceStatus {
  Pendiente = 'Pendiente',
  Emitido = 'Emitido',
  Fallido = 'Fallido',
  /** No había nada para facturar (sin importe en el alcance o sin factura que anular). */
  Omitido = 'Omitido',
}

export enum ComprobanteType {
  FacturaA = 'FacturaA',
  FacturaB = 'FacturaB',
  FacturaC = 'FacturaC',
  NotaCreditoA = 'NotaCreditoA',
  NotaCreditoB = 'NotaCreditoB',
  NotaCreditoC = 'NotaCreditoC',
  NotaDebitoA = 'NotaDebitoA',
  NotaDebitoB = 'NotaDebitoB',
  NotaDebitoC = 'NotaDebitoC',
}

export enum ComprobanteStatus {
  Emitido = 'Emitido',
  Anulado = 'Anulado',
}

// ─── Commission & Rendicion Enums ───────────────────────

export enum CommissionType {
  FixedPercent = 'FixedPercent',
  FixedAmount = 'FixedAmount',
  Mixed = 'Mixed',
}

export enum RendicionStatus {
  Borrador = 'Borrador',
  Aprobada = 'Aprobada',
  Enviada = 'Enviada',
  Depositada = 'Depositada',
}

export enum RendicionLineItemType {
  Alquiler = 'Alquiler',
  Comision = 'Comision',
  AdminFee = 'AdminFee',
  Deduccion = 'Deduccion',
  Ajuste = 'Ajuste',
}

// ─── Valuation Enums ────────────────────────────────────

export enum ValuationMethod {
  Comparativo = 'Comparativo',
  Costo = 'Costo',
  Ingreso = 'Ingreso',
  Mixto = 'Mixto',
}

// ─── Ticket Enums ───────────────────────────────────────

export enum TicketStatus {
  Abierto = 'Abierto',
  Asignado = 'Asignado',
  EnProgreso = 'EnProgreso',
  ProveedorAsignado = 'ProveedorAsignado',
  ProveedorEnCamino = 'ProveedorEnCamino',
  TrabajoRealizado = 'TrabajoRealizado',
  Resuelto = 'Resuelto',
  Cerrado = 'Cerrado',
  Cancelado = 'Cancelado',
  Reabierto = 'Reabierto',
  PendienteAutorizacion = 'PendienteAutorizacion',
  Presupuestado = 'Presupuestado',
  PresupuestoAprobado = 'PresupuestoAprobado',
}

export enum TicketQuoteStatus {
  Pendiente = 'Pendiente',
  Aprobado = 'Aprobado',
  Rechazado = 'Rechazado',
}

/** Por dónde se registró una aprobación (de un presupuesto o la preautorización). */
export enum ApprovalChannel {
  WhatsApp = 'WhatsApp',
  Telefono = 'Telefono',
  Mail = 'Mail',
  Presencial = 'Presencial',
}

export enum TicketPriority {
  Urgente = 'Urgente',
  Alta = 'Alta',
  Media = 'Media',
  Baja = 'Baja',
}

export enum ImportBatchStatus {
  Validando = 'Validando',
  Validado = 'Validado',
  Ejecutando = 'Ejecutando',
  Completado = 'Completado',
  Fallido = 'Fallido',
}

export enum ImportEntity {
  Persona = 'Persona',
  Propiedad = 'Propiedad',
  Contrato = 'Contrato',
  Servicio = 'Servicio',
  ReglaDeCargo = 'ReglaDeCargo',
}

export enum ImportRowAction {
  Creado = 'Creado',
  Actualizado = 'Actualizado',
  SinCambios = 'SinCambios',
  Error = 'Error',
}

// ─── Ventas y llaves ────────────────────────────────────

/** Etapa de una operación de venta. La escritura se registra como estado final y fecha: no se gestiona. */
export enum SalesOperationStatus {
  Captacion = 'Captacion',
  Publicada = 'Publicada',
  Reservada = 'Reservada',
  SenaRecibida = 'SenaRecibida',
  Boleto = 'Boleto',
  Escriturada = 'Escriturada',
  Cancelada = 'Cancelada',
}

/** Lado de la operación al que pertenece una parte. */
export enum SalesPartyRole {
  Comprador = 'Comprador',
  Vendedor = 'Vendedor',
}

/** Reserva (compromiso con vencimiento) o seña (pago a cuenta del precio). */
export enum SalesDepositKind {
  Reserva = 'Reserva',
  Sena = 'Sena',
}

/** Quién guarda el dinero de una reserva o seña. */
export enum SalesDepositHolder {
  Inmobiliaria = 'Inmobiliaria',
  Vendedor = 'Vendedor',
  Escribano = 'Escribano',
}

/**
 * Estado de una reserva o seña. `Devuelta` y `Retenida` se registran a mano:
 * el sistema nunca decide solo quién se queda con el dinero.
 */
export enum SalesDepositStatus {
  Pendiente = 'Pendiente',
  Recibida = 'Recibida',
  Devuelta = 'Devuelta',
  Retenida = 'Retenida',
  Vencida = 'Vencida',
  Aplicada = 'Aplicada',
}

/** Quién tiene un juego de llaves. */
export enum KeyHolder {
  Oficina = 'Oficina',
  Propietario = 'Propietario',
  Inquilino = 'Inquilino',
  Empleado = 'Empleado',
  Tercero = 'Tercero',
}
