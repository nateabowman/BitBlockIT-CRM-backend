import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SequencesService } from './sequences.service';
import { SequencesController } from './sequences.controller';
import { SequenceSchedulerService } from './sequence-scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule, ScheduleModule],
  controllers: [SequencesController],
  providers: [SequencesService, SequenceSchedulerService],
  exports: [SequencesService],
})
export class SequencesModule {}
