import { Controller, Get, Put, Param, Body } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { Roles } from '../../common/auth/roles.decorator';
import { UserRole } from '@realfy/shared';

@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get('persons/:personId')
  async getScore(@Param('personId') personId: string) {
    return this.scoringService.getScore(personId);
  }

  @Roles(UserRole.Admin, UserRole.Gerente, UserRole.Ventas)
  @Put('persons/:personId')
  async upsertScore(
    @Param('personId') personId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.scoringService.upsertScore(personId, body);
  }
}
