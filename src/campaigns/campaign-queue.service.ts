import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { PreferenceCenterService } from '../preference-center/preference-center.service';

const QUEUE_NAME = 'campaign-send';
const DEFAULT_CONCURRENCY = 5;

export interface CampaignSendJobData {
  campaignSendId: string;
  /** User who triggered the send (for activity log) */
  userId: string;
}

const getConnection = (redisUrl: string) => {
  try {
    const u = new URL(redisUrl);
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 6379,
      password: u.password || undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
};

@Injectable()
export class CampaignQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private worker!: Worker;
  private redisUrl: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private emailService: EmailService,
    private preferenceCenter: PreferenceCenterService,
  ) {
    this.redisUrl = this.config.get('REDIS_URL', 'redis://localhost:6379');
  }

  onModuleInit() {
    const connection = getConnection(this.redisUrl);
    const throttlePerMinute = this.config.get('EMAIL_THROTTLE_PER_MINUTE');
    const limiter = throttlePerMinute ? { max: Number(throttlePerMinute), duration: 60_000 } : undefined;
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    });
    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<CampaignSendJobData>) => this.processJob(job),
      {
        connection,
        concurrency: DEFAULT_CONCURRENCY,
        ...(limiter && { limiter }),
      },
    );
    this.worker.on('failed', (job, err) => {
      console.error(`Campaign send job ${job?.id} failed:`, err?.message);
      const campaignSendId = job?.data?.campaignSendId;
      if (campaignSendId) {
        this.prisma.campaignSend
          .update({
            where: { id: campaignSendId },
            data: {
              failedAt: new Date(),
              lastError: err?.message ?? 'Unknown error',
            },
          })
          .catch((e) => console.error('Failed to update CampaignSend failedAt/lastError:', e));
      }
    });
  }

  async onModuleDestroy() {
    await this.worker.close();
    await this.queue.close();
  }

  async addSendJob(data: CampaignSendJobData) {
    await this.queue.add('send', data as object);
  }

  async addSendJobs(data: CampaignSendJobData[]) {
    if (data.length === 0) return;
    await this.queue.addBulk(data.map((d) => ({ name: 'send', data: d as object })));
  }

  private async processJob(job: Job<CampaignSendJobData, void>) {
    const { campaignSendId, userId } = job.data;
    const send = await this.prisma.campaignSend.findUnique({
      where: { id: campaignSendId },
      include: {
        campaign: {
          include: {
            template: true,
          },
        },
        lead: {
          include: {
            organization: true,
            primaryContact: true,
            assignedTo: { select: { id: true, name: true, email: true } },
          },
        },
        contact: true,
      },
    });
    if (!send || send.sentAt) return;
    const campaign = send.campaign;
    const lead = send.lead;
    if (!lead) return;

    const template = campaign.template;
    const abConfig = campaign.abConfig as
      | { variantA?: { subject?: string; bodyHtml?: string }; variantB?: { subject?: string; bodyHtml?: string } }
      | null
      | undefined;
    let subject = template.subject;
    let bodyHtml = template.bodyHtml ?? '';
    let bodyText = template.bodyText ?? null;
    if (abConfig && send.variant) {
      const variant = send.variant === 'A' ? abConfig.variantA : abConfig.variantB;
      if (variant?.subject) subject = variant.subject;
      if (variant?.bodyHtml) bodyHtml = variant.bodyHtml;
    }

    const vars = this.emailService.buildLeadVars({
      title: lead.title,
      organization: lead.organization ?? undefined,
      assignedTo: lead.assignedTo ?? undefined,
      nextStep: lead.nextStep,
      amount: lead.amount,
      currency: lead.currency,
      source: lead.source,
      primaryContact: lead.primaryContact ?? undefined,
      customFields: lead.customFields as Record<string, unknown> | null,
    });
    let listUnsubscribeUrl: string | undefined;
    if (send.contactId) {
      try {
        const token = await this.preferenceCenter.ensureUnsubscribeToken(send.contactId);
        listUnsubscribeUrl = this.preferenceCenter.getUnsubscribeUrl(token);
        vars.unsubscribeUrl = listUnsubscribeUrl;
        vars.preferenceCenterUrl = this.preferenceCenter.getPreferenceCenterUrl();
      } catch {
        // contact may have been deleted
      }
    }
    const rendered = this.emailService.renderTemplate(
      { subject, bodyHtml: bodyHtml ?? undefined, bodyText: bodyText ?? undefined },
      vars,
    );

    if (send.trackingToken) {
      const base = this.config.get('TRACKING_BASE_URL') || this.config.get('API_PUBLIC_URL') || 'http://localhost:3001';
      const pixelUrl = `${base.replace(/\/$/, '')}/api/v1/t/open/${send.trackingToken}`;
      rendered.html = (rendered.html || '') + `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none" />`;
    }

    const fromName = (campaign as { fromName?: string | null }).fromName ?? (template as { fromName?: string | null }).fromName;
    const fromEmail = (campaign as { fromEmail?: string | null }).fromEmail ?? (template as { fromEmail?: string | null }).fromEmail;
    const replyTo = (campaign as { replyTo?: string | null }).replyTo;
    const result = await this.emailService.send({
      to: send.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      listUnsubscribeUrl,
      ...(fromName && { fromName }),
      ...(fromEmail && { fromEmail }),
      ...(replyTo && { replyTo }),
    });

    await this.prisma.campaignSend.update({
      where: { id: campaignSendId },
      data: { sentAt: new Date(), messageId: result.messageId ?? undefined },
    });

    await this.prisma.activity.create({
      data: {
        leadId: lead.id,
        contactId: send.contactId ?? undefined,
        userId,
        type: 'email',
        subject: rendered.subject,
        body: rendered.text || rendered.html?.replace(/<[^>]*>/g, '') || null,
        outcome: 'sent',
        completedAt: new Date(),
        metadata: { campaignId: campaign.id, campaignSendId },
      },
    });
  }
}
