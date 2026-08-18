import { Test, TestingModule } from '@nestjs/testing';
import { AiPrioritiesService } from './ai-priorities.service';
import { DailyContextService } from './daily-context.service';
import { LanguageModelClient, type LanguageModelMessage } from './language-model.client';
import type { DailyContext, DailyContextItem, PriorityKind } from './daily-context';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';
const GENERATED_AT = '2026-08-17T12:00:00.000Z';

/** Los mismos datos que las pruebas buscan en lo que se manda al modelo. */
const PERSONAL_DATA = [
  'Lucía Fernández',
  'Marcos Peralta',
  'Diego Suárez',
  'Av. Rivadavia 4820 3B',
  'Güemes 1120',
  'Salta 233',
];

function item(
  ref: string,
  kind: PriorityKind,
  overrides: Partial<DailyContextItem> = {},
): DailyContextItem {
  return {
    ref,
    kind,
    entityId: `${ref}-id`,
    title: 'Sin título',
    subtitle: null,
    amount: null,
    currency: 'ARS',
    daysOverdue: null,
    daysToDue: null,
    slaHoursOverdue: null,
    unassigned: false,
    ticketPriority: null,
    status: null,
    daysSinceContact: null,
    ...overrides,
  };
}

const ITEMS: DailyContextItem[] = [
  item('C1', 'cobranza', {
    entityId: 'liq-1',
    title: 'Av. Rivadavia 4820 3B',
    subtitle: 'Lucía Fernández · ago 26',
    amount: 480000,
    daysOverdue: 45,
    status: 'Vencida',
  }),
  item('C2', 'cobranza', {
    entityId: 'liq-2',
    title: 'Güemes 1120',
    subtitle: 'Marcos Peralta · ago 26',
    amount: 40000,
    daysOverdue: 0,
    status: 'Enviada',
  }),
  item('R1', 'reclamo', {
    entityId: 'tk-1',
    title: 'Pérdida de agua en el baño',
    subtitle: 'Salta 233',
    slaHoursOverdue: 24,
    unassigned: true,
    ticketPriority: 'Urgente',
    status: 'Abierto',
  }),
  item('L1', 'lead', {
    entityId: 'led-1',
    title: 'Av. Rivadavia 4820 3B',
    subtitle: 'Diego Suárez',
    amount: 300000,
    daysSinceContact: 30,
    status: 'Contactado',
  }),
];

const TOTALS = {
  overdueAmount: 480000,
  pendingAmount: 40000,
  overdueCollections: 1,
  openTickets: 2,
  expiringContracts: 0,
  staleLeads: 1,
};

function context(items: DailyContextItem[] = ITEMS): DailyContext {
  return { generatedAt: GENERATED_AT, totals: TOTALS, items };
}

/** Respuesta válida del modelo con un orden distinto al de las reglas. */
const MODEL_ANSWER = JSON.stringify({
  priorities: [
    { ref: 'R1', urgency: 'alta', reason: 'El reclamo lleva un día fuera de plazo', action: 'Derivar a un plomero' },
    { ref: 'C1', urgency: 'alta', reason: 'La cobranza más grande está vencida', action: 'Llamar para acordar el pago' },
    { ref: 'L1', urgency: 'baja', reason: 'La consulta se enfrió', action: 'Escribir para retomar' },
    { ref: 'C2', urgency: 'baja', reason: 'Todavía no venció', action: 'Confirmar la recepción' },
  ],
});

function buildMocks(items: DailyContextItem[] = ITEMS) {
  const contextService = { build: jest.fn().mockResolvedValue(context(items)) };
  const languageModel = {
    isEnabled: false,
    model: 'MiniMax-M3',
    complete: jest.fn().mockResolvedValue(null),
  };
  return { contextService, languageModel };
}

async function buildService(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AiPrioritiesService,
      { provide: DailyContextService, useValue: mocks.contextService },
      { provide: LanguageModelClient, useValue: mocks.languageModel },
    ],
  }).compile();

  return { module, service: module.get(AiPrioritiesService) };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AiPrioritiesService', () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    await module?.close();
    module = undefined;
    jest.restoreAllMocks();
  });

  describe('sin modelo configurado', () => {
    it('igual devuelve las prioridades, ordenadas por las reglas propias', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(AiPrioritiesService);

      const result = await service.getDailyPriorities(TENANT_ID);

      expect(result.source).toBe('rules');
      expect(result.model).toBeNull();
      expect(result.priorities.map((p) => p.ref)).toEqual(['C1', 'R1', 'C2', 'L1']);
      expect(result.totals).toEqual(TOTALS);
      expect(result.generatedAt).toBe(GENERATED_AT);
    });

    it('no le pide nada al modelo', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));

      await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(mocks.languageModel.complete).not.toHaveBeenCalled();
    });

    it('cada prioridad llega con su motivo, su acción y sus datos locales', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);
      const first = result.priorities[0];

      expect(first).toMatchObject({
        ref: 'C1',
        kind: 'cobranza',
        entityId: 'liq-1',
        title: 'Av. Rivadavia 4820 3B',
        subtitle: 'Lucía Fernández · ago 26',
        urgency: 'alta',
        amount: 480000,
        daysOverdue: 45,
      });
      expect(first.reason).toContain('Vencida hace 45 días');
      expect(first.action.length).toBeGreaterThan(0);
    });

    it('devuelve una lista vacía cuando no hay nada pendiente', async () => {
      const mocks = buildMocks([]);
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(result.priorities).toEqual([]);
      expect(result.source).toBe('rules');
    });
  });

  describe('con modelo configurado', () => {
    function enabledMocks(answer: string | null, model = 'MiniMax-M3') {
      const mocks = buildMocks();
      mocks.languageModel.isEnabled = true;
      mocks.languageModel.complete = jest
        .fn()
        .mockResolvedValue(answer === null ? null : { text: answer, model });
      return mocks;
    }

    it('respeta el orden que propuso el modelo y lo declara', async () => {
      const mocks = enabledMocks(MODEL_ANSWER);
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(result.source).toBe('model');
      expect(result.model).toBe('MiniMax-M3');
      expect(result.priorities.map((p) => p.ref)).toEqual(['R1', 'C1', 'L1', 'C2']);
      expect(result.priorities[0].reason).toBe('El reclamo lleva un día fuera de plazo');
      expect(result.priorities[0].action).toBe('Derivar a un plomero');
    });

    it('repone localmente los nombres que nunca salieron del servidor', async () => {
      const mocks = enabledMocks(MODEL_ANSWER);
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);
      const byRef = new Map(result.priorities.map((p) => [p.ref, p]));

      expect(byRef.get('C1')).toMatchObject({
        entityId: 'liq-1',
        title: 'Av. Rivadavia 4820 3B',
        subtitle: 'Lucía Fernández · ago 26',
      });
      expect(byRef.get('R1')).toMatchObject({
        entityId: 'tk-1',
        title: 'Pérdida de agua en el baño',
        subtitle: 'Salta 233',
      });
      expect(byRef.get('L1')).toMatchObject({ entityId: 'led-1', subtitle: 'Diego Suárez' });
    });

    it('no le manda al modelo ningún dato personal ni identificador interno', async () => {
      const mocks = enabledMocks(MODEL_ANSWER);
      ({ module } = await buildService(mocks));

      await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      const [messages] = mocks.languageModel.complete.mock.calls[0] as [LanguageModelMessage[]];
      const sent = messages.map((m) => m.content).join('\n');

      for (const value of PERSONAL_DATA) {
        expect(sent).not.toContain(value);
      }
      for (const contextItem of ITEMS) {
        expect(sent).not.toContain(contextItem.entityId);
        expect(sent).not.toContain(contextItem.title);
      }
      // Lo que sí viaja son las referencias opacas y los datos objetivos.
      expect(sent).toContain('"ref":"C1"');
      expect(sent).toContain('"diasDeAtraso":45');
    });

    it('pide la respuesta como JSON', async () => {
      const mocks = enabledMocks(MODEL_ANSWER);
      ({ module } = await buildService(mocks));

      await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(mocks.languageModel.complete).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ json: true }),
      );
    });

    it('tolera que la respuesta venga envuelta en un cerco de código', async () => {
      const mocks = enabledMocks(`Acá va el resultado:\n\`\`\`json\n${MODEL_ANSWER}\n\`\`\``);
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(result.source).toBe('model');
      expect(result.priorities[0].ref).toBe('R1');
    });

    it('descarta las referencias que el modelo inventó', async () => {
      const mocks = enabledMocks(
        JSON.stringify({
          priorities: [
            { ref: 'C1', urgency: 'alta', reason: 'Vencida', action: 'Cobrar' },
            { ref: 'Z9', urgency: 'alta', reason: 'Inexistente', action: 'Nada' },
          ],
        }),
      );
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(result.source).toBe('model');
      expect(result.priorities.map((p) => p.ref)).toEqual(['C1']);
    });

    it('no repite una referencia que el modelo devolvió dos veces', async () => {
      const mocks = enabledMocks(
        JSON.stringify({
          priorities: [
            { ref: 'C1', urgency: 'alta', reason: 'Vencida', action: 'Cobrar' },
            { ref: 'C1', urgency: 'baja', reason: 'Repetida', action: 'Nada' },
          ],
        }),
      );
      ({ module } = await buildService(mocks));

      const result = await module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);

      expect(result.priorities.map((p) => p.ref)).toEqual(['C1']);
      expect(result.priorities[0].reason).toBe('Vencida');
    });
  });

  describe('respaldo por reglas', () => {
    async function resolveWith(answer: unknown) {
      const mocks = buildMocks();
      mocks.languageModel.isEnabled = true;
      mocks.languageModel.complete = jest.fn().mockResolvedValue(answer);
      ({ module } = await buildService(mocks));
      return module.get(AiPrioritiesService).getDailyPriorities(TENANT_ID);
    }

    it('cae a las reglas cuando el modelo no responde a tiempo', async () => {
      const result = await resolveWith(null);

      expect(result.source).toBe('rules');
      expect(result.model).toBeNull();
      expect(result.priorities.map((p) => p.ref)).toEqual(['C1', 'R1', 'C2', 'L1']);
    });

    it('cae a las reglas cuando la respuesta no es JSON', async () => {
      const result = await resolveWith({ text: 'No puedo ayudarte con eso.', model: 'MiniMax-M3' });

      expect(result.source).toBe('rules');
      expect(result.priorities.map((p) => p.ref)).toEqual(['C1', 'R1', 'C2', 'L1']);
    });

    it('cae a las reglas cuando la respuesta no valida contra el esquema', async () => {
      const result = await resolveWith({
        text: JSON.stringify({
          priorities: [{ ref: 'C1', urgency: 'urgentísima', reason: '', action: 'Cobrar' }],
        }),
        model: 'MiniMax-M3',
      });

      expect(result.source).toBe('rules');
      expect(result.priorities.map((p) => p.ref)).toEqual(['C1', 'R1', 'C2', 'L1']);
    });

    it('conserva las entradas validas y descarta solo la que no cumple', async () => {
      const result = await resolveWith({
        text: JSON.stringify({
          priorities: [
            { ref: 'R1', urgency: 'alta', reason: 'SLA excedido', action: 'Asignar responsable' },
            { ref: 'C1', urgency: 'urgentisima', reason: 'mora', action: 'Cobrar' },
            { ref: 'C2', urgency: 'media', reason: 'mora reciente', action: 'Llamar' },
          ],
        }),
        model: 'MiniMax-M3',
      });

      expect(result.source).toBe('model');
      expect(result.priorities.map((p) => p.ref)).toEqual(['R1', 'C2']);
    });

    it('recorta un motivo mas largo que el acordado en vez de descartar la entrada', async () => {
      const largo = 'a'.repeat(400);
      const result = await resolveWith({
        text: JSON.stringify({
          priorities: [{ ref: 'C1', urgency: 'alta', reason: largo, action: 'Cobrar' }],
        }),
        model: 'MiniMax-M3',
      });

      expect(result.source).toBe('model');
      expect(result.priorities[0].reason).toHaveLength(240);
    });

    it('cae a las reglas cuando ninguna referencia pertenece al contexto', async () => {
      const result = await resolveWith({
        text: JSON.stringify({
          priorities: [{ ref: 'Z9', urgency: 'alta', reason: 'Inventada', action: 'Nada' }],
        }),
        model: 'MiniMax-M3',
      });

      expect(result.source).toBe('rules');
      expect(result.priorities.map((p) => p.ref)).toEqual(['C1', 'R1', 'C2', 'L1']);
    });
  });

  describe('cache por inmobiliaria', () => {
    it('no recalcula el contexto en la segunda consulta', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(AiPrioritiesService);

      await service.getDailyPriorities(TENANT_ID);
      await service.getDailyPriorities(TENANT_ID);

      expect(mocks.contextService.build).toHaveBeenCalledTimes(1);
    });

    it('recalcula después de descartar lo cacheado', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(AiPrioritiesService);

      await service.getDailyPriorities(TENANT_ID);
      service.bust(TENANT_ID);
      await service.getDailyPriorities(TENANT_ID);

      expect(mocks.contextService.build).toHaveBeenCalledTimes(2);
    });

    it('no mezcla el resultado de dos inmobiliarias', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(AiPrioritiesService);

      await service.getDailyPriorities(TENANT_ID);
      await service.getDailyPriorities('tn000000-0000-0000-0000-000000000002');

      expect(mocks.contextService.build).toHaveBeenCalledTimes(2);
    });
  });
});
