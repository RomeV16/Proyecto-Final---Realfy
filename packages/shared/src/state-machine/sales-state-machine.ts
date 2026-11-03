import { SalesOperationStatus } from '../enums';
import { defineStateMachine } from './define';

const { Captacion, Publicada, Reservada, SenaRecibida, Boleto, Escriturada, Cancelada } = SalesOperationStatus;

/**
 * Operación de venta: Captacion → Publicada → Reservada → SenaRecibida → Boleto → Escriturada.
 * Desde Reservada y SenaRecibida se vuelve a Publicada (la operación se libera, por vencimiento
 * de la reserva o porque el comprador se retira); el dinero recibido tiene que haberse devuelto
 * o retenido antes. Cancelada y Escriturada son finales: la escritura se registra como estado
 * y fecha, no se gestiona.
 */
export const salesMachine = defineStateMachine<SalesOperationStatus>([
  [Captacion, [Publicada, Cancelada]],
  [Publicada, [Captacion, Reservada, Cancelada]],
  [Reservada, [SenaRecibida, Publicada, Cancelada]],
  [SenaRecibida, [Boleto, Publicada, Cancelada]],
  [Boleto, [Escriturada, Cancelada]],
  [Escriturada, []],
  [Cancelada, []],
]);

/** Estados en los que la operación sigue abierta (no es final). */
export const OPEN_SALES_STATUSES: readonly SalesOperationStatus[] = [Captacion, Publicada, Reservada, SenaRecibida, Boleto];
