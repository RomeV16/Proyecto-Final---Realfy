import { z } from 'zod';
import { ServiceType } from '../enums';

/** Proveedores del catálogo de obtención automática de boletas (ADR-0018). */
export const SPECIFIC_BILL_PROVIDER_KEYS = [
  'aguas-cordobesas',
  'ecogas',
  'epec',
  'muni-cordoba',
  'rentas-cordoba',
] as const;

/** Los proveedores que se reconocen por su firma más el lector genérico de respaldo. */
export const BILL_PROVIDER_KEYS = [...SPECIFIC_BILL_PROVIDER_KEYS, 'generico'] as const;

export type BillProviderKey = (typeof BILL_PROVIDER_KEYS)[number];

export const BillProviderKeySchema = z.enum(BILL_PROVIDER_KEYS);

/** Tipo de servicio que cubre cada proveedor (el genérico no asume ninguno). */
export const BILL_PROVIDER_SERVICE_TYPES: Record<BillProviderKey, ServiceType[]> = {
  'aguas-cordobesas': [ServiceType.Agua],
  ecogas: [ServiceType.Gas],
  epec: [ServiceType.Electricidad],
  'muni-cordoba': [ServiceType.Municipal],
  'rentas-cordoba': [ServiceType.ImpuestoInmobiliario],
  generico: [],
};
