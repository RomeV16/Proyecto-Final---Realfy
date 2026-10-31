import { Module } from '@nestjs/common';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { PropertyOwnershipsService } from './property-ownerships.service';

@Module({
  controllers: [PropertiesController],
  providers: [PropertiesService, PropertyOwnershipsService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
