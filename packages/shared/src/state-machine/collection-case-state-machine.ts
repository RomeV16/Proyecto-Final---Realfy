import { CollectionStage } from '../enums';
import { defineStateMachine } from './define';

/**
 * Etapas de un caso de cobranza (ADR-0013).
 *
 *   Recordatorio → Prejudicial | Abogado | Cerrado
 *   Prejudicial  → Abogado | Cerrado
 *   Abogado      → Judicial | Cerrado
 *   Judicial     → Cerrado
 *   Cerrado      → (terminal: una mora nueva abre otro caso)
 *
 * Solo el paso de Recordatorio a Prejudicial lo hace el proceso diario (al
 * preparar la carta documento); derivar a un abogado, pasar a la vía judicial
 * y cerrar a mano son decisiones de una persona.
 */
const { Recordatorio, Prejudicial, Abogado, Judicial, Cerrado } = CollectionStage;

export const collectionCaseMachine = defineStateMachine<CollectionStage>([
  [Recordatorio, [Prejudicial, Abogado, Cerrado]],
  [Prejudicial, [Abogado, Cerrado]],
  [Abogado, [Judicial, Cerrado]],
  [Judicial, [Cerrado]],
  [Cerrado, []],
]);
