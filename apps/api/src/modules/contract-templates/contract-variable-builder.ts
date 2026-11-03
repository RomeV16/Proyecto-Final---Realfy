import {
  amountInWords,
  dateInWords,
  formatDateAR,
  formatDniAR,
  formatMoneyAR,
  personName,
  todayInAR,
} from '@realfy/shared';
import type { TemplateLists } from '@realfy/shared';

/**
 * Flattens nested contract data (with persons, property, guarantees)
 * into a dot-path Record<string, string> for template variable interpolation.
 *
 * Variable naming follows the Argentine real-estate domain:
 *   - contrato.* — contract-level fields
 *   - propiedad.* — property fields
 *   - locadores.N.* (N desde 1) — cada locador vigente: nombre, documento,
 *     domicilio, capacidad y porcentaje de cobro; locadores.cantidad,
 *     locadores.lista (nombre y CUIT/CUIL de todos) y locadores.nombres
 *   - locador.* y propietario.* — el primer locador (alias para plantillas viejas)
 *   - apoderados.N.* / apoderados.cantidad / apoderados.lista — quienes actúan
 *     por un locador, con alcances y modo de firma
 *   - inquilino.* — el primer locatario; inquilinos.N.* / inquilinos.cantidad /
 *     inquilinos.nombres / inquilinos.lista — todos los locatarios
 *   - garante.* / garante2.* — guarantor person fields; garantes.N.* /
 *     garantes.cantidad / garantes.nombres / garantes.lista — todos los garantes
 *   - listas para `{{#cada}}`: inquilinos, locadores, garantes y apoderados
 *   - garantia.* / garantia2.* — guarantee instrument fields
 *   - inmobiliaria.* — tenant (company) fields
 */

interface PersonData {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  cuit?: string | null;
  dni?: string | null;
  address?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
}

interface LessorData {
  capacity: string;
  payoutPct: any;
  person: PersonData;
  /** Fin exclusivo de la titularidad; sin fin (o sin dato) sigue vigente. */
  validTo?: Date | string | null;
}

interface PowerData {
  scopes: string[];
  signatureMode: string;
  agent: PersonData;
  principal: PersonData;
}

interface ContractPersonData {
  role: string;
  person: PersonData;
}

interface GuaranteeData {
  type: string;
  description?: string | null;
  amount?: any;
  currency?: string | null;
  issuer?: string | null;
  policyNumber?: string | null;
}

interface PropertyData {
  title: string;
  street?: string | null;
  number?: string | null;
  floor?: string | null;
  apartment?: string | null;
  city?: string | null;
  province?: string | null;
  zipCode?: string | null;
  type: string;
  description?: string | null;
  cadastralId?: string | null;
  area?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
}

interface ContractData {
  id: string;
  contractType: string;
  status: string;
  startDate: Date | string;
  endDate: Date | string;
  rentAmount: any;
  rentCurrency: string;
  depositAmount?: any;
  depositCurrency?: string | null;
  adjustmentType: string;
  adjustmentPeriod: string;
  notes?: string | null;
  property?: PropertyData | null;
  persons?: ContractPersonData[];
  lessors?: LessorData[];
  apoderados?: PowerData[];
  guarantees?: GuaranteeData[];
}

interface TenantData {
  name: string;
  cuit: string;
  province?: string;
  logoUrl?: string | null;
  licenseNumber?: string | null;
  address?: string | null;
}

interface ServiceData {
  serviceType: string;
  accountNumber?: string | null;
}

/** Datos que no vienen en el contrato y que el servicio busca aparte. */
export interface ContractTemplateContext {
  /** Servicios e impuestos de la propiedad: de ahí salen la cuenta de Rentas y la unidad de Aguas. */
  services?: ServiceData[];
  /** Canon del período original del contrato. */
  initialRent?: unknown;
  /** Firma del período original, si se cargó. */
  signedAt?: Date | string | null;
  /** Fecha de firma indicada al generar el documento (AAAA-MM-DD); gana sobre la del contrato. */
  signingDate?: string | null;
}

/** Las fechas de un contrato son fechas sin hora (medianoche UTC): se leen en UTC para que el día no retroceda. */
function formatDate(d: Date | string): string {
  return formatDateAR(d);
}

function formatDateLong(d: Date | string): string {
  return new Date(d).toLocaleDateString('es-AR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Importe en letras; sin él (moneda sin texto, importe fuera de rango) la variable no se define. */
function wordsOrUndefined(amount: unknown, currency: string): string | undefined {
  try {
    return amountInWords(String(amount), currency);
  } catch {
    return undefined;
  }
}

function addMoneyVars(vars: Record<string, string>, key: string, amount: unknown, currency: string): void {
  vars[key] = formatMoneyAR(amount as string);
  const words = wordsOrUndefined(amount, currency);
  if (words) vars[`${key}EnLetras`] = words;
}

/** `<key>` (dd/mm/aaaa), `<key>Larga` ("1 de julio de 2026") y `<key>EnLetras` ("primero de julio de dos mil veintiséis"). */
function addDateVars(vars: Record<string, string>, key: string, date: Date | string): void {
  vars[key] = formatDate(date);
  vars[`${key}Larga`] = formatDateLong(date);
  vars[`${key}EnLetras`] = dateInWords(date);
}

/** "A", "A y B", "A, B y C". */
function joinY(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Datos de una persona, sin prefijo: sirven tanto para las variables como para los elementos de lista. */
function personFields(person: PersonData): Record<string, string> {
  const fields: Record<string, string> = {
    nombre: person.firstName,
    apellido: person.lastName,
    nombreCompleto: personName(person),
  };
  if (person.email) fields.email = person.email;
  if (person.phone) fields.telefono = person.phone;
  if (person.cuit) fields.cuit = person.cuit;
  if (person.dni) {
    fields.documento = person.dni;
    fields.dniConPuntos = formatDniAR(person.dni);
  }
  if (person.address) fields.domicilio = person.address;
  if (person.maritalStatus) fields.estadoCivil = person.maritalStatus;
  if (person.nationality) fields.nacionalidad = person.nationality;
  return fields;
}

function addPersonVars(
  vars: Record<string, string>,
  prefix: string,
  person: PersonData,
): void {
  for (const [field, value] of Object.entries(personFields(person))) {
    vars[`${prefix}.${field}`] = value;
  }
}

function formatPct(pct: any): string {
  return `${Number(pct).toLocaleString('es-AR', { maximumFractionDigits: 4 })} %`;
}

/**
 * Los locadores de hoy: quien ya dejó de serlo (`validTo` pasado) no firma el
 * contrato nuevo. Si el contrato ya no tiene ninguno vigente (un contrato
 * terminado), se listan todos antes que dejar el texto sin locador.
 */
function currentLessors(lessors: LessorData[]): LessorData[] {
  const today = todayInAR().getTime();
  const current = lessors.filter((l) => !l.validTo || new Date(l.validTo).getTime() > today);
  return current.length > 0 ? current : lessors;
}

/** Locadores y apoderados: variables indexadas y la lista corrida para el texto del contrato. */
function addLessorVars(vars: Record<string, string>, lists: TemplateLists, contract: ContractData): void {
  const lessors = currentLessors(contract.lessors ?? []);
  lists.locadores = lessors.map((l) => ({
    ...personFields(l.person),
    capacidad: l.capacity,
    porcentaje: formatPct(l.payoutPct),
  }));
  vars['locadores.cantidad'] = String(lessors.length);
  lessors.forEach((l, i) => {
    const prefix = `locadores.${i + 1}`;
    addPersonVars(vars, prefix, l.person);
    vars[`${prefix}.capacidad`] = l.capacity;
    vars[`${prefix}.porcentaje`] = formatPct(l.payoutPct);
  });
  if (lessors.length > 0) {
    // El primero es el locador "principal": alias para las plantillas que
    // hablaban de un solo propietario.
    for (const prefix of ['locador', 'propietario']) {
      addPersonVars(vars, prefix, lessors[0].person);
    }
    vars['locador.capacidad'] = lessors[0].capacity;
    vars['locador.porcentaje'] = formatPct(lessors[0].payoutPct);
    vars['locadores.nombres'] = lessors.map((l) => personName(l.person)).join(' / ');
    vars['locadores.lista'] = lessors
      .map((l) => (l.person.cuit ? `${personName(l.person)}, CUIT/CUIL ${l.person.cuit}` : personName(l.person)))
      .join(' y ');
  }

  const powers = contract.apoderados ?? [];
  lists.apoderados = powers.map((w) => ({
    ...personFields(w.agent),
    poderdante: personName(w.principal),
    alcances: w.scopes.join(', '),
    firma: w.signatureMode,
  }));
  vars['apoderados.cantidad'] = String(powers.length);
  powers.forEach((w, i) => {
    const prefix = `apoderados.${i + 1}`;
    addPersonVars(vars, prefix, w.agent);
    vars[`${prefix}.poderdante`] = personName(w.principal);
    vars[`${prefix}.alcances`] = w.scopes.join(', ');
    vars[`${prefix}.firma`] = w.signatureMode;
  });
  if (powers.length > 0) {
    vars['apoderados.lista'] = powers
      .map((w) => `${personName(w.agent)}, apoderado/a de ${personName(w.principal)}`)
      .join('; ');
  }
}

/**
 * Locatarios o garantes: el primero con su prefijo (`inquilino.*`), todos con
 * `<lista>.N.*`, y las variables corridas `<lista>.cantidad|nombres|lista`.
 */
function addPartyList(
  vars: Record<string, string>,
  lists: TemplateLists,
  listName: 'inquilinos' | 'garantes',
  people: PersonData[],
): void {
  lists[listName] = people.map(personFields);
  vars[`${listName}.cantidad`] = String(people.length);
  people.forEach((person, i) => addPersonVars(vars, `${listName}.${i + 1}`, person));
  if (people.length === 0) return;
  vars[`${listName}.nombres`] = joinY(people.map((p) => personName(p)));
  vars[`${listName}.lista`] = joinY(
    people.map((p) => (p.dni ? `${personName(p)}, DNI ${formatDniAR(p.dni)}` : personName(p))),
  );
}

function addPropertyVars(vars: Record<string, string>, p: PropertyData, services: ServiceData[]): void {
  vars['propiedad.titulo'] = p.title;
  const street = p.street ?? '';
  const num = p.number ?? '';
  vars['propiedad.direccion'] = `${street} ${num}`.trim() || p.title;
  if (p.floor) vars['propiedad.piso'] = p.floor;
  if (p.apartment) vars['propiedad.depto'] = p.apartment;
  if (p.city) vars['propiedad.ciudad'] = p.city;
  if (p.province) vars['propiedad.provincia'] = p.province;
  if (p.zipCode) vars['propiedad.codigoPostal'] = p.zipCode;
  vars['propiedad.tipo'] = p.type;
  if (p.area) vars['propiedad.superficie'] = String(p.area);
  if (p.rooms) vars['propiedad.ambientes'] = String(p.rooms);
  if (p.bedrooms) vars['propiedad.dormitorios'] = String(p.bedrooms);
  if (p.bathrooms) vars['propiedad.banos'] = String(p.bathrooms);
  if (p.description?.trim()) vars['propiedad.descripcion'] = p.description.trim();
  if (p.cadastralId?.trim()) vars['propiedad.catastro'] = p.cadastralId.trim();

  // Cuentas de los impuestos y servicios que el contrato cita.
  const account = (type: string) => services.find((s) => s.serviceType === type && s.accountNumber?.trim())?.accountNumber?.trim();
  const rentas = account('ImpuestoInmobiliario');
  if (rentas) vars['propiedad.cuentaRentas'] = rentas;
  const aguas = account('Agua');
  if (aguas) vars['propiedad.unidadAguas'] = aguas;

  // Full address for convenience
  const parts = [street, num, p.floor ? `Piso ${p.floor}` : '', p.apartment ? `Dto ${p.apartment}` : '', p.city, p.province].filter(Boolean);
  vars['propiedad.direccionCompleta'] = parts.join(', ');
}

/** Alquiler, depósito y fechas del contrato, con el importe y la fecha también en letras. */
function addContractVars(
  vars: Record<string, string>,
  contract: ContractData,
  context: ContractTemplateContext,
): void {
  vars['contrato.tipo'] = contract.contractType;
  vars['contrato.estado'] = contract.status;
  addDateVars(vars, 'contrato.fechaInicio', contract.startDate);
  addDateVars(vars, 'contrato.fechaFin', contract.endDate);
  addMoneyVars(vars, 'contrato.monto', contract.rentAmount, contract.rentCurrency);
  if (context.initialRent != null) {
    addMoneyVars(vars, 'contrato.montoInicial', context.initialRent, contract.rentCurrency);
  }
  vars['contrato.moneda'] = contract.rentCurrency;
  if (contract.depositAmount) {
    addMoneyVars(vars, 'contrato.deposito', contract.depositAmount, contract.depositCurrency ?? contract.rentCurrency);
  }
  vars['contrato.tipoAjuste'] = contract.adjustmentType;
  vars['contrato.periodoAjuste'] = contract.adjustmentPeriod;
  if (contract.notes) {
    vars['contrato.notas'] = contract.notes;
  }
  const signed = context.signingDate ?? context.signedAt;
  if (signed) addDateVars(vars, 'contrato.fechaFirma', signed);
}

/**
 * Variables (texto) y listas (para `{{#cada}}`) de un contrato y su inmobiliaria.
 * Todo lo que el contrato no tiene queda sin definir: en el documento se ve la
 * etiqueta `{{variable}}` y una condición `{{#si variable}}` da falso.
 */
export function buildContractTemplateData(
  contract: ContractData,
  tenant: TenantData,
  context: ContractTemplateContext = {},
): { variables: Record<string, string>; lists: TemplateLists } {
  const vars: Record<string, string> = {};
  const lists: TemplateLists = {};

  addContractVars(vars, contract, context);
  if (contract.property) addPropertyVars(vars, contract.property, context.services ?? []);

  // ─── Locadores y apoderados ─────────────────────────
  addLessorVars(vars, lists, contract);

  // ─── Person fields (by role) ────────────────────────
  const byRole = (role: string) => (contract.persons ?? []).filter((cp) => cp.role === role).map((cp) => cp.person);
  const tenants = byRole('Inquilino');
  addPartyList(vars, lists, 'inquilinos', tenants);
  if (tenants.length > 0) addPersonVars(vars, 'inquilino', tenants[0]);

  const guarantors = byRole('Garante');
  addPartyList(vars, lists, 'garantes', guarantors);
  guarantors.forEach((person, i) => addPersonVars(vars, i === 0 ? 'garante' : `garante${i + 1}`, person));

  const buyers = byRole('Comprador');
  if (buyers.length > 0) addPersonVars(vars, 'comprador', buyers[buyers.length - 1]);

  // ─── Guarantee instruments ──────────────────────────
  if (contract.guarantees) {
    contract.guarantees.forEach((g, i) => {
      const prefix = i === 0 ? 'garantia' : `garantia${i + 1}`;
      vars[`${prefix}.tipo`] = g.type;
      if (g.description) vars[`${prefix}.descripcion`] = g.description;
      if (g.amount) vars[`${prefix}.monto`] = formatMoneyAR(g.amount);
      if (g.issuer) vars[`${prefix}.emisor`] = g.issuer;
      if (g.policyNumber) vars[`${prefix}.poliza`] = g.policyNumber;
    });
  }

  // ─── Tenant (inmobiliaria) fields ───────────────────
  vars['inmobiliaria.nombre'] = tenant.name;
  vars['inmobiliaria.cuit'] = tenant.cuit;
  if (tenant.province) vars['inmobiliaria.provincia'] = tenant.province;
  if (tenant.licenseNumber?.trim()) vars['inmobiliaria.matricula'] = tenant.licenseNumber.trim();
  if (tenant.address?.trim()) vars['inmobiliaria.domicilio'] = tenant.address.trim();

  // ─── Date variables ─────────────────────────────────
  const today = todayInAR();
  vars['fecha.hoy'] = formatDate(today);
  vars['fecha.hoyLarga'] = formatDateLong(today);
  vars['fecha.hoyEnLetras'] = dateInWords(today);

  return { variables: vars, lists };
}

/** Las variables de texto de un contrato (ver `buildContractTemplateData`). */
export function buildContractVariables(
  contract: ContractData,
  tenant: TenantData,
  context: ContractTemplateContext = {},
): Record<string, string> {
  return buildContractTemplateData(contract, tenant, context).variables;
}
