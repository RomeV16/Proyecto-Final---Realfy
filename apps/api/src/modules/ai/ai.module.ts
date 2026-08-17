import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiPrioritiesService } from './ai-priorities.service';
import { DailyContextService } from './daily-context.service';
import { LanguageModelClient } from './language-model.client';

@Module({
  controllers: [AiController],
  providers: [AiPrioritiesService, DailyContextService, LanguageModelClient],
  exports: [AiPrioritiesService, DailyContextService, LanguageModelClient],
})
export class AiModule {}
