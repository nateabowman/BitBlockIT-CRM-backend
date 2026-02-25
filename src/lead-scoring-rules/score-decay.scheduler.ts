import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScoreDecayService } from './score-decay.service';

@Injectable()
export class ScoreDecayScheduler {
  constructor(private scoreDecay: ScoreDecayService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDecay() {
    const result = await this.scoreDecay.applyDecay();
    if (result.updated > 0) {
      console.log(`Score decay: ${result.updated} leads updated`);
    }
  }
}
