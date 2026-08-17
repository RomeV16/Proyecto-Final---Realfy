import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiPrioritiesService } from './ai-priorities.service';
import { ContractClosureMetricsService } from './contract-closure-metrics.service';
import { ContractClosureService } from './contract-closure.service';
import { DailyContextService } from './daily-context.service';
import { LanguageModelClient } from './language-model.client';

@Module({
  controllers: [AiController],
  providers: [
    AiPrioritiesService,
    ContractClosureMetricsService,
    ContractClosureService,
    DailyContextService,
    LanguageModelClient,
  ],
  exports: [
    AiPrioritiesService,
    ContractClosureMetricsService,
    ContractClosureService,
    DailyContextService,
    LanguageModelClient,
  ],
})
export class AiModule {}
