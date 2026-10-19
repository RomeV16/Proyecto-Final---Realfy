import type { Config } from 'jest';
import base from './jest.config';

/**
 * Configuración de la suite unitaria acotada al módulo de índices y ajustes
 * (docs/calidad/02-plan-de-pruebas.md). Mide cobertura solo sobre el módulo
 * y aplica su propio piso, independiente del piso global de jest.config.ts.
 *
 * Piso, no meta: se sube cuando la cobertura real ya subió.
 * Medición al fijarlo (commit 2eb2fa7): 44.89 líneas / 25.26 ramas /
 * 46.93 funciones / 45.93 sentencias, con 18 pruebas.
 */
const config: Config = {
  ...base,
  testRegex: ['src/modules/index-data/.*\\.spec\\.ts$'],
  collectCoverageFrom: ['src/modules/index-data/**/*.ts'],
  coverageDirectory: './coverage-modulo',
  coverageThreshold: {
    global: {
      lines: 40,
      functions: 40,
      branches: 22,
      statements: 40,
    },
  },
};

export default config;
