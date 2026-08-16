import { Module } from '@nestjs/common';
import { RenditionsController } from './renditions.controller';
import { RenditionsService } from './renditions.service';

@Module({
  controllers: [RenditionsController],
  providers: [RenditionsService],
  exports: [RenditionsService],
})
export class RenditionsModule {}
