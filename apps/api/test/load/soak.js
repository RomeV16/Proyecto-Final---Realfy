/**
 * CP-71 — Esfuerzo sostenido sobre la consulta de índices.
 *
 * Diez usuarios virtuales constantes durante K6_SOAK (10 minutos por
 * defecto; 5 en el pipeline). Lo que se mira además de los umbrales es que
 * el p95 del último tercio no crezca más de un 20 % respecto del primero
 * (sin fugas de memoria ni degradación), que se verifica al leer el
 * resumen exportado.
 *
 *   K6_URL=http://localhost:3001 K6_SOAK=10m k6 run apps/api/test/load/soak.js
 */
import { sleep } from 'k6';
import { setupTenant, browseIndices, THRESHOLDS } from './lib.js';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 10,
      duration: __ENV.K6_SOAK || '10m',
    },
  },
  thresholds: THRESHOLDS,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return setupTenant('soak');
}

export default function (data) {
  browseIndices(data.token);
  sleep(1);
}
