import { Prisma } from '@prisma/client';
import { MERGE_MODELS, MERGE_RULES } from './person-merge.config';

/**
 * Cada relación del esquema que apunta a Person tiene que estar tratada por la
 * unión de personas. Si se agrega una tabla con clave a Person y no se suma a
 * la configuración, las filas quedarían apuntando a una persona dada de baja.
 */
describe('configuración de la unión de personas', () => {
  const models = Prisma.dmmf.datamodel.models;

  it('trata cada campo del esquema que referencia a Person', () => {
    const inSchema: string[] = [];
    for (const model of models) {
      for (const f of model.fields) {
        if (f.kind === 'object' && f.type === 'Person' && f.relationFromFields?.length) {
          inSchema.push(`${model.name}.${f.relationFromFields[0]}`);
        }
      }
    }
    const handled = MERGE_RULES.filter((r) => !(r.delegate === 'personRoleAssignment' && r.field === 'guarantorForPersonId')).map(
      (r) => `${MERGE_MODELS[r.delegate]}.${r.field}`,
    );
    expect([...new Set(handled)].sort()).toEqual([...new Set(inSchema)].sort());
  });

  it('cada regla apunta a un modelo y a un campo que existen', () => {
    for (const rule of MERGE_RULES) {
      const model = models.find((m) => m.name === MERGE_MODELS[rule.delegate]);
      expect(model).toBeDefined();
      const names = model!.fields.map((f) => f.name);
      expect(names).toContain(rule.field);
      if (rule.kind !== 'repoint') for (const s of rule.scope) expect(names).toContain(s);
    }
  });

  it('las claves únicas que incluyen a la persona tienen regla dedupe o conflict', () => {
    for (const model of models) {
      const rules = MERGE_RULES.filter((r) => MERGE_MODELS[r.delegate] === model.name);
      for (const f of model.fields) {
        if (f.kind !== 'scalar' || !f.isUnique) continue;
        const refersToPerson = model.fields.some(
          (o) => o.kind === 'object' && o.type === 'Person' && o.relationFromFields?.includes(f.name),
        );
        if (refersToPerson) expect(rules.some((r) => r.kind === 'conflict' && r.field === f.name)).toBe(true);
      }
      for (const u of model.uniqueIndexes) {
        const personField = model.fields.find(
          (o) => o.kind === 'object' && o.type === 'Person' && o.relationFromFields?.some((n) => u.fields.includes(n)),
        );
        if (!personField) continue;
        const rule = rules.find((r) => r.field === personField.relationFromFields![0]);
        expect(rule && rule.kind !== 'repoint').toBe(true);
      }
    }
  });
});
