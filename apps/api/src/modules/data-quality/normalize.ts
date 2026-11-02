/**
 * Claves de comparación para encontrar personas repetidas. Ninguna se guarda:
 * sólo sirven para decidir si dos cargas son la misma cosa escrita distinto.
 * Devuelven `null` cuando el dato no alcanza para comparar (vacío, incompleto).
 */

const digits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '');

/** CUIT/CUIL: 11 dígitos, sin guiones ni puntos. */
export function normalizeCuit(value: string | null | undefined): string | null {
  const d = digits(value);
  return d.length === 11 ? d : null;
}

/** DNI: 7 u 8 dígitos, sin puntos ni ceros a la izquierda. */
export function normalizeDni(value: string | null | undefined): string | null {
  const d = digits(value).replace(/^0+/, '');
  return d.length >= 7 && d.length <= 8 ? d : null;
}

/**
 * El CUIL de una persona física lleva su DNI en el medio (prefijo 20, 23, 24 o
 * 27, ocho dígitos, verificador). Sirve para cruzar una persona cargada sólo
 * con DNI contra otra cargada sólo con CUIL. Una persona jurídica no lo tiene.
 */
export function dniFromCuit(cuit: string | null | undefined): string | null {
  const n = normalizeCuit(cuit);
  if (!n || !['20', '23', '24', '27'].includes(n.slice(0, 2))) return null;
  return normalizeDni(n.slice(2, 10));
}

/** CBU o CVU: 22 dígitos. El alias no se compara (no es único entre bancos). */
export function normalizeCbu(value: string | null | undefined): string | null {
  const d = digits(value);
  return d.length === 22 ? d : null;
}

/** Correo en minúsculas y sin espacios; descarta lo que no tiene forma de correo. */
export function normalizeEmail(value: string | null | undefined): string | null {
  const e = (value ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

/**
 * Teléfono argentino a sus 10 dígitos nacionales (área + abonado), para que
 * `+54 9 11 1234-5678`, `011 15 1234 5678` y `1112345678` den lo mismo:
 *  1. sólo dígitos; se saca el prefijo internacional `00`;
 *  2. se saca el `54` del país cuando sobran dígitos;
 *  3. se saca el `0` de discado nacional;
 *  4. se saca el `9` de celular que sigue al `54` (11 dígitos que empiezan en 9);
 *  5. se saca el `15` de celular que sigue al código de área (12 dígitos con
 *     `15` después de 2, 3 o 4 dígitos de área).
 * Un número con menos de 8 dígitos, o un número local sin área, no se compara
 * con uno que sí la tiene: quedan como están.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  let d = digits(value);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54') && d.length > 10) d = d.slice(2);
  d = d.replace(/^0+/, '');
  if (d.length === 11 && d.startsWith('9')) d = d.slice(1);
  if (d.length === 12) {
    const area = [2, 3, 4].find((a) => d.slice(a, a + 2) === '15');
    if (area !== undefined) d = d.slice(0, area) + d.slice(area + 2);
  }
  return d.length >= 8 ? d : null;
}

/**
 * Nombre sin tildes, mayúsculas, signos ni espacios repetidos, con las palabras
 * ordenadas: `Pérez, Juan` y `JUAN  PEREZ` coinciden. Es una coincidencia exacta
 * del nombre normalizado, no una búsqueda por parecido.
 */
export function normalizeName(firstName: string | null | undefined, lastName: string | null | undefined): string | null {
  const words = `${firstName ?? ''} ${lastName ?? ''}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length >= 2 ? words.sort().join(' ') : null;
}
