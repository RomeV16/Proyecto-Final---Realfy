import { Module } from '@nestjs/common';
import { ValuationsController } from './valuations.controller';
import { ValuationsService } from './valuations.service';

@Module({
  controllers: [ValuationsController],
  providers: [ValuationsService],
  exports: [ValuationsService],
})
export class ValuationsModule {}
