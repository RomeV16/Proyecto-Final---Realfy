import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { ContractClosureMetrics } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractClosureMetricsService } from './contract-closure-metrics.service';
import { ContractClosureService } from './contract-closure.service';
import { toClosureFacts } from './contract-closure';
import { renderClosureSummary } from './closure-summary-template';
import { LanguageModelClient, type LanguageModelMessage } from './language-model.client';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'tn000000-0000-0000-0000-000000000001';
const CONTRACT_ID = 'con-1';

const METRICS: ContractClosureMetrics = {
  contractType: 'Alquiler',
  closureStatus: 'Rescindido',
  startDate: '2024-03-01T12:00:00.000Z',
  endDate: '2026-03-01T12:00:00.000Z',
  closedOn: '2025-12-01T12:00:00.000Z',
  durationDays: 640,
  durationMonths: 21,
  endedEarly: true,
  currency: 'ARS',

  billedCount: 5,
  paidCount: 4,
  onTimeCount: 2,
  lateCount: 2,
  unpaidCount: 1,
  onTimeRate: 50,
  averageDelayDays: 14,
  maxDelayDays: 22,
  billedAmount: 1170000,
  collectedAmount: 850000,
  outstandingAmount: 320000,

  penaltyCount: 2,
  penaltyAmount: 24000,
  penaltyWaivedCount: 1,

  ticketCount: 4,
  ticketsResolved: 2,
  ticketsCancelled: 1,
  ticketsOpen: 1,
  averageResolutionDays: 4,
  ticketCostAmount: 42000,

  adjustmentCount: 2,
  firstRent: 180000,
  lastRent: 320000,
  rentIncreasePct: 77.8,

  rendicionCount: 2,
  rendicionNetAmount: 310000,
};

const FACTS = toClosureFacts(METRICS);
const TEMPLATE_TEXT = renderClosureSummary(FACTS);

/** Redacción válida: prosa distinta a la de la plantilla, con las mismas cifras. */
const MODEL_ANSWER = JSON.stringify({
  summary: [
    'El contrato se sostuvo 21 meses y se cortó antes de lo pactado, en estado Rescindido.',
    '',
    'La cobranza fue trabajosa: de 5 liquidaciones se cobraron 4, con 2 pagos en término y 2 con atraso, un promedio de 14 días y un pico de 22. Quedó deuda por $ 320.000 y se aplicaron 2 punitorios por $ 24.000.',
    '',
    'La propiedad pidió atención: entraron 4 reclamos y se resolvieron 2, en 4 días promedio. El alquiler se ajustó 2 veces y cerró en $ 320.000.',
  ].join('\n'),
  highlights: [
    'Cierre anticipado a los 21 meses',
    'Puntualidad del 50 % sobre 4 cobranzas',
    'Deuda al cierre de $ 320.000',
  ],
});

/** Redacción con una cifra que el modelo sacó de su propia cuenta. */
const MODEL_ANSWER_WITH_INVENTED_FIGURE = JSON.stringify({
  summary:
    'El contrato duró 21 meses y se cobró el 73 % de lo facturado, con un atraso promedio de 14 días. La gestión de cobranza fue constante durante toda la vigencia del contrato.',
  highlights: ['Se cobró el 73 % de lo facturado', 'Cierre anticipado a los 21 meses'],
});

function buildMocks() {
  const prisma = {
    client: {
      contract: {
        findFirst: jest.fn().mockResolvedValue({
          id: CONTRACT_ID,
          status: 'Rescindido',
          closureSummary: null,
        }),
      },
      contractClosureSummary: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };
  const metrics = { compute: jest.fn().mockResolvedValue(METRICS) };
  const languageModel = {
    isEnabled: false,
    model: 'MiniMax-M3',
    complete: jest.fn().mockResolvedValue(null),
  };
  return { prisma, metrics, languageModel };
}

async function buildService(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ContractClosureService,
      { provide: PrismaService, useValue: mocks.prisma },
      { provide: ContractClosureMetricsService, useValue: mocks.metrics },
      { provide: LanguageModelClient, useValue: mocks.languageModel },
    ],
  }).compile();

  return { module, service: module.get(ContractClosureService) };
}

/** Lo que efectivamente se le mandó al modelo, ya parseado. */
function factsSentToModel(complete: jest.Mock): Record<string, unknown> {
  const messages = complete.mock.calls[0][0] as LanguageModelMessage[];
  const userPrompt = messages.find((m) => m.role === 'user')!.content;
  const start = userPrompt.indexOf('{');
  const end = userPrompt.indexOf('}\n');
  return JSON.parse(userPrompt.slice(start, end + 1));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContractClosureService', () => {
  let module: TestingModule | undefined;

  afterEach(async () => {
    await module?.close();
    module = undefined;
  });

  describe('sin modelo configurado', () => {
    it('igual genera el resumen, redactado por las plantillas propias', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.generate(TENANT_ID, CONTRACT_ID);

      expect(result.closed).toBe(true);
      expect(result.summary).not.toBeNull();
      expect(result.summary!.source).toBe('rules');
      expect(result.summary!.model).toBeNull();
      expect(result.summary!.summary).toBe(TEMPLATE_TEXT.summary);
      expect(result.summary!.highlights).toEqual(TEMPLATE_TEXT.highlights);
      expect(mocks.languageModel.complete).not.toHaveBeenCalled();
    });

    it('guarda el resumen junto a las metricas que lo respaldan', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.generate(TENANT_ID, CONTRACT_ID);

      expect(mocks.prisma.client.contractClosureSummary.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          contractId: CONTRACT_ID,
          source: 'rules',
          model: null,
          metrics: METRICS,
          summary: TEMPLATE_TEXT.summary,
        }),
      });
    });

    it('regenerar reemplaza el resumen vigente en lugar de acumular otro', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.contractClosureSummary.findFirst.mockResolvedValue({ id: 'sum-1' });
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.generate(TENANT_ID, CONTRACT_ID);

      expect(mocks.prisma.client.contractClosureSummary.create).not.toHaveBeenCalled();
      expect(mocks.prisma.client.contractClosureSummary.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sum-1' } }),
      );
    });
  });

  describe('con modelo configurado', () => {
    function withModel(answer: string | null) {
      const mocks = buildMocks();
      mocks.languageModel.isEnabled = true;
      mocks.languageModel.complete.mockResolvedValue(
        answer === null ? null : { text: answer, model: 'MiniMax-M3' },
      );
      return mocks;
    }

    it('publica la redaccion del modelo cuando cumple el esquema', async () => {
      const mocks = withModel(MODEL_ANSWER);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.generate(TENANT_ID, CONTRACT_ID);

      expect(result.summary!.source).toBe('model');
      expect(result.summary!.model).toBe('MiniMax-M3');
      expect(result.summary!.summary).toContain('El contrato se sostuvo 21 meses');
      expect(result.summary!.highlights).toHaveLength(3);
    });

    it('las dos redacciones parten de las mismas metricas', async () => {
      const mocks = withModel(MODEL_ANSWER);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const fromModel = await service.generate(TENANT_ID, CONTRACT_ID);

      const mocksWithoutModel = buildMocks();
      const withoutModel = await buildService(mocksWithoutModel);
      const fromRules = await withoutModel.service.generate(TENANT_ID, CONTRACT_ID);
      await withoutModel.module.close();

      expect(fromModel.summary!.metrics).toEqual(fromRules.summary!.metrics);
      expect(fromModel.summary!.metrics).toEqual(METRICS);
      expect(fromModel.summary!.summary).not.toBe(fromRules.summary!.summary);
    });

    it('no le manda ningun dato personal ni identificador interno', async () => {
      const mocks = withModel(MODEL_ANSWER);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.generate(TENANT_ID, CONTRACT_ID);

      const sent = JSON.stringify(mocks.languageModel.complete.mock.calls[0]);
      for (const value of [TENANT_ID, CONTRACT_ID, 'con-1', 'prop-1']) {
        expect(sent).not.toContain(value);
      }
    });

    it('le manda unicamente los campos de la whitelist de hechos', async () => {
      const mocks = withModel(MODEL_ANSWER);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.generate(TENANT_ID, CONTRACT_ID);

      expect(factsSentToModel(mocks.languageModel.complete)).toEqual(FACTS);
    });

    it('cae al respaldo si el modelo no responde', async () => {
      const mocks = withModel(null);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.generate(TENANT_ID, CONTRACT_ID);

      expect(result.summary!.source).toBe('rules');
      expect(result.summary!.summary).toBe(TEMPLATE_TEXT.summary);
    });

    it('cae al respaldo si la respuesta no trae un objeto JSON', async () => {
      const mocks = withModel('Acá va el resumen, pero sin JSON.');
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.generate(TENANT_ID, CONTRACT_ID);

      expect(result.summary!.source).toBe('rules');
    });

    it('cae al respaldo si la respuesta no cumple el esquema', async () => {
      const mocks = withModel(JSON.stringify({ summary: 'Muy corto', highlights: [] }));
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.generate(TENANT_ID, CONTRACT_ID);

      expect(result.summary!.source).toBe('rules');
      expect(result.summary!.summary).toBe(TEMPLATE_TEXT.summary);
    });

    it('cae al respaldo si el modelo cita una cifra que no calculo el sistema', async () => {
      const mocks = withModel(MODEL_ANSWER_WITH_INVENTED_FIGURE);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.generate(TENANT_ID, CONTRACT_ID);

      expect(result.summary!.source).toBe('rules');
      expect(result.summary!.summary).not.toContain('73');
    });
  });

  describe('generate', () => {
    it('rechaza un contrato que todavia no cerro', async () => {
      const mocks = buildMocks();
      mocks.metrics.compute.mockResolvedValue({ ...METRICS, closureStatus: 'Activo' });
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await expect(service.generate(TENANT_ID, CONTRACT_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(mocks.prisma.client.contractClosureSummary.create).not.toHaveBeenCalled();
    });

    it('rechaza un contrato que no existe en la inmobiliaria en sesion', async () => {
      const mocks = buildMocks();
      mocks.metrics.compute.mockResolvedValue(null);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await expect(service.generate(TENANT_ID, CONTRACT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generateOnClosure', () => {
    it('no lanza cuando la generacion falla, asi el cierre no queda trabado', async () => {
      const mocks = buildMocks();
      mocks.metrics.compute.mockRejectedValue(new Error('la base no responde'));
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await expect(service.generateOnClosure(TENANT_ID, CONTRACT_ID)).resolves.toBeUndefined();
    });

    it('no lanza sobre un contrato que no esta cerrado', async () => {
      const mocks = buildMocks();
      mocks.metrics.compute.mockResolvedValue({ ...METRICS, closureStatus: 'Activo' });
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await expect(service.generateOnClosure(TENANT_ID, CONTRACT_ID)).resolves.toBeUndefined();
    });

    it('genera y guarda el resumen cuando el contrato cerro', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.generateOnClosure(TENANT_ID, CONTRACT_ID);

      expect(mocks.prisma.client.contractClosureSummary.create).toHaveBeenCalled();
    });
  });

  describe('get', () => {
    const STORED = {
      summary: 'Resumen guardado del contrato.',
      highlights: ['Un punto', 'Otro punto'],
      metrics: METRICS,
      source: 'model' as const,
      model: 'MiniMax-M3',
      generatedAt: new Date('2026-08-17T18:00:00.000Z'),
    };

    it('devuelve el resumen guardado sin volver a redactarlo', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.contract.findFirst.mockResolvedValue({
        id: CONTRACT_ID,
        status: 'Rescindido',
        closureSummary: STORED,
      });
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.get(TENANT_ID, CONTRACT_ID);

      expect(result.closed).toBe(true);
      expect(result.summary!.summary).toBe(STORED.summary);
      expect(result.summary!.source).toBe('model');
      expect(result.summary!.generatedAt).toBe('2026-08-17T18:00:00.000Z');
      expect(mocks.metrics.compute).not.toHaveBeenCalled();
      expect(mocks.languageModel.complete).not.toHaveBeenCalled();
    });

    it('avisa que el contrato sigue abierto y todavia no hay resumen', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.contract.findFirst.mockResolvedValue({
        id: CONTRACT_ID,
        status: 'Activo',
        closureSummary: null,
      });
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.get(TENANT_ID, CONTRACT_ID);

      expect(result.closed).toBe(false);
      expect(result.summary).toBeNull();
    });

    it('descarta un resumen guardado cuyas metricas ya no validan', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.contract.findFirst.mockResolvedValue({
        id: CONTRACT_ID,
        status: 'Rescindido',
        closureSummary: { ...STORED, metrics: { onTimeRate: 'no es un numero' } },
      });
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      const result = await service.get(TENANT_ID, CONTRACT_ID);

      expect(result.summary).toBeNull();
    });

    it('no vuelve a la base en cada pintada de la ficha', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.get(TENANT_ID, CONTRACT_ID);
      await service.get(TENANT_ID, CONTRACT_ID);

      expect(mocks.prisma.client.contract.findFirst).toHaveBeenCalledTimes(1);
    });

    it('regenerar invalida lo cacheado', async () => {
      const mocks = buildMocks();
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await service.get(TENANT_ID, CONTRACT_ID);
      await service.generate(TENANT_ID, CONTRACT_ID);
      await service.get(TENANT_ID, CONTRACT_ID);

      expect(mocks.prisma.client.contract.findFirst).toHaveBeenCalledTimes(2);
    });

    it('rechaza un contrato que no existe en la inmobiliaria en sesion', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.contract.findFirst.mockResolvedValue(null);
      ({ module } = await buildService(mocks));
      const service = module.get(ContractClosureService);

      await expect(service.get(TENANT_ID, CONTRACT_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
