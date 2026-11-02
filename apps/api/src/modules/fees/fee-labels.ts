/** Nombre de cada operación en los textos de recibos, notas de caja y la cuenta corriente. */
const KIND_LABEL: Record<string, string> = {
  AltaAlquiler: 'alta de alquiler',
  Renovacion: 'renovación',
  Venta: 'venta',
  Tasacion: 'tasación',
  GestionReparacion: 'gestión de reparación',
};

/** Texto de una cuota: "Honorarios de renovación, cuota 2/3". */
export function installmentLabel(fee: { kind: string; installments: number }, n: number): string {
  const suffix = fee.installments > 1 ? `, cuota ${n}/${fee.installments}` : '';
  return `Honorarios de ${KIND_LABEL[fee.kind] ?? fee.kind}${suffix}`;
}
