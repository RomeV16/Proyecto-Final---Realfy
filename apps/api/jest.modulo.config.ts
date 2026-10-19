import type { Config } from 'jest';
import base from './jest.config';

/**
 * Configuración de la suite unitaria acotada al módulo de índices y ajustes
 * (docs/calidad/02-plan-de-pruebas.md). Mide cobertura solo sobre el módulo
 * y aplica su propio piso, independiente del piso global de jest.config.ts.
 *
 * Piso, no meta: se sube cuando la cobertura real ya subió.
 * Línea base (commit 2eb2fa7): 44.89 líneas / 25.26 ramas / 46.93 funciones /
 * 45.93 sentencias, con 18 pruebas. Piso inicial: 40 / 22 / 40 / 40.
 * Medición al subirlo (día 3 del plan de calidad): 94.81 líneas / 86.31 ramas /
 * 95.65 funciones / 94.25 sentencias, con 91 pruebas. Piso actual: 80 / 70 / 80 / 80,
 * que es la meta de nivel 3 del TP y queda por debajo de lo medido.
 */
const config: Config = {
  ...base,
  testRegex: ['src/modules/index-data/.*\\.spec\\.ts$'],
  collectCoverageFrom: ['src/modules/index-data/**/*.ts'],
  coverageDirectory: './coverage-modulo',
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
};

export default config;
