import { Module } from '@nestjs/common';
import { ActivitiesService } from './activities.service';
import { ActivitiesController } from './activities.controller';
import { LeadScoringRulesModule } from '../lead-scoring-rules/lead-scoring-rules.module';

@Module({
  imports: [LeadScoringRulesModule],
  providers: [ActivitiesService],
  controllers: [ActivitiesController],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
