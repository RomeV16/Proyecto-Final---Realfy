/**
 * Textos sintéticos de boletas para las pruebas, con la estructura (etiquetas y orden) de los
 * documentos de cada proveedor y datos inventados ("Inmobiliaria Demo"). Cada función da las
 * líneas tal como las devuelve la extracción de texto de un PDF.
 */

export interface MuniFixture {
  /** Objeto del portal tributario ("I" y dígitos). */
  objeto?: string;
  /** Identificación tributaria (15 dígitos). */
  identificador?: string;
  year?: number;
  cuota?: number;
  /** Vencimientos "dd/mm/aaaa" con su importe tal como se imprime. */
  venc?: { date: string; amount: string }[];
  total?: string;
}

/** Cedulón actual de la Contribución sobre los Inmuebles (portal tributario). */
export function muniCurrentLines(o: MuniFixture = {}): string[] {
  const venc = o.venc ?? [{ date: '14/12/2026', amount: '$12.345,67' }];
  return [
    `Inmueble: ${o.objeto ?? 'I0000001'}`,
    'Titular: TITULAR DE PRUEBA - P0000001',
    'Localidad: CORDOBA - CORDOBA',
    'Municipalidad de Córdoba',
    'Datos Generales:',
    `Part.Muni.: ${o.objeto ?? 'I0000001'}`,
    'Dom.Parcelario: CALLE DE PRUEBA 100',
    `NC: ${o.identificador ?? '012345678901200'}`,
    'Contribución sobre los Inmuebles',
    'Ref.: 000000001',
    'Fecha Emisión: 2026/11/02',
    'CODIGO DE PAGO ELECTRONICO:',
    '0123456789012345',
    'Año Cuota',
    `${o.year ?? 2026} ${o.cuota ?? 11}`,
    'VENCIMIENTOS:',
    'Opciones Vencimiento Desc. Importe',
    ...venc.map((v) => `Venc. ${v.date} ${v.amount}`),
    'LIQUIDACIÓN',
    'Contribucion sobre inmuebles $10.000,00',
    `Contribución a Pagar ${o.total ?? venc[0].amount}`,
    'Para el Ente Recaudador',
  ];
}

/** Cedulón anterior de la Municipalidad (formulario con tabla de períodos), tal como lo extrae el lector. */
export function muniLegacyLines(o: { identificador?: string; periodo?: string; emision?: string; venc?: string; total?: string } = {}): string[] {
  return [
    'MUNICIPALIDAD DE CORDOBA',
    'Direccion Gral. Rec. Tributarios CONTRIBUCION SOBRE INMUEBLES',
    'CONTRIBUYENTE TITULAR DE PRUEBA',
    'ITEM IDENTIFICACION TRIBUTARIA CUIT NUMERO DE CONTROL',
    `1.01.01.01 ${o.identificador ?? '012345678901200'} 7 20/00000000/0 123456789012`,
    'UBICACION: CALLE DE PRUEBA 100 Base Impon. 1000000,00',
    'PERIODO DEUDA RECARGO DEDUCCION NETO PERIODO DEUDA RECARGO DEDUCCION NETO',
    o.periodo ?? '2026/010',
    '$ 490.00',
    'EMISION',
    o.emision ?? '24/10/2026',
    'VENCIMIENTO',
    o.venc ?? '10/11/2026',
    'TOTAL',
    `$ ${o.total ?? '490.00'}`,
    'PARA EL CONTRIBUYENTE',
  ];
}

export interface RentasFixture {
  cuenta?: string;
  cuota?: string;
  emision?: string;
  vencimiento?: string;
  total?: string;
}

/** Cedulón actual del Impuesto Inmobiliario (formulario F-1010). */
export function rentasCurrentLines(o: RentasFixture = {}): string[] {
  return [
    'CUIT Nombre o Razón social Número de comprobante Fecha de vencimiento',
    `00-00000000-0 TITULAR DE PRUEBA 0000000000000001 ${o.vencimiento ?? '19/11/2026'}`,
    `Fecha de emisión: ${o.emision ?? '10/11/2026'}`,
    'Cedulón F-1010',
    'Rev. 02',
    '| Impuestos provinciales',
    `Número de cuenta ${o.cuenta ?? '110000000001'}`,
    'INMOBILIARIO | CALLE DE PRUEBA 100 X5000ABC CORDOBA - CAPITAL',
    `Cuota ${o.cuota ?? '2026/11'} - Por vencer Importe`,
    'Impuesto Provincial $26.148,38',
    'Código de Pago Electrónico 0640050000000000001',
    'Total de impuestos provinciales',
    `$${o.total ?? '18.303,87'}`,
    'Total a pagar',
    '$18.300,00',
  ];
}

/** Cedulón anterior del Impuesto Inmobiliario ("Mis Impuestos F-1010"). */
export function rentasLegacyLines(o: RentasFixture = {}): string[] {
  return [
    'Fecha de Emisión: 10/11/2026N° de Comprobante: 0000000000000001',
    'F-1010 Rev.00',
    'VENCIMIENTO:',
    'TITULAR DE PRUEBA',
    'TOTAL A PAGAR',
    o.vencimiento ?? '17/11/2026',
    `$${o.total ?? '1.273,60'}.-`,
    'Mis Impuestos',
    'C.U.I.T. 00-00000000-0',
    'Importe Actualizado',
    `${o.cuota ?? '2026/11'} $1.273,63`,
    'Deuda a Vencer $1.273,63.- $1.273,63.-',
    'Código de Pago Electrónico 0640050000000000002 Incluye descuento del 30%',
    `N ${o.cuenta ?? '110000000001'} Total:$1.273,63.-`,
  ];
}

export interface AguasFixture {
  uf?: string;
  total?: string;
  periodo?: string;
  fechaVto?: string;
  venc?: { prefix: string; date: string; amount: string }[];
}

/** Factura de Aguas Cordobesas. */
export function aguasInvoiceLines(o: AguasFixture = {}): string[] {
  const venc = o.venc ?? [
    { prefix: '', date: '12/11/26', amount: '$ 22.238,93' },
    { prefix: '2° ', date: '20/11/26', amount: '$ 22.900,10' },
  ];
  return [
    'B - Código N° 06 AGUAS CORDOBESAS',
    'Factura N°: 00000000000001',
    `Fecha Vto.: ${o.fechaVto ?? '12/11/2026'}`,
    '00 - 0000 - 00000000',
    'UNIDAD DE FACTURACIÓN',
    o.uf ?? '100001',
    'FC 0010 - 00000001',
    'Información de uso interno',
    'Fecha de emisión: 02/11/26 Copia N°:1',
    'NER1-Servicio de Agua No Medido $ 20.000,00',
    `TOTAL $ ${o.total ?? '22.238,93'}`,
    'Conexión N° Medidor Período de consumo',
    'VENCIMIENTOS',
    'Vencimiento próxima factura: 03/12/26',
    'PERÍODO',
    `COMERCIAL ${o.periodo ?? '11/2026'}`,
    'Clave de Pago Banelco 123456 ',
    ...venc.map((v) => `${v.prefix}VENCIMIENTO ${v.date} ${v.amount}`),
  ];
}

/** Resumen de comprobantes vigentes de Aguas Cordobesas (una fila por comprobante). */
export function aguasStatementLines(rows: { num: string; periodo: string; venc: string; amount: string }[], uf = '100001'): string[] {
  return [
    'RESUMEN DE COMPROBANTES VIGENTES',
    `UNIDAD DE FACTURACIÓN: ${uf}`,
    'Cliente: TITULAR DE PRUEBA',
    'Fecha de Consulta: 03/11/2026',
    'Tipo y Nº de comprobante Período Vencimiento Descripción del Servicio Importe Histórico Importe Ajustado PP',
    ...rows.map((r) => `${r.num} ${r.periodo} ${r.venc} Agua (No Medido) $${r.amount} $${r.amount}`),
    'Este resumen no es válido para cobro',
  ];
}

/** Factura de EPEC con las etiquetas del formato público (a ajustar con una boleta real). */
export function epecLines(o: { contrato?: string; total?: string; vto?: string; periodo?: string } = {}): string[] {
  return [
    'EPEC Empresa Provincial de Energía de Córdoba',
    `Contrato: ${o.contrato ?? '1234567'}`,
    'Titular: TITULAR DE PRUEBA',
    `Período: ${o.periodo ?? '01/10/2026 al 31/10/2026'}`,
    'Fecha de emisión: 02/11/2026',
    `Vencimiento: ${o.vto ?? '12/11/2026'}`,
    `Total a pagar $ ${o.total ?? '15.432,10'}`,
  ];
}

/** Factura de Ecogas con las etiquetas del formato público (a ajustar con una boleta real). */
export function ecogasLines(o: { cuenta?: string; total?: string; vto?: string; periodo?: string } = {}): string[] {
  return [
    'Ecogas - Distribuidora de Gas del Centro',
    `N° de cuenta: ${o.cuenta ?? '7654321'}`,
    'Cliente: TITULAR DE PRUEBA',
    `Período: ${o.periodo ?? '09/2026'}`,
    'Fecha de emisión: 02/11/2026',
    `Vencimiento: ${o.vto ?? '12/11/2026'}`,
    `Total a pagar $ ${o.total ?? '8.765,40'}`,
  ];
}

/** Boleta de un proveedor que ningún lector reconoce. */
export function unknownLines(o: { cuenta?: string; total?: string } = {}): string[] {
  return [
    'Servicios de Prueba SA',
    `Cliente N° ${o.cuenta ?? 'ABC-1234'}`,
    'Fecha de emisión: 02/11/2026',
    'Vencimiento: 12/11/2026',
    `Total a pagar $ ${o.total ?? '3.210,00'}`,
  ];
}
