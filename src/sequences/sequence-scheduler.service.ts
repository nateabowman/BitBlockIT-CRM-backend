import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SequencesService } from './sequences.service';

@Injectable()
export class SequenceSchedulerService {
  constructor(private sequencesService: SequencesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async processDueEnrollments() {
    await this.sequencesService.processDueEnrollments();
  }
}
