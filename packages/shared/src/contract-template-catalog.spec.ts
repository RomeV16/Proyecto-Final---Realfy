import {
  isKnownTemplateVariable,
  TEMPLATE_BLOCKS,
  TEMPLATE_LIST_NAMES,
  TEMPLATE_LISTS,
  TEMPLATE_VARIABLE_GROUPS,
} from './contract-template-catalog';
import { renderTemplatePlain, validateTemplate } from './template-blocks';

describe('catálogo de variables de plantillas', () => {
  it('reconoce las variables sueltas, las de persona, las indexadas y los resúmenes de lista', () => {
    for (const name of [
      'contrato.montoEnLetras',
      'propiedad.cuentaRentas',
      'inmobiliaria.matricula',
      'inquilino.dniConPuntos',
      'garante3.nombreCompleto',
      'locador.porcentaje',
      'garantia2.poliza',
      'garantes.cantidad',
      'locadores.lista',
      'inquilinos.2.documento',
      'apoderados.1.poderdante',
    ]) {
      expect(isKnownTemplateVariable(name)).toBe(true);
    }
  });

  it('no reconoce lo que no existe', () => {
    for (const name of ['contrato.inventada', 'inquilino', 'garantes.9.inventado', 'inquilinos.x.nombre', 'xcontrato.monto']) {
      expect(isKnownTemplateVariable(name)).toBe(false);
    }
  });

  it('las variables de los grupos no se repiten', () => {
    const all = TEMPLATE_VARIABLE_GROUPS.flatMap((g) => g.variables);
    expect(new Set(all).size).toBe(all.length);
  });

  it('cada ejemplo de bloque es una plantilla válida para las listas del catálogo', () => {
    for (const block of TEMPLATE_BLOCKS) {
      expect(() => validateTemplate(block.example, { lists: TEMPLATE_LIST_NAMES })).not.toThrow();
    }
    expect(renderTemplatePlain('\\{{texto}}', {})).toBe('{{texto}}');
  });

  it('cada lista tiene campos', () => {
    for (const name of TEMPLATE_LIST_NAMES) expect(TEMPLATE_LISTS[name].length).toBeGreaterThan(0);
  });
});
