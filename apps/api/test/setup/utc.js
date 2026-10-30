/**
 * Zona horaria fija para toda corrida de jest. Los cálculos de períodos y
 * vencimientos dependen de la zona de la máquina; con esto el resultado es el
 * mismo en una laptop en Buenos Aires que en el pipeline (UTC).
 */
module.exports = async function setup() {
  process.env.TZ = 'UTC';
};
