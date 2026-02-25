import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LeadScoringRulesService } from './lead-scoring-rules.service';
import { LeadScoringRulesController } from './lead-scoring-rules.controller';
import { ScoreDecayService } from './score-decay.service';
import { ScoreDecayScheduler } from './score-decay.scheduler';
import { ScoreTriggersService } from './score-triggers.service';
import { ScoreTriggersController } from './score-triggers.controller';
import { LeadScoreDecayRulesService } from './lead-score-decay-rules.service';
import { LeadScoreDecayRulesController } from './lead-score-decay-rules.controller';

@Module({
  imports: [ScheduleModule],
  providers: [
    LeadScoringRulesService,
    ScoreDecayService,
    ScoreDecayScheduler,
    ScoreTriggersService,
    LeadScoreDecayRulesService,
  ],
  controllers: [
    LeadScoringRulesController,
    ScoreTriggersController,
    LeadScoreDecayRulesController,
  ],
  exports: [LeadScoringRulesService, ScoreDecayService, ScoreTriggersService],
})
export class LeadScoringRulesModule {}
