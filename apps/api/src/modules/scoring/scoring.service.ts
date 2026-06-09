import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { z } from 'zod';

const UpsertScoreSchema = z.object({
  guaranteeScore: z.coerce.number().int().min(0).max(10),
  jobStabilityScore: z.coerce.number().int().min(0).max(10),
  referencesScore: z.coerce.number().int().min(0).max(10),
  paymentHistoryScore: z.coerce.number().int().min(0).max(10),
  manualRating: z.coerce.number().int().min(0).max(10),
  notes: z.string().max(2000).optional().nullable(),
});

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getScore(personId: string) {
    const score = await this.prisma.client.tenantScore.findFirst({
      where: { personId },
      include: {
        scoredBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!score) {
      throw new NotFoundException({
        error: 'SCORE_NOT_FOUND',
        message: 'No score found for this person',
      });
    }

    return score;
  }

  async upsertScore(personId: string, data: unknown) {
    let validated: z.infer<typeof UpsertScoreSchema>;
    try {
      validated = UpsertScoreSchema.parse(data);
    } catch (err: any) {
      throw new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: 'Invalid score data',
        details: err.errors ?? [],
      });
    }

    const person = await this.prisma.client.person.findFirst({
      where: { id: personId },
    });
    if (!person) {
      throw new NotFoundException({
        error: 'PERSON_NOT_FOUND',
        message: 'Person not found',
      });
    }

    const tenantId = this.tenantContext.getTenantId()!;
    const userId = this.tenantContext.getUserId() ?? null;

    const total =
      (validated.guaranteeScore +
        validated.jobStabilityScore +
        validated.referencesScore +
        validated.paymentHistoryScore +
        validated.manualRating) /
      5;

    const score = await this.prisma.client.tenantScore.upsert({
      where: { personId },
      create: {
        personId,
        tenantId,
        guaranteeScore: validated.guaranteeScore,
        jobStabilityScore: validated.jobStabilityScore,
        referencesScore: validated.referencesScore,
        paymentHistoryScore: validated.paymentHistoryScore,
        manualRating: validated.manualRating,
        totalScore: total,
        notes: validated.notes ?? null,
        scoredByUserId: userId,
        scoredAt: new Date(),
      },
      update: {
        guaranteeScore: validated.guaranteeScore,
        jobStabilityScore: validated.jobStabilityScore,
        referencesScore: validated.referencesScore,
        paymentHistoryScore: validated.paymentHistoryScore,
        manualRating: validated.manualRating,
        totalScore: total,
        notes: validated.notes ?? null,
        scoredByUserId: userId,
        scoredAt: new Date(),
      },
      include: {
        scoredBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    this.logger.log(
      `Score upserted: personId=${personId} total=${total} userId=${userId}`,
    );

    return score;
  }
}
