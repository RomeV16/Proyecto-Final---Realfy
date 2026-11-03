/**
 * Todo lo que apunta a una persona y se mueve al unirla con otra. Se
 * enumeró del esquema de Prisma; `person-merge.config.spec.ts` lo compara con
 * el modelo de datos y falla si aparece una relación nueva sin tratar.
 *
 * - `repoint`: el campo se reescribe a la persona que se conserva.
 * - `dedupe`: hay una clave única; si la persona conservada ya tiene la misma
 *   fila, la de la persona unida se descarta, y si no, se reescribe.
 * - `conflict`: hay una clave única y no hay forma segura de elegir una fila:
 *   si ambas personas tienen una, la unión se rechaza con 409.
 */
export type MergeRule =
  | { kind: 'repoint'; delegate: string; field: string }
  | { kind: 'dedupe'; delegate: string; field: string; scope: string[] }
  | { kind: 'conflict'; delegate: string; field: string; scope: string[] };

/** Modelo de Prisma de cada delegado, para comparar con el esquema. */
export const MERGE_MODELS: Record<string, string> = {
  personBankAccount: 'PersonBankAccount',
  personDocument: 'PersonDocument',
  lead: 'Lead',
  contractLessor: 'ContractLessor',
  powerOfAttorney: 'PowerOfAttorney',
  propertyOwnership: 'PropertyOwnership',
  pendingCharge: 'PendingCharge',
  cashMovement: 'CashMovement',
  contractDeposit: 'ContractDeposit',
  compensation: 'Compensation',
  financialAccount: 'FinancialAccount',
  ownerLedgerEntry: 'OwnerLedgerEntry',
  ownerStatement: 'OwnerStatement',
  arcaIssuer: 'ArcaIssuer',
  lessorInvoiceJob: 'LessorInvoiceJob',
  fee: 'Fee',
  staffCommission: 'StaffCommission',
  ticket: 'Ticket',
  ticketComment: 'TicketComment',
  ticketQuote: 'TicketQuote',
  portalRefreshToken: 'PortalRefreshToken',
  portalInvitation: 'PortalInvitation',
  personRoleAssignment: 'PersonRoleAssignment',
  contractPerson: 'ContractPerson',
  ownerRendicion: 'OwnerRendicion',
  tenantScore: 'TenantScore',
  providerProfile: 'ProviderProfile',
  inquilinoCredential: 'InquilinoCredential',
};

export const MERGE_RULES: MergeRule[] = [
  { kind: 'repoint', delegate: 'personBankAccount', field: 'personId' },
  { kind: 'repoint', delegate: 'personDocument', field: 'personId' },
  { kind: 'repoint', delegate: 'lead', field: 'personId' },
  { kind: 'repoint', delegate: 'contractLessor', field: 'personId' },
  { kind: 'repoint', delegate: 'contractLessor', field: 'payeePersonId' },
  { kind: 'repoint', delegate: 'powerOfAttorney', field: 'principalId' },
  { kind: 'repoint', delegate: 'powerOfAttorney', field: 'agentId' },
  { kind: 'repoint', delegate: 'propertyOwnership', field: 'personId' },
  { kind: 'repoint', delegate: 'pendingCharge', field: 'lessorPersonId' },
  { kind: 'repoint', delegate: 'cashMovement', field: 'counterpartyId' },
  { kind: 'repoint', delegate: 'contractDeposit', field: 'heldByPersonId' },
  { kind: 'repoint', delegate: 'compensation', field: 'fromLessorId' },
  { kind: 'repoint', delegate: 'compensation', field: 'toLessorId' },
  { kind: 'repoint', delegate: 'ticket', field: 'createdByPersonId' },
  { kind: 'repoint', delegate: 'ticket', field: 'providerId' },
  { kind: 'repoint', delegate: 'ticket', field: 'preauthorizedByPersonId' },
  { kind: 'repoint', delegate: 'ticketQuote', field: 'providerId' },
  { kind: 'repoint', delegate: 'ticketQuote', field: 'approvedByPersonId' },
  { kind: 'repoint', delegate: 'ticketComment', field: 'personId' },
  { kind: 'repoint', delegate: 'portalRefreshToken', field: 'personId' },
  { kind: 'repoint', delegate: 'portalInvitation', field: 'personId' },
  // Honorarios: quien paga y la persona que cobra la comisión pasan a la conservada.
  { kind: 'repoint', delegate: 'fee', field: 'payerPersonId' },
  { kind: 'repoint', delegate: 'staffCommission', field: 'personId' },
  // El garante de un rol apunta a otra persona sin clave foránea.
  { kind: 'repoint', delegate: 'personRoleAssignment', field: 'guarantorForPersonId' },
  { kind: 'dedupe', delegate: 'personRoleAssignment', field: 'personId', scope: ['role'] },
  { kind: 'dedupe', delegate: 'contractPerson', field: 'personId', scope: ['contractId', 'role'] },
  // Una custodia por locador y moneda: dos custodias de la misma moneda no se juntan solas
  // (cada una tiene su libro); se entrega o se compensa una antes de unir.
  { kind: 'conflict', delegate: 'financialAccount', field: 'ownerPersonId', scope: ['kind', 'currency'] },
  { kind: 'conflict', delegate: 'ownerRendicion', field: 'ownerId', scope: ['contractId', 'period'] },
  // Cuenta corriente: los asientos pasan a la persona conservada; si las dos tienen un
  // asiento del mismo origen y concepto (por ejemplo, el saldo inicial de la misma
  // moneda, o la parte de cada una en el mismo cobro), sumarlos o elegir uno cambiaría
  // un saldo: la unión se rechaza y se corrige a mano antes.
  { kind: 'conflict', delegate: 'ownerLedgerEntry', field: 'personId', scope: ['sourceType', 'sourceId', 'type'] },
  // Un estado por locador, mes y moneda: dos estados del mismo mes no se juntan solos.
  { kind: 'conflict', delegate: 'ownerStatement', field: 'personId', scope: ['period', 'currency'] },
  // Un emisor delegado por persona: si las dos tienen uno, no se juntan solos (cada uno tiene su
  // CUIT, sus puntos de venta y su numeración).
  { kind: 'conflict', delegate: 'arcaIssuer', field: 'personId', scope: [] },
  // La cola de facturación por cuenta del locador: una por origen y tipo.
  { kind: 'conflict', delegate: 'lessorInvoiceJob', field: 'personId', scope: ['sourceType', 'sourceId', 'kind'] },
  { kind: 'conflict', delegate: 'tenantScore', field: 'personId', scope: [] },
  { kind: 'conflict', delegate: 'providerProfile', field: 'personId', scope: [] },
  { kind: 'conflict', delegate: 'inquilinoCredential', field: 'personId', scope: [] },
];

/** Campos de la persona que se completan desde la unida si la conservada los tiene vacíos. */
export const MERGE_FILL_FIELDS = [
  'email',
  'phone',
  'phone2',
  'cuit',
  'dni',
  'fiscalCondition',
  'address',
  'maritalStatus',
  'nationality',
  'payoutMethod',
] as const;
