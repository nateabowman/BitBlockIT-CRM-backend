import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CampaignsService } from './campaigns.service';

@Injectable()
export class CampaignSchedulerService {
  constructor(
    private prisma: PrismaService,
    private campaignsService: CampaignsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduled() {
    const firstUser = await this.prisma.user.findFirst({
      where: { isActive: true },
      select: { id: true },
    });
    if (firstUser) {
      await this.campaignsService.processScheduledCampaigns(firstUser.id);
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async finalizeSending() {
    await this.campaignsService.finalizeSendingCampaigns();
  }
}
