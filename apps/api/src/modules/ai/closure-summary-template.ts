import type { ContractClosureFacts } from './contract-closure';

/**
 * Redacción propia del resumen de cierre.
 *
 * Es lo que se guarda cuando no hay modelo de lenguaje configurado, cuando la
 * llamada no vuelve o cuando la respuesta no pasa la validación, así que está
 * escrita para valerse sola y no como relleno: párrafos con hilo, la cifra
 * puesta donde aporta, y una lectura cualitativa del comportamiento de pago y de
 * la carga de mantenimiento.
 *
 * Parte exactamente de los mismos hechos que se le mandan al modelo, así que las
 * dos redacciones cuentan la misma historia con los mismos números.
 */

export interface ClosureSummaryText {
  summary: string;
  highlights: string[];
}

// ─── Formato ──────────────────────────────────────────────

function amount(value: number, currency: string): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: currency || 'ARS',
    maximumFractionDigits: 0,
  }).format(value);
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function percent(value: number): string {
  const rendered = Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
  return `${rendered} %`;
}

function days(value: number): string {
  return value === 1 ? '1 día' : `${value} días`;
}

function months(value: number): string {
  return value === 1 ? '1 mes' : `${value} meses`;
}

function count(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

/** Concuerda el verbo con la cantidad que lo sigue. */
function verb(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural;
}

/** Une una lista en prosa: `a`, `a y b`, `a, b y c`. */
function join(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`;
}

// ─── Lecturas cualitativas ────────────────────────────────

/** Cómo se leyó el comportamiento de pago, sin citar cifras. */
function paymentVerdict(facts: ContractClosureFacts): string {
  if (facts.liquidacionesCobradas === 0) {
    return 'No hubo cobranzas registradas, así que no queda historial de pago para evaluar.';
  }
  if (facts.liquidacionesSinCobrar > 0) {
    return 'Quedó deuda sin regularizar al cierre, que es el punto a tener en cuenta si el inquilino vuelve a presentarse.';
  }
  if (facts.porcentajeDePuntualidad >= 95) {
    return 'El comportamiento de pago fue muy bueno: prácticamente todo se cobró en término y sin necesidad de reclamo.';
  }
  if (facts.porcentajeDePuntualidad >= 80) {
    return 'El comportamiento de pago fue bueno, con atrasos puntuales que no llegaron a comprometer la cobranza.';
  }
  if (facts.porcentajeDePuntualidad >= 55) {
    return 'El comportamiento de pago fue irregular: se cobró todo, pero con seguimiento constante de por medio.';
  }
  return 'El comportamiento de pago fue problemático: el atraso fue la norma y cada período demandó gestión de cobranza.';
}

/** Cómo se leyó la carga de mantenimiento, sin citar cifras. */
function maintenanceVerdict(facts: ContractClosureFacts): string {
  if (facts.reclamosRecibidos === 0) {
    return 'La propiedad no generó reclamos durante la vigencia.';
  }
  if (facts.reclamosSinCerrar > 0) {
    return 'Quedan reclamos abiertos que conviene cerrar antes de volver a publicar la propiedad.';
  }
  if (facts.reclamosRecibidos <= 2) {
    return 'El mantenimiento fue liviano y todo lo que entró quedó resuelto.';
  }
  return 'El mantenimiento demandó atención sostenida, y todo lo que entró quedó resuelto.';
}

// ─── Párrafos ─────────────────────────────────────────────

function vigenciaParagraph(facts: ContractClosureFacts): string {
  const window = `entre el ${longDate(facts.inicioDeVigencia)} y el ${longDate(facts.cierreEfectivo)}`;
  const opening = `El contrato de ${facts.tipoDeContrato.toLowerCase()} estuvo vigente ${months(facts.mesesDeVigencia)}, ${window}, y cerró en estado ${facts.estadoDeCierre}.`;

  return facts.cerroAntesDeLoPactado
    ? `${opening} El cierre se adelantó respecto del vencimiento pactado para el ${longDate(facts.finPactado)}.`
    : opening;
}

function pagosParagraph(facts: ContractClosureFacts): string {
  if (facts.liquidacionesEmitidas === 0) {
    return 'No se emitieron liquidaciones sobre este contrato, así que no hay historial de cobranza.';
  }

  const parts: string[] = [
    `Se ${verb(facts.liquidacionesEmitidas, 'emitió', 'emitieron')} ${count(facts.liquidacionesEmitidas, 'liquidación', 'liquidaciones')} por ${amount(facts.montoFacturado, facts.moneda)}, de las que se ${verb(facts.liquidacionesCobradas, 'cobró', 'cobraron')} ${facts.liquidacionesCobradas}.`,
  ];

  if (facts.liquidacionesCobradas > 0) {
    const breakdown =
      facts.pagosConAtraso === 0
        ? `Todos los pagos entraron en término (${percent(facts.porcentajeDePuntualidad)} de puntualidad).`
        : `${count(facts.pagosEnTermino, 'pago entró', 'pagos entraron')} en término y ${facts.pagosConAtraso} con atraso, lo que deja una puntualidad de ${percent(facts.porcentajeDePuntualidad)}.`;
    parts.push(breakdown);
  }

  if (facts.pagosConAtraso > 0) {
    parts.push(
      `El atraso promedió ${days(facts.atrasoPromedioEnDias)} y el peor caso llegó a ${days(facts.atrasoMaximoEnDias)}.`,
    );
  }

  if (facts.liquidacionesSinCobrar > 0) {
    parts.push(
      `${verb(facts.liquidacionesSinCobrar, 'Quedó', 'Quedaron')} ${count(facts.liquidacionesSinCobrar, 'liquidación sin cobrar', 'liquidaciones sin cobrar')} por ${amount(facts.montoPendiente, facts.moneda)}.`,
    );
  }

  if (facts.punitoriosAplicados > 0) {
    const waived =
      facts.punitoriosCondonados > 0
        ? ` Se ${verb(facts.punitoriosCondonados, 'condonó', 'condonaron')} ${count(facts.punitoriosCondonados, 'punitorio', 'punitorios')}.`
        : '';
    parts.push(
      `Se ${verb(facts.punitoriosAplicados, 'aplicó', 'aplicaron')} ${count(facts.punitoriosAplicados, 'punitorio', 'punitorios')} por ${amount(facts.montoDePunitorios, facts.moneda)}.${waived}`,
    );
  }

  parts.push(paymentVerdict(facts));
  return parts.join(' ');
}

function reclamosParagraph(facts: ContractClosureFacts): string {
  if (facts.reclamosRecibidos === 0) {
    return maintenanceVerdict(facts);
  }

  const outcome: string[] = [];
  if (facts.reclamosResueltos > 0) {
    outcome.push(
      `${facts.reclamosResueltos} se ${verb(facts.reclamosResueltos, 'resolvió', 'resolvieron')}`,
    );
  }
  if (facts.reclamosSinCerrar > 0) {
    outcome.push(
      `${facts.reclamosSinCerrar} ${verb(facts.reclamosSinCerrar, 'sigue', 'siguen')} sin cerrar`,
    );
  }
  if (facts.reclamosAnulados > 0) {
    outcome.push(
      `${facts.reclamosAnulados} se ${verb(facts.reclamosAnulados, 'dio', 'dieron')} de baja`,
    );
  }

  const parts = [
    `Durante la vigencia ${verb(facts.reclamosRecibidos, 'entró', 'entraron')} ${count(facts.reclamosRecibidos, 'reclamo', 'reclamos')} de mantenimiento: ${join(outcome)}.`,
  ];

  if (facts.diasPromedioDeResolucion !== null) {
    parts.push(`La resolución llevó ${days(facts.diasPromedioDeResolucion)} en promedio.`);
  }
  if (facts.costoDeReclamos > 0) {
    parts.push(
      `Los arreglos cargados sumaron ${amount(facts.costoDeReclamos, facts.moneda)}.`,
    );
  }

  parts.push(maintenanceVerdict(facts));
  return parts.join(' ');
}

function ajustesParagraph(facts: ContractClosureFacts): string | null {
  if (facts.ajustesAplicados === 0) return null;

  const direction = facts.variacionDelAlquilerEnPorcentaje >= 0 ? 'subió' : 'bajó';
  const variation = percent(Math.abs(facts.variacionDelAlquilerEnPorcentaje));

  return `Se ${verb(facts.ajustesAplicados, 'aplicó', 'aplicaron')} ${count(facts.ajustesAplicados, 'ajuste de alquiler', 'ajustes de alquiler')}: el canon ${direction} de ${amount(facts.alquilerInicial, facts.moneda)} a ${amount(facts.alquilerFinal, facts.moneda)}, una variación de ${variation} sobre el valor inicial.`;
}

function rendicionesParagraph(facts: ContractClosureFacts): string | null {
  if (facts.rendicionesEmitidas === 0) return null;

  return `Al propietario se le ${verb(facts.rendicionesEmitidas, 'emitió', 'emitieron')} ${count(facts.rendicionesEmitidas, 'rendición', 'rendiciones')} por ${amount(facts.montoNetoRendido, facts.moneda)} netos.`;
}

// ─── Destacados ───────────────────────────────────────────

/**
 * Los puntos que hay que leer aunque no se lea el texto, en orden de importancia
 * para quien recibe el contrato cerrado. Se recorta a cinco, así que lo que va
 * primero es lo que sobrevive.
 */
function buildHighlights(facts: ContractClosureFacts): string[] {
  const highlights: string[] = [
    `Vigencia efectiva de ${months(facts.mesesDeVigencia)}, cerrada como ${facts.estadoDeCierre}`,
    facts.liquidacionesCobradas > 0
      ? `Puntualidad de ${percent(facts.porcentajeDePuntualidad)} sobre ${count(facts.liquidacionesCobradas, 'cobranza', 'cobranzas')}`
      : `Sin cobranzas registradas sobre ${count(facts.liquidacionesEmitidas, 'liquidación emitida', 'liquidaciones emitidas')}`,
  ];

  if (facts.liquidacionesSinCobrar > 0) {
    highlights.push(`Deuda al cierre de ${amount(facts.montoPendiente, facts.moneda)}`);
  }

  highlights.push(
    facts.reclamosRecibidos === 0
      ? 'Sin reclamos de mantenimiento'
      : `${count(facts.reclamosRecibidos, 'reclamo', 'reclamos')}, ${facts.reclamosResueltos} ${verb(facts.reclamosResueltos, 'resuelto', 'resueltos')}`,
  );

  if (facts.pagosConAtraso > 0) {
    highlights.push(
      `Atraso promedio de ${days(facts.atrasoPromedioEnDias)}, máximo de ${days(facts.atrasoMaximoEnDias)}`,
    );
  }
  if (facts.punitoriosAplicados > 0) {
    highlights.push(
      `${count(facts.punitoriosAplicados, 'punitorio aplicado', 'punitorios aplicados')} por ${amount(facts.montoDePunitorios, facts.moneda)}`,
    );
  }
  if (facts.ajustesAplicados > 0) {
    highlights.push(
      `${count(facts.ajustesAplicados, 'ajuste de alquiler', 'ajustes de alquiler')}, ${percent(Math.abs(facts.variacionDelAlquilerEnPorcentaje))} de variación`,
    );
  }

  return highlights.slice(0, 5);
}

// ─── Redacción completa ───────────────────────────────────

/**
 * Arma el resumen a partir de los hechos del contrato.
 * Determinista: los mismos hechos devuelven siempre el mismo texto.
 */
export function renderClosureSummary(facts: ContractClosureFacts): ClosureSummaryText {
  const paragraphs = [
    vigenciaParagraph(facts),
    pagosParagraph(facts),
    reclamosParagraph(facts),
    ajustesParagraph(facts),
    rendicionesParagraph(facts),
  ].filter((paragraph): paragraph is string => paragraph !== null);

  return {
    summary: paragraphs.join('\n\n'),
    highlights: buildHighlights(facts),
  };
}
