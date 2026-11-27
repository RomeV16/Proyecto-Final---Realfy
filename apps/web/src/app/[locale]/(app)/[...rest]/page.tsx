import { notFound } from 'next/navigation';

/** Cualquier ruta del panel que no existe muestra el "no encontrado" dentro de la aplicación. */
export default function UnknownAppRoute() {
  notFound();
}
