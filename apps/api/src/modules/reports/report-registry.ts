/** Columna de un reporte: la misma definición sirve para el Excel y el PDF. */
export interface ReportColumn {
  header: string;
  key: string;
  width: number;
  numeric?: boolean;
}

/** Método de ReportsService que arma los datos de un reporte. */
export type ReportMethod =
  | 'getOwnerStatement'
  | 'getPropertyProfitability'
  | 'getCashFlow'
  | 'getCommissionSummary'
  | 'getPipelineAnalytics'
  | 'getMorosidad';

export interface ReportDefinition {
  key: string;
  /** Título que lleva el reporte (también nombre de la hoja de Excel). */
  title: string;
  method: ReportMethod;
  /** Prefijo del nombre del archivo descargado o adjunto. */
  fileName: string;
  /** Claves de los datos que se imprimen en el PDF, en orden. */
  pdf: { keys: string[] };
  /** Columnas de la planilla. */
  excel: ReportColumn[];
}

function define(
  key: string,
  title: string,
  method: ReportMethod,
  fileName: string,
  excel: ReportColumn[],
): ReportDefinition {
  return { key, title, method, fileName, pdf: { keys: excel.map((c) => c.key) }, excel };
}

/**
 * Único lugar donde se declara qué reportes existen. El controlador, el
 * programador de envíos y los generadores de PDF y Excel leen de acá; para
 * agregar un reporte alcanza con sumar una entrada y el método del servicio.
 */
export const REPORT_REGISTRY = {
  ownerStatement: define('ownerStatement', 'Estado de Cuenta del Propietario', 'getOwnerStatement', 'estado-propietario', [
    { header: 'Período', key: 'periodo', width: 14 },
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Cobrado', key: 'cobrado', width: 16, numeric: true },
    { header: 'Comisión', key: 'comision', width: 16, numeric: true },
    { header: 'Honorarios', key: 'honorarios', width: 16, numeric: true },
    { header: 'Deducciones', key: 'deducciones', width: 16, numeric: true },
    { header: 'Depósito Neto', key: 'depositoNeto', width: 18, numeric: true },
  ]),
  propertyProfitability: define('propertyProfitability', 'Rentabilidad por Propiedad', 'getPropertyProfitability', 'rentabilidad-propiedad', [
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Cobrado', key: 'cobrado', width: 16, numeric: true },
    { header: 'Facturado', key: 'facturado', width: 16, numeric: true },
    { header: 'Comisiones', key: 'comisiones', width: 16, numeric: true },
    { header: 'Ingreso Neto', key: 'ingresoNeto', width: 18, numeric: true },
  ]),
  cashFlow: define('cashFlow', 'Flujo de Caja Mensual', 'getCashFlow', 'flujo-caja', [
    { header: 'Mes', key: 'mes', width: 22 },
    { header: 'Ingresos', key: 'ingresos', width: 16, numeric: true },
    { header: 'Egresos', key: 'egresos', width: 16, numeric: true },
    { header: 'Facturado', key: 'facturado', width: 16, numeric: true },
    { header: 'Saldo Neto', key: 'saldoNeto', width: 18, numeric: true },
  ]),
  commissionSummary: define('commissionSummary', 'Resumen de Comisiones', 'getCommissionSummary', 'resumen-comisiones', [
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Propietario', key: 'propietario', width: 25 },
    { header: 'Período', key: 'periodo', width: 14 },
    { header: 'Tipo Comisión', key: 'tipoComision', width: 16 },
    { header: 'Comisión', key: 'comision', width: 16, numeric: true },
    { header: 'Honorarios', key: 'honorarios', width: 16, numeric: true },
    { header: 'Total', key: 'total', width: 16, numeric: true },
  ]),
  pipelineAnalytics: define('pipelineAnalytics', 'Analítica de Pipeline', 'getPipelineAnalytics', 'analitica-pipeline', [
    { header: 'Etapa', key: 'etapa', width: 25 },
    { header: 'Leads Actuales', key: 'leadsActuales', width: 16, numeric: true },
    { header: 'Convertidos', key: 'convertidos', width: 16, numeric: true },
    { header: 'Perdidos', key: 'perdidos', width: 16, numeric: true },
    { header: 'Tasa Conversión', key: 'tasaConversion', width: 18 },
    { header: 'Promedio Conversión (días)', key: 'promedioConversionDias', width: 22, numeric: true },
  ]),
  morosidad: define('morosidad', 'Reporte de Morosidad', 'getMorosidad', 'morosidad', [
    { header: 'Propiedad', key: 'propiedad', width: 30 },
    { header: 'Inquilino', key: 'inquilino', width: 25 },
    { header: 'Período', key: 'periodo', width: 14 },
    { header: 'Vencimiento', key: 'vencimiento', width: 14 },
    { header: 'Días Vencidos', key: 'diasVencidos', width: 16, numeric: true },
    { header: 'Monto', key: 'monto', width: 16, numeric: true },
    { header: 'Moneda', key: 'moneda', width: 10 },
  ]),
} as const satisfies Record<string, ReportDefinition>;

export type ReportKey = keyof typeof REPORT_REGISTRY;

export const REPORT_KEYS = Object.keys(REPORT_REGISTRY) as ReportKey[];

/** Definición de un reporte por su clave; undefined si no existe. */
export function findReport(key: string): ReportDefinition | undefined {
  return (REPORT_REGISTRY as Record<string, ReportDefinition>)[key];
}
