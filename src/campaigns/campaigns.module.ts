import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignQueueService } from './campaign-queue.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SegmentsModule } from '../segments/segments.module';
import { EmailModule } from '../email/email.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PreferenceCenterModule } from '../preference-center/preference-center.module';

@Module({
  imports: [PrismaModule, SegmentsModule, EmailModule, WebhooksModule, PreferenceCenterModule, ScheduleModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignQueueService, CampaignSchedulerService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
