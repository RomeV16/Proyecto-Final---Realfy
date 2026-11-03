'use client';

import { useOptionalAuth } from '@/lib/auth-context';
import { UserRole, type ReadResource } from '@realfy/shared';
import { useReadAccess } from '@/lib/read-access';

const { Admin, Gerente, Ventas, Liquidaciones, Soporte, Lectura } = UserRole;

/**
 * Qué rol puede hacer qué, en un solo lugar. La API es la que impone los
 * permisos de verdad (`@Roles` + `RbacGuard`); esta matriz solo decide qué
 * botones, secciones y pantallas muestra la web. Cada acción lleva el nombre
 * de lo que habilita, no el de quién lo usa.
 */
export const ACTION_ROLES = {
  // Propiedades, personas y leads: el equipo comercial
  'properties.manage': [Admin, Gerente, Ventas],
  'properties.delete': [Admin, Gerente],
  /** Publicación: cambiar el estado de un aviso en un portal o en el micrositio y pausar lo que ya no corresponde. */
  'listings.manage': [Admin, Gerente, Ventas, UserRole.Marketing],
  'persons.manage': [Admin, Gerente, Ventas],
  'persons.delete': [Admin, Gerente],
  'persons.scoring': [Admin, Gerente],
  'leads.manage': [Admin, Gerente, Ventas],
  /** Usuarios a los que se les puede asignar un lead. */
  'leads.assignable': [Admin, Gerente, Ventas],
  'pipeline.access': [Admin, Gerente, Ventas],
  'pipeline.configure': [Admin, Gerente],
  'scoring.configure': [Admin, Gerente],

  // Contratos
  'contracts.manage': [Admin, Gerente, Ventas],
  'contracts.administer': [Admin, Gerente],

  // Liquidaciones, rendiciones y comprobantes
  'liquidaciones.generate': [Admin, Gerente],
  'liquidaciones.bulk': [Admin, Gerente],
  'liquidaciones.act': [Admin, Gerente, Ventas, Liquidaciones],
  /** Aviso de "solo lectura" en el listado de liquidaciones. */
  'liquidaciones.readOnlyNotice': [Lectura],
  'invoices.emit': [Admin, Gerente, Liquidaciones],
  'fiscal.configure': [Admin, Gerente],
  /** Facturación por cuenta del locador: ver comprobantes, cola y configuración. */
  'lessorInvoicing.view': [Admin, Gerente, Liquidaciones, Lectura],
  /** Facturar un cobro o un estado por cuenta del locador y emitir lo pendiente. */
  'lessorInvoicing.emit': [Admin, Gerente, Liquidaciones],
  /** Dar de alta el emisor delegado de un locador y definir qué y cuándo se factura. */
  'lessorInvoicing.configure': [Admin, Gerente],

  // Reportes, morosidad y tablero
  'reports.view': [Admin, Gerente, Liquidaciones],
  'reports.schedule': [Admin, Gerente],
  'delinquency.view': [Admin, Gerente],
  /** Boletas del mes y reglas de impuestos y servicios de cada contrato. */
  'serviceBills.manage': [Admin, Gerente, Liquidaciones],
  'charges.manage': [Admin, Gerente, Liquidaciones],
  /** Ajustes del mes: previsualizar y aplicar los ajustes de alquiler. */
  'adjustments.manage': [Admin, Gerente, Liquidaciones],
  /** Caja: ver cuentas, saldos, movimientos, custodia y recibos de cobro. */
  'cash.view': [Admin, Gerente, Liquidaciones, Lectura],
  /** Cargar movimientos y conversiones, entregar custodia y cerrar un cargo como gasto de la inmobiliaria. */
  'cash.manage': [Admin, Gerente, Liquidaciones],
  /** Alta, cambio de nombre y baja de las cuentas de la inmobiliaria. */
  'cash.accounts': [Admin, Gerente],
  /** Cuenta corriente y estados de cuenta de los locadores (reemplazan a las rendiciones). */
  'ownerAccounts.view': [Admin, Gerente, Liquidaciones, Lectura],
  /** Generar y emitir estados de cuenta y registrar pagos a locadores. */
  'ownerAccounts.manage': [Admin, Gerente, Liquidaciones],
  /** Cargar o corregir el saldo inicial de un locador y anular un estado emitido. */
  'ownerAccounts.administer': [Admin, Gerente],
  /** Vencimientos: asignar, cambiar el tipo, marcar el checklist y cerrar un seguimiento. */
  'followUps.manage': [Admin, Gerente, Ventas],
  /** Registrar una prórroga de palabra o renovar un contrato. */
  'expirations.administer': [Admin, Gerente],
  /** Honorarios: ver honorarios, cuotas y su cobro. */
  'fees.view': [Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte],
  /** Cargar, anular y repartir un honorario (coorretaje y comisión del personal). */
  'fees.manage': [Admin, Gerente],
  /** Cobrar una cuota de honorario. */
  'fees.collect': [Admin, Gerente, Liquidaciones],
  /** Ver y pagar las comisiones del personal. */
  'fees.commissions': [Admin, Gerente],
  /** Depósitos de los contratos: ver el depósito y la liquidación de egreso. */
  'deposits.view': [Admin, Gerente, Liquidaciones, Lectura],
  /** Cargar el depósito de un contrato y confirmar la liquidación de egreso. */
  'deposits.manage': [Admin, Gerente],
  /** Cobrar las cuotas del depósito. */
  'deposits.collect': [Admin, Gerente, Liquidaciones],
  'dashboard.analytics': [Admin, Gerente],

  // Soporte y configuración
  'tickets.manage': [Admin, Gerente, Soporte],
  /** Pagar al proveedor de una incidencia desde la caja e imputar el gasto a quien lo paga. */
  'tickets.pay': [Admin, Gerente, Liquidaciones],
  'settings.manage': [Admin, Gerente],
  /** Ver el equipo (solo lectura) y gestionarlo: invitar, cambiar roles, dar de baja. */
  'users.view': [Admin, Gerente],
  'users.manage': [Admin],
  /** Configurar qué roles leen los datos sensibles (política de lectura). */
  'permissions.manage': [Admin],
  /** Cambiar los valores por defecto de la operación (vencimiento, rezago, honorarios...). */
  'operationalDefaults.manage': [Admin, Gerente],
  /** Cambiar la regla de punitorios de la inmobiliaria (los valores del contrato los cambia quien gestiona). */
  'penaltyConfig.manage': [Admin],
  /** Cambiar la regla de punitorios de un contrato (queda como un acuerdo con vigencia). */
  'contractRules.manage': [Admin, Gerente],
  /** Condonar punitorios, uno por uno o todos los de un contrato. */
  'penalties.waive': [Admin, Gerente],
  /** Ver los lotes de importación desde el sistema anterior y su registro por fila. */
  'imports.manage': [Admin],
  /** Panel de calidad de datos: hallazgos de duplicados, repartos y contratos (expone datos personales agregados). */
  'dataQuality.view': [Admin, Gerente],
  /** Unir personas repetidas (mueve contratos, titularidades y cuentas a una sola). */
  'dataQuality.merge': [Admin],
  'indexData.view': [Admin, Gerente],
  'indexData.manage': [Admin],

  // Mensajería saliente (la API exige los mismos roles en cada ruta)
  /** Ver la bandeja de salida y los mensajes de un documento. */
  'messaging.view': [Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte],
  /** Mandar un recibo o un estado de cuenta por mail o por WhatsApp. */
  'messaging.send': [Admin, Gerente, Liquidaciones],
  /** Reintentar o cancelar un mensaje y ver la configuración de la mensajería. */
  'messaging.manage': [Admin, Gerente],
  /** Ver el consentimiento de mensajes de una persona. */
  'consents.view': [Admin, Gerente, Liquidaciones, Lectura, Ventas, Soporte],
  /** Registrar el alta o la baja de una persona en un canal. */
  'consents.manage': [Admin, Gerente, Ventas, Liquidaciones],
} as const satisfies Record<string, readonly UserRole[]>;

export type Action = keyof typeof ACTION_ROLES;

/** `true` si el rol puede realizar la acción. Un rol ausente o desconocido no puede nada. */
export function can(role: string | null | undefined, action: Action): boolean {
  if (!role) return false;
  return (ACTION_ROLES[action] as readonly string[]).includes(role);
}

/** `can` con el rol del usuario de la sesión. */
export function useCan(action: Action): boolean {
  const user = useOptionalAuth()?.user;
  return can(user?.role, action);
}

/**
 * `true` si la política de lectura de la inmobiliaria deja al rol del usuario
 * leer el recurso sensible. Mientras se consulta se asume que sí: la API es la
 * que niega (403 `READ_FORBIDDEN`) o enmascara el dato, y la web solo oculta.
 */
export function useCanRead(resource: ReadResource): boolean {
  const access = useReadAccess();
  return access === null ? true : access[resource];
}
