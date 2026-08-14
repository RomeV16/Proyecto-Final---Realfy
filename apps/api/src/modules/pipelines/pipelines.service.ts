import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  CreatePipelineSchema,
  UpdatePipelineSchema,
  CreatePipelineStageSchema,
  UpdatePipelineStageSchema,
  ReorderPipelineStagesSchema,
  PipelineType,
  DEFAULT_PIPELINE_STAGES,
} from '@realfy/shared';

/**
 * Checks if an error is a Zod validation error (K006 pattern — no direct zod import).
 */
function isZodError(err: unknown): err is { errors: any[] } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as any).name === 'ZodError' &&
    'errors' in err
  );
}

@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ─── Seed Defaults ────────────────────────────────────

  /**
   * Seeds default Alquiler and Venta pipelines with their stages for a new tenant.
   * Called during registration — accepts a transaction client.
   */
  async seedDefaults(tenantId: string, tx: any): Promise<void> {
    for (const pipelineType of [PipelineType.Alquiler, PipelineType.Venta]) {
      const stages = DEFAULT_PIPELINE_STAGES[pipelineType];

      const pipeline = await tx.pipeline.create({
        data: {
          tenantId,
          type: pipelineType,
          name: `Pipeline ${pipelineType}`,
          isActive: true,
        },
      });

      for (const stage of stages) {
        await tx.pipelineStage.create({
          data: {
            pipelineId: pipeline.id,
            name: stage.name,
            sortOrder: stage.sortOrder,
            staleDays: stage.staleDays,
            isDefault: stage.isDefault,
          },
        });
      }

      this.logger.log(`Seeded ${pipelineType} pipeline with ${stages.length} stages`, {
        pipelineId: pipeline.id,
        tenantId,
        type: pipelineType,
        stageCount: stages.length,
      });
    }
  }

  // ─── List All Pipelines ───────────────────────────────

  async findAll() {
    const pipelines = await this.prisma.client.pipeline.findMany({
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return pipelines;
  }

  // ─── Get Single Pipeline ──────────────────────────────

  async findOne(id: string) {
    const pipeline = await this.prisma.client.pipeline.findFirst({
      where: { id },
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!pipeline) {
      throw new NotFoundException({
        error: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }

    return pipeline;
  }

  // ─── Create Pipeline ─────────────────────────────────

  async create(data: unknown) {
    let validated: any;
    try {
      validated = CreatePipelineSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid pipeline data',
          details: err.errors,
        });
      }
      throw err;
    }

    const tenantId = this.tenantContext.getTenantId()!;

    try {
      const pipeline = await this.prisma.client.pipeline.create({
        data: {
          tenantId,
          type: validated.type,
          name: validated.name,
        },
        include: {
          stages: { orderBy: { sortOrder: 'asc' } },
        },
      });

      this.logger.log(`Created pipeline`, {
        pipelineId: pipeline.id,
        tenantId,
        type: validated.type,
      });

      return pipeline;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          error: 'PIPELINE_TYPE_EXISTS',
          message: `A pipeline of type ${validated.type} already exists for this tenant`,
        });
      }
      throw err;
    }
  }

  // ─── Update Pipeline ─────────────────────────────────

  async update(id: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdatePipelineSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid pipeline data',
          details: err.errors,
        });
      }
      throw err;
    }

    const existing = await this.prisma.client.pipeline.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }

    const pipeline = await this.prisma.client.pipeline.update({
      where: { id },
      data: validated,
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
      },
    });

    this.logger.log(`Updated pipeline`, {
      pipelineId: pipeline.id,
      fieldsUpdated: Object.keys(validated),
    });

    return pipeline;
  }

  // ─── Delete Pipeline ─────────────────────────────────

  async remove(id: string) {
    const existing = await this.prisma.client.pipeline.findFirst({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        error: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }

    await this.prisma.client.pipeline.delete({
      where: { id },
    });

    this.logger.log(`Deleted pipeline`, {
      pipelineId: id,
    });

    return { deleted: true };
  }

  // ─── Add Stage ────────────────────────────────────────

  async addStage(pipelineId: string, data: unknown) {
    let validated: any;
    try {
      validated = CreatePipelineStageSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid stage data',
          details: err.errors,
        });
      }
      throw err;
    }

    const pipeline = await this.prisma.client.pipeline.findFirst({
      where: { id: pipelineId },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });

    if (!pipeline) {
      throw new NotFoundException({
        error: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }

    // Shift existing stages down to make room for the new sortOrder
    const existingAtOrAfter = pipeline.stages.filter(
      (s: any) => s.sortOrder >= validated.sortOrder,
    );

    if (existingAtOrAfter.length > 0) {
      // Shift stages in reverse order to avoid unique constraint violations
      for (let i = existingAtOrAfter.length - 1; i >= 0; i--) {
        const stage = existingAtOrAfter[i];
        await this.prisma.client.pipelineStage.update({
          where: { id: stage.id },
          data: { sortOrder: stage.sortOrder + 1 },
        });
      }
    }

    const stage = await this.prisma.client.pipelineStage.create({
      data: {
        pipelineId,
        name: validated.name,
        sortOrder: validated.sortOrder,
        staleDays: validated.staleDays ?? null,
        isDefault: validated.isDefault ?? false,
      },
    });

    this.logger.log(`Added stage to pipeline`, {
      stageId: stage.id,
      pipelineId,
      name: validated.name,
      sortOrder: validated.sortOrder,
    });

    return stage;
  }

  // ─── Update Stage ────────────────────────────────────

  async updateStage(pipelineId: string, stageId: string, data: unknown) {
    let validated: any;
    try {
      validated = UpdatePipelineStageSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid stage data',
          details: err.errors,
        });
      }
      throw err;
    }

    const stage = await this.prisma.client.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });

    if (!stage) {
      throw new NotFoundException({
        error: 'STAGE_NOT_FOUND',
        message: 'Pipeline stage not found',
      });
    }

    const updated = await this.prisma.client.pipelineStage.update({
      where: { id: stageId },
      data: validated,
    });

    this.logger.log(`Updated pipeline stage`, {
      stageId,
      pipelineId,
      fieldsUpdated: Object.keys(validated),
    });

    return updated;
  }

  // ─── Remove Stage ────────────────────────────────────

  async removeStage(pipelineId: string, stageId: string) {
    const stage = await this.prisma.client.pipelineStage.findFirst({
      where: { id: stageId, pipelineId },
    });

    if (!stage) {
      throw new NotFoundException({
        error: 'STAGE_NOT_FOUND',
        message: 'Pipeline stage not found',
      });
    }

    await this.prisma.client.pipelineStage.delete({
      where: { id: stageId },
    });

    // Re-compact sort orders after deletion
    const remaining = await this.prisma.client.pipelineStage.findMany({
      where: { pipelineId },
      orderBy: { sortOrder: 'asc' },
    });

    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].sortOrder !== i) {
        await this.prisma.client.pipelineStage.update({
          where: { id: remaining[i].id },
          data: { sortOrder: i },
        });
      }
    }

    this.logger.log(`Removed pipeline stage`, {
      stageId,
      pipelineId,
    });

    return { deleted: true };
  }

  // ─── Reorder Stages ──────────────────────────────────

  async reorderStages(pipelineId: string, data: unknown) {
    let validated: any;
    try {
      validated = ReorderPipelineStagesSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid reorder data',
          details: err.errors,
        });
      }
      throw err;
    }

    const pipeline = await this.prisma.client.pipeline.findFirst({
      where: { id: pipelineId },
      include: { stages: true },
    });

    if (!pipeline) {
      throw new NotFoundException({
        error: 'PIPELINE_NOT_FOUND',
        message: 'Pipeline not found',
      });
    }

    const stageIds: string[] = validated.stageIds;
    const existingIds = new Set(pipeline.stages.map((s: any) => s.id));

    // Validate all provided IDs belong to this pipeline
    for (const sid of stageIds) {
      if (!existingIds.has(sid)) {
        throw new BadRequestException({
          error: 'INVALID_STAGE_ID',
          message: `Stage ${sid} does not belong to pipeline ${pipelineId}`,
        });
      }
    }

    // To avoid unique constraint violations on [pipelineId, sortOrder],
    // first set all to negative offsets, then assign final positions
    for (let i = 0; i < stageIds.length; i++) {
      await this.prisma.client.pipelineStage.update({
        where: { id: stageIds[i] },
        data: { sortOrder: -(i + 1) },
      });
    }

    for (let i = 0; i < stageIds.length; i++) {
      await this.prisma.client.pipelineStage.update({
        where: { id: stageIds[i] },
        data: { sortOrder: i },
      });
    }

    this.logger.log(`Reordered pipeline stages`, {
      pipelineId,
      stageCount: stageIds.length,
    });

    // Return the pipeline with updated stage order
    return this.findOne(pipelineId);
  }
}
