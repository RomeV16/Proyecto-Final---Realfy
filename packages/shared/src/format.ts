/** Campos de dirección de una propiedad que se usan para armar su etiqueta. */
export interface PropertyLabelInput {
  title?: string | null;
  street?: string | null;
  number?: string | null;
  floor?: string | null;
  apartment?: string | null;
}

/** Nombre y apellido de una persona. */
export interface PersonNameInput {
  firstName?: string | null;
  lastName?: string | null;
}

const clean = (value: string | null | undefined): string => (value ?? '').trim();

/**
 * Etiqueta legible de una propiedad: el título si lo tiene; si no, calle y
 * número, y la unidad (piso y departamento) separada por coma. Devuelve ''
 * cuando no hay ningún dato, para que cada pantalla elija su texto vacío.
 */
export function propertyLabel(property: PropertyLabelInput | null | undefined): string {
  if (!property) return '';
  const title = clean(property.title);
  if (title) return title;

  const street = [clean(property.street), clean(property.number)].filter(Boolean).join(' ');
  const floor = clean(property.floor);
  const unit = [floor ? `piso ${floor}` : '', clean(property.apartment)].filter(Boolean).join(' ');
  return [street, unit].filter(Boolean).join(', ');
}

/** "Nombre Apellido"; '' si la persona no tiene ninguno de los dos. */
export function personName(person: PersonNameInput | null | undefined): string {
  if (!person) return '';
  return [clean(person.firstName), clean(person.lastName)].filter(Boolean).join(' ');
}
