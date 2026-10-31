const NodeEnvironment = require('jest-environment-node').TestEnvironment;

/**
 * Entorno de Jest que deja a una prueba cambiar la zona horaria del proceso.
 *
 * Jest le da a cada archivo una copia de `process.env`: asignar `TZ` ahí no
 * llega al proceso real y las fechas no cambian de zona. Este entorno reenvía
 * las asignaciones de `TZ` al `process.env` verdadero, que Node aplica al
 * instante. Sirve para reproducir en la suite (que corre en UTC por
 * `utc.js`) los defectos que solo aparecen con el proceso en hora local.
 * Cada prueba que cambia la zona debe restaurarla en `afterAll`.
 */
class TzEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    const sandboxEnv = this.global.process.env;
    this.global.process.env = new Proxy(sandboxEnv, {
      set(target, key, value) {
        if (key === 'TZ') process.env.TZ = value;
        target[key] = value;
        return true;
      },
      deleteProperty(target, key) {
        if (key === 'TZ') process.env.TZ = 'UTC';
        delete target[key];
        return true;
      },
    });
  }
}

module.exports = TzEnvironment;
