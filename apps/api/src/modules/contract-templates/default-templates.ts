/**
 * Default Argentine contract templates with {{variable}} placeholders.
 * Used by seedDefaults() to create starter templates for new tenants.
 *
 * Variable naming follows contract-variable-builder.ts conventions:
 *   contrato.*, propiedad.*, propietario.*, inquilino.*, garante.*,
 *   garantia.*, inmobiliaria.*, fecha.*, comprador.*
 */

export interface DefaultTemplateDefinition {
  name: string;
  contractType: 'Alquiler' | 'AlquilerTemporario' | 'Venta';
  body: string;
}

export const DEFAULT_TEMPLATES: DefaultTemplateDefinition[] = [
  // ─── Contrato de Alquiler ──────────────────────────────
  {
    name: 'Contrato de Alquiler Residencial',
    contractType: 'Alquiler',
    body: `CONTRATO DE LOCACIÓN

En la Ciudad de {{propiedad.ciudad}}, Provincia de {{propiedad.provincia}}, a los {{fecha.hoyLarga}}, entre:

LOCADOR: {{propietario.nombreCompleto}}, CUIT/CUIL {{propietario.cuit}}, con domicilio en la Ciudad de {{propiedad.ciudad}}, en adelante "EL LOCADOR";

LOCATARIO: {{inquilino.nombreCompleto}}, CUIT/CUIL {{inquilino.cuit}}, con domicilio electrónico {{inquilino.email}}, en adelante "EL LOCATARIO";

GARANTE: {{garante.nombreCompleto}}, CUIT/CUIL {{garante.cuit}}, en adelante "EL GARANTE";

Por intermedio de {{inmobiliaria.nombre}}, CUIT {{inmobiliaria.cuit}}, en adelante "LA INMOBILIARIA", convienen en celebrar el presente contrato de locación, sujeto a las siguientes cláusulas:

PRIMERA — OBJETO: El LOCADOR da en locación al LOCATARIO el inmueble sito en {{propiedad.direccionCompleta}}, tipo {{propiedad.tipo}}, con una superficie de {{propiedad.superficie}} m², compuesto por {{propiedad.ambientes}} ambientes, {{propiedad.dormitorios}} dormitorios y {{propiedad.banos}} baños, destinado exclusivamente a vivienda familiar.

SEGUNDA — PLAZO: El plazo de la locación se establece en el período comprendido entre el {{contrato.fechaInicioLarga}} y el {{contrato.fechaFinLarga}}, de conformidad con lo establecido en la Ley 27.551 de Alquileres.

TERCERA — PRECIO: El canon locativo mensual se fija en {{contrato.moneda}} {{contrato.monto}} (pesos argentinos), pagadero por adelantado del 1 al 10 de cada mes. El pago se realizará mediante transferencia bancaria o medio electrónico acordado entre las partes.

CUARTA — AJUSTE: El canon locativo se ajustará con periodicidad {{contrato.periodoAjuste}} según el índice {{contrato.tipoAjuste}}, conforme lo establecido por la normativa vigente.

QUINTA — DEPÓSITO EN GARANTÍA: El LOCATARIO deposita en este acto la suma de {{contrato.moneda}} {{contrato.deposito}} en concepto de depósito de garantía, el cual será reintegrado al finalizar el contrato, actualizado por el mismo índice de ajuste del canon locativo.

SEXTA — GARANTÍA: {{garante.nombreCompleto}} se constituye en fiador solidario, liso y llano y principal pagador de todas las obligaciones emergentes del presente contrato. Garantía adicional: {{garantia.tipo}} — {{garantia.descripcion}}.

SÉPTIMA — OBLIGACIONES DEL LOCATARIO: El LOCATARIO se obliga a: a) Destinar el inmueble exclusivamente al uso convenido; b) Mantener el inmueble en buen estado de conservación; c) Permitir el acceso al LOCADOR previa notificación con 24 horas de anticipación; d) Abonar los servicios y expensas ordinarias correspondientes.

OCTAVA — OBLIGACIONES DEL LOCADOR: El LOCADOR se obliga a: a) Entregar el inmueble en condiciones adecuadas de habitabilidad; b) Mantener el inmueble en estado apropiado; c) Realizar las reparaciones que no sean locativas a su cargo.

NOVENA — RESCISIÓN ANTICIPADA: El LOCATARIO podrá rescindir anticipadamente el contrato conforme lo establecido en la legislación vigente, notificando fehacientemente con un mínimo de treinta (30) días de anticipación.

DÉCIMA — CLÁUSULAS ADICIONALES: {{contrato.notas}}

En prueba de conformidad se firman tres (3) ejemplares de un mismo tenor y a un solo efecto.


________________________          ________________________          ________________________
     EL LOCADOR                      EL LOCATARIO                     EL GARANTE
{{propietario.nombreCompleto}}    {{inquilino.nombreCompleto}}       {{garante.nombreCompleto}}

Intermediario: {{inmobiliaria.nombre}} — CUIT {{inmobiliaria.cuit}}`,
  },

  // ─── Contrato de Alquiler Temporario ──────────────────
  {
    name: 'Contrato de Alquiler Temporario',
    contractType: 'AlquilerTemporario',
    body: `CONTRATO DE LOCACIÓN TEMPORARIA

En la Ciudad de {{propiedad.ciudad}}, Provincia de {{propiedad.provincia}}, a los {{fecha.hoyLarga}}, entre:

LOCADOR: {{propietario.nombreCompleto}}, CUIT/CUIL {{propietario.cuit}}, en adelante "EL LOCADOR";

LOCATARIO TEMPORARIO: {{inquilino.nombreCompleto}}, correo electrónico {{inquilino.email}}, teléfono {{inquilino.telefono}}, en adelante "EL LOCATARIO";

Por intermedio de {{inmobiliaria.nombre}}, CUIT {{inmobiliaria.cuit}}, se celebra el presente contrato de locación con destino temporario, conforme al artículo 1199 del Código Civil y Comercial de la Nación:

PRIMERA — OBJETO: El LOCADOR cede en locación temporaria el inmueble sito en {{propiedad.direccionCompleta}}, tipo {{propiedad.tipo}}, de {{propiedad.superficie}} m², con {{propiedad.ambientes}} ambientes, {{propiedad.dormitorios}} dormitorios y {{propiedad.banos}} baños. El inmueble se entrega amoblado y equipado según inventario anexo.

SEGUNDA — DESTINO: El inmueble se destina exclusivamente a uso habitacional temporario (turismo, estadía laboral transitoria u otro uso temporario lícito).

TERCERA — PLAZO: La locación temporaria se pacta desde el {{contrato.fechaInicioLarga}} hasta el {{contrato.fechaFinLarga}}. No será de aplicación la prórroga automática prevista para contratos de locación habitacional permanente.

CUARTA — PRECIO Y PAGO: El precio total de la locación temporaria se fija en {{contrato.moneda}} {{contrato.monto}} mensuales. El pago se realizará por adelantado al inicio de cada período mensual.

QUINTA — DEPÓSITO: Se deposita la suma de {{contrato.moneda}} {{contrato.deposito}} en concepto de seña y garantía, reintegrable al finalizar el contrato previa verificación del estado del inmueble y sus contenidos.

SEXTA — SERVICIOS: Los servicios públicos (agua, luz, gas, internet) se encuentran incluidos en el precio de la locación, salvo consumos extraordinarios.

SÉPTIMA — INVENTARIO: Las partes suscriben un inventario detallado del mobiliario y equipamiento del inmueble al momento de la entrega, el cual forma parte integrante del presente contrato.

OCTAVA — RESCISIÓN: En caso de rescisión anticipada por parte del LOCATARIO, se perderá el depósito de garantía. El LOCADOR podrá rescindir con causa ante incumplimiento de las obligaciones del LOCATARIO.

NOVENA — OBSERVACIONES: {{contrato.notas}}

En prueba de conformidad se firman dos (2) ejemplares de un mismo tenor.


________________________          ________________________
     EL LOCADOR                      EL LOCATARIO
{{propietario.nombreCompleto}}    {{inquilino.nombreCompleto}}

Intermediario: {{inmobiliaria.nombre}}`,
  },

  // ─── Boleto de Compraventa ────────────────────────────
  {
    name: 'Boleto de Compraventa',
    contractType: 'Venta',
    body: `BOLETO DE COMPRAVENTA

En la Ciudad de {{propiedad.ciudad}}, Provincia de {{propiedad.provincia}}, a los {{fecha.hoyLarga}}, entre:

VENDEDOR: {{propietario.nombreCompleto}}, CUIT/CUIL {{propietario.cuit}}, con domicilio en la Ciudad de {{propiedad.ciudad}}, en adelante "EL VENDEDOR";

COMPRADOR: {{comprador.nombreCompleto}}, CUIT/CUIL {{comprador.cuit}}, correo electrónico {{comprador.email}}, en adelante "EL COMPRADOR";

Por intermedio de {{inmobiliaria.nombre}}, CUIT {{inmobiliaria.cuit}}, convienen en celebrar el presente boleto de compraventa inmobiliaria:

PRIMERA — OBJETO: EL VENDEDOR vende y EL COMPRADOR compra el inmueble sito en {{propiedad.direccionCompleta}}, tipo {{propiedad.tipo}}, con una superficie de {{propiedad.superficie}} m², inscripto en el Registro de la Propiedad bajo los datos que se consignan en la escritura respectiva.

SEGUNDA — PRECIO: El precio total de la compraventa se fija en {{contrato.moneda}} {{contrato.monto}}, pagadero de la siguiente forma:
  a) Seña: {{contrato.moneda}} {{contrato.deposito}} abonados en este acto, sirviendo el presente de suficiente recibo.
  b) Saldo: a abonar al momento de la escrituración definitiva.

TERCERA — PLAZO PARA ESCRITURAR: Las partes se comprometen a otorgar la escritura traslativa de dominio dentro del período comprendido entre el {{contrato.fechaInicioLarga}} y el {{contrato.fechaFinLarga}}, ante el escribano que designe EL COMPRADOR.

CUARTA — ESTADO DEL INMUEBLE: EL VENDEDOR declara que el inmueble se encuentra libre de todo gravamen, embargo, inhibición y/u ocupantes, y se compromete a entregar la posesión al momento de la escrituración.

QUINTA — GASTOS: Los gastos de escrituración serán soportados conforme a los usos y costumbres de la jurisdicción, salvo acuerdo en contrario entre las partes.

SEXTA — SEÑA: La suma entregada en concepto de seña tiene el carácter de seña confirmatoria y principio de ejecución del contrato, conforme al artículo 1059 del Código Civil y Comercial de la Nación.

SÉPTIMA — INCUMPLIMIENTO: En caso de incumplimiento de cualquiera de las partes, la parte cumplidora podrá optar entre exigir el cumplimiento del contrato o resolverlo, con más los daños y perjuicios correspondientes.

OCTAVA — COMISIÓN INMOBILIARIA: Las partes reconocen la intervención de {{inmobiliaria.nombre}} y se comprometen al pago de la comisión profesional conforme a las regulaciones vigentes.

NOVENA — OBSERVACIONES: {{contrato.notas}}

En prueba de conformidad se firman tres (3) ejemplares de un mismo tenor y a un solo efecto.


________________________          ________________________
     EL VENDEDOR                     EL COMPRADOR
{{propietario.nombreCompleto}}    {{comprador.nombreCompleto}}

Intermediario: {{inmobiliaria.nombre}} — CUIT {{inmobiliaria.cuit}}`,
  },
];
