import { Module } from '@nestjs/common';
import { ActivityTypesService } from './activity-types.service';
import { ActivityTypesController } from './activity-types.controller';

@Module({
  providers: [ActivityTypesService],
  controllers: [ActivityTypesController],
  exports: [ActivityTypesService],
})
export class ActivityTypesModule {}
