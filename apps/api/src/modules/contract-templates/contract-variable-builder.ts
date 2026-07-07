/**
 * Flattens nested contract data (with persons, property, guarantees)
 * into a dot-path Record<string, string> for template variable interpolation.
 *
 * Variable naming follows the Argentine real-estate domain:
 *   - contrato.* — contract-level fields
 *   - propiedad.* — property fields
 *   - propietario.* — owner person fields (PersonRole = Propietario)
 *   - inquilino.* — tenant person fields (PersonRole = Inquilino)
 *   - garante.* / garante2.* — guarantor person fields
 *   - garantia.* / garantia2.* — guarantee instrument fields
 *   - inmobiliaria.* — tenant (company) fields
 */

interface PersonData {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  cuit?: string | null;
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
  guarantees?: GuaranteeData[];
}

interface TenantData {
  name: string;
  cuit: string;
  province?: string;
  logoUrl?: string | null;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateLong(d: Date | string): string {
  return new Date(d).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatAmount(amount: any): string {
  return Number(amount).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function addPersonVars(
  vars: Record<string, string>,
  prefix: string,
  person: PersonData,
): void {
  vars[`${prefix}.nombre`] = person.firstName;
  vars[`${prefix}.apellido`] = person.lastName;
  vars[`${prefix}.nombreCompleto`] = `${person.firstName} ${person.lastName}`;
  if (person.email) vars[`${prefix}.email`] = person.email;
  if (person.phone) vars[`${prefix}.telefono`] = person.phone;
  if (person.cuit) vars[`${prefix}.cuit`] = person.cuit;
}

/**
 * Build a flat variable map from contract + tenant data for template interpolation.
 */
export function buildContractVariables(
  contract: ContractData,
  tenant: TenantData,
): Record<string, string> {
  const vars: Record<string, string> = {};

  // ─── Contract fields ────────────────────────────────
  vars['contrato.tipo'] = contract.contractType;
  vars['contrato.estado'] = contract.status;
  vars['contrato.fechaInicio'] = formatDate(contract.startDate);
  vars['contrato.fechaFin'] = formatDate(contract.endDate);
  vars['contrato.fechaInicioLarga'] = formatDateLong(contract.startDate);
  vars['contrato.fechaFinLarga'] = formatDateLong(contract.endDate);
  vars['contrato.monto'] = formatAmount(contract.rentAmount);
  vars['contrato.moneda'] = contract.rentCurrency;
  if (contract.depositAmount) {
    vars['contrato.deposito'] = formatAmount(contract.depositAmount);
  }
  vars['contrato.tipoAjuste'] = contract.adjustmentType;
  vars['contrato.periodoAjuste'] = contract.adjustmentPeriod;
  if (contract.notes) {
    vars['contrato.notas'] = contract.notes;
  }

  // ─── Property fields ────────────────────────────────
  if (contract.property) {
    const p = contract.property;
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

    // Full address for convenience
    const parts = [street, num, p.floor ? `Piso ${p.floor}` : '', p.apartment ? `Dto ${p.apartment}` : '', p.city, p.province].filter(Boolean);
    vars['propiedad.direccionCompleta'] = parts.join(', ');
  }

  // ─── Person fields (by role) ────────────────────────
  if (contract.persons) {
    let garanteIdx = 0;
    for (const cp of contract.persons) {
      const role = cp.role;
      if (role === 'Propietario') {
        addPersonVars(vars, 'propietario', cp.person);
      } else if (role === 'Inquilino') {
        addPersonVars(vars, 'inquilino', cp.person);
      } else if (role === 'Comprador') {
        addPersonVars(vars, 'comprador', cp.person);
      } else if (role === 'Garante') {
        const prefix = garanteIdx === 0 ? 'garante' : `garante${garanteIdx + 1}`;
        addPersonVars(vars, prefix, cp.person);
        garanteIdx++;
      }
    }
  }

  // ─── Guarantee instruments ──────────────────────────
  if (contract.guarantees) {
    contract.guarantees.forEach((g, i) => {
      const prefix = i === 0 ? 'garantia' : `garantia${i + 1}`;
      vars[`${prefix}.tipo`] = g.type;
      if (g.description) vars[`${prefix}.descripcion`] = g.description;
      if (g.amount) vars[`${prefix}.monto`] = formatAmount(g.amount);
      if (g.issuer) vars[`${prefix}.emisor`] = g.issuer;
      if (g.policyNumber) vars[`${prefix}.poliza`] = g.policyNumber;
    });
  }

  // ─── Tenant (inmobiliaria) fields ───────────────────
  vars['inmobiliaria.nombre'] = tenant.name;
  vars['inmobiliaria.cuit'] = tenant.cuit;
  if (tenant.province) vars['inmobiliaria.provincia'] = tenant.province;

  // ─── Date variables ─────────────────────────────────
  const now = new Date();
  vars['fecha.hoy'] = formatDate(now);
  vars['fecha.hoyLarga'] = formatDateLong(now);

  return vars;
}
