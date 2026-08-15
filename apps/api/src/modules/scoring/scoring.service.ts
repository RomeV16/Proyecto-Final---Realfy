import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  UpdateScoreConfigSchema,
  UpsertTenantScoreSchema,
} from '@realfy/shared';
import { Decimal } from '@prisma/client/runtime/library';

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
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Get scoring config for current tenant.
   * Creates default config (all weights = 20) if none exists.
   */
  async getConfig() {
    const tenantId = this.tenantContext.getTenantId()!;
    this.logger.log(`Fetching score config for tenant ${tenantId}`);

    let config = await this.prisma.client.tenantScoreConfig.findUnique({
      where: { tenantId },
    });

    if (!config) {
      this.logger.log(`No config found, creating default for tenant ${tenantId}`);
      config = await this.prisma.client.tenantScoreConfig.create({
        data: {
          tenantId,
          guaranteeWeight: 20,
          jobStabilityWeight: 20,
          referencesWeight: 20,
          paymentHistoryWeight: 20,
          manualRatingWeight: 20,
        },
      });
    }

    return config;
  }

  /**
   * Update scoring config for current tenant.
   */
  async updateConfig(data: unknown) {
    const tenantId = this.tenantContext.getTenantId()!;

    let parsed;
    try {
      parsed = UpdateScoreConfigSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid score config data',
          details: err.errors,
        });
      }
      throw err;
    }

    this.logger.log(`Updating score config for tenant ${tenantId}`);

    // Ensure config exists first (upsert pattern)
    await this.getConfig();

    const updated = await this.prisma.client.tenantScoreConfig.update({
      where: { tenantId },
      data: parsed,
    });

    this.logger.log(`Score config updated for tenant ${tenantId}`);
    return updated;
  }

  /**
   * Get score for a specific person in current tenant.
   */
  async getPersonScore(personId: string) {
    const tenantId = this.tenantContext.getTenantId()!;
    this.logger.log(`Fetching score for person ${personId} in tenant ${tenantId}`);

    const score = await this.prisma.client.tenantScore.findUnique({
      where: {
        tenantId_personId: { tenantId, personId },
      },
      include: {
        scoredBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    return score;
  }

  /**
   * Create or update score for a person.
   * totalScore is always server-computed as weighted average.
   */
  async upsertPersonScore(personId: string, data: unknown) {
    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId()!;

    let parsed;
    try {
      parsed = UpsertTenantScoreSchema.parse(data);
    } catch (err) {
      if (isZodError(err)) {
        throw new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Invalid score data',
          details: err.errors,
        });
      }
      throw err;
    }

    // Verify person exists in this tenant
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId, tenantId },
    });
    if (!person) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: `Person ${personId} not found`,
      });
    }

    // Fetch config to compute weighted average
    const config = await this.getConfig();

    const totalWeight =
      config.guaranteeWeight +
      config.jobStabilityWeight +
      config.referencesWeight +
      config.paymentHistoryWeight +
      config.manualRatingWeight;

    let totalScore: number;
    if (totalWeight === 0) {
      totalScore = 0;
    } else {
      totalScore =
        (parsed.guaranteeScore * config.guaranteeWeight +
          parsed.jobStabilityScore * config.jobStabilityWeight +
          parsed.referencesScore * config.referencesWeight +
          parsed.paymentHistoryScore * config.paymentHistoryWeight +
          parsed.manualRating * config.manualRatingWeight) /
        totalWeight;
    }

    // Round to 2 decimal places
    totalScore = Math.round(totalScore * 100) / 100;

    this.logger.log(
      `Upserting score for person ${personId} in tenant ${tenantId} (total: ${totalScore})`,
    );

    const scoreData = {
      guaranteeScore: parsed.guaranteeScore,
      jobStabilityScore: parsed.jobStabilityScore,
      referencesScore: parsed.referencesScore,
      paymentHistoryScore: parsed.paymentHistoryScore,
      manualRating: parsed.manualRating,
      totalScore: new Decimal(totalScore),
      notes: parsed.notes ?? null,
      scoredByUserId: userId,
      scoredAt: new Date(),
    };

    const result = await this.prisma.client.tenantScore.upsert({
      where: {
        tenantId_personId: { tenantId, personId },
      },
      create: {
        tenantId,
        personId,
        ...scoreData,
      },
      update: scoreData,
      include: {
        scoredBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    this.logger.log(`Score upserted for person ${personId} in tenant ${tenantId}`);
    return result;
  }
}
