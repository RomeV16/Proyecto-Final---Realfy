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
}

export enum LineItemType {
  Alquiler = 'Alquiler',
  Ajuste = 'Ajuste',
  Extra = 'Extra',
  Descuento = 'Descuento',
  Multa = 'Multa',
}

// ─── Service Enums ──────────────────────────────────────

export enum ServiceType {
  Electricidad = 'Electricidad',
  Gas = 'Gas',
  Agua = 'Agua',
  Internet = 'Internet',
  Expensas = 'Expensas',
  Municipal = 'Municipal',
  Otro = 'Otro',
}

// ─── Notification Enums ─────────────────────────────────

export enum NotificationType {
  ServiceDueReminder = 'ServiceDueReminder',
  ContractExpiring = 'ContractExpiring',
  LiquidacionOverdue = 'LiquidacionOverdue',
  PaymentReceived = 'PaymentReceived',
  SystemAlert = 'SystemAlert',
  StaleLeadAlert = 'StaleLeadAlert',
  TicketCreated = 'TicketCreated',
  TicketStatusChanged = 'TicketStatusChanged',
  TicketCommentAdded = 'TicketCommentAdded',
}

// ─── Pipeline Enums ─────────────────────────────────────

export enum PipelineType {
  Alquiler = 'Alquiler',
  Venta = 'Venta',
}

// ─── Lead Enums ─────────────────────────────────────────

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

// ─── Inventory Enums ────────────────────────────────────

export enum InventoryType {
  Ingreso = 'Ingreso',
  Egreso = 'Egreso',
}

export enum InventoryItemStatus {
  Bueno = 'Bueno',
  Regular = 'Regular',
  Malo = 'Malo',
  Faltante = 'Faltante',
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
}

export enum TicketPriority {
  Urgente = 'Urgente',
  Alta = 'Alta',
  Media = 'Media',
  Baja = 'Baja',
}
