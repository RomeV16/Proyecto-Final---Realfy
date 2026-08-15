import {
  Controller,
  Get,
  Patch,
  Put,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('scoring')
@Roles(UserRole.Admin, UserRole.Gerente)
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  /**
   * GET /scoring/config — Get scoring config (weights) for current tenant.
   */
  @Get('config')
  async getConfig() {
    return this.scoringService.getConfig();
  }

  /**
   * PATCH /scoring/config — Update scoring config (weights).
   */
  @Patch('config')
  async updateConfig(@Body() body: Record<string, any>) {
    return this.scoringService.updateConfig(body);
  }

  /**
   * GET /scoring/persons/:personId — Get score for a specific person.
   */
  @Get('persons/:personId')
  async getPersonScore(@Param('personId') personId: string) {
    const score = await this.scoringService.getPersonScore(personId);
    if (!score) {
      throw new NotFoundException({
        error: 'SCORE_NOT_FOUND',
        message: `No score found for person ${personId}`,
      });
    }
    return score;
  }

  /**
   * PUT /scoring/persons/:personId — Create or update score for a person.
   */
  @Put('persons/:personId')
  async upsertPersonScore(
    @Param('personId') personId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.scoringService.upsertPersonScore(personId, body);
  }
}
