import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SegmentsService } from '../segments/segments.service';
import { CampaignQueueService } from './campaign-queue.service';
import { WebhookOutboundService } from '../webhooks/webhook-outbound.service';
import { Prisma } from '@prisma/client';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private segmentsService: SegmentsService,
    private queue: CampaignQueueService,
    private webhookOutbound: WebhookOutboundService,
    private config: ConfigService,
  ) {}

  async findAll() {
    return this.prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        segment: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
        _count: { select: { sends: true } },
      },
    });
  }

  async findOne(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        segment: true,
        template: true,
        sends: { take: 100, orderBy: { sentAt: 'desc' } },
        _count: { select: { sends: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    const [openCount, clickCount] = await Promise.all([
      this.prisma.emailTrackingEvent.count({ where: { campaignSend: { campaignId: id }, type: 'open' } }),
      this.prisma.emailTrackingEvent.count({ where: { campaignSend: { campaignId: id }, type: 'click' } }),
    ]);
    return { ...campaign, openCount, clickCount };
  }

  async create(dto: CreateCampaignDto) {
    await this.prisma.segment.findUniqueOrThrow({ where: { id: dto.segmentId } });
    await this.prisma.emailTemplate.findUniqueOrThrow({ where: { id: dto.templateId } });
    const status = dto.scheduledAt ? 'scheduled' : 'draft';
    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        segmentId: dto.segmentId,
        templateId: dto.templateId,
        channel: dto.channel ?? 'email',
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status,
        abConfig: dto.abConfig as object | undefined,
        scheduleConfig: dto.scheduleConfig as object | undefined,
        fromName: dto.fromName ?? null,
        fromEmail: dto.fromEmail ?? null,
        replyTo: dto.replyTo ?? null,
      },
      include: {
        segment: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
    });
  }

  async update(id: string, dto: UpdateCampaignDto) {
    const campaign = await this.findOne(id);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      throw new BadRequestException('Can only edit draft or scheduled campaigns');
    }
    const data: { name?: string; segmentId?: string; templateId?: string; channel?: string; scheduledAt?: Date | null; status?: string; abConfig?: object; scheduleConfig?: object | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.segmentId !== undefined) data.segmentId = dto.segmentId;
    if (dto.templateId !== undefined) data.templateId = dto.templateId;
    if (dto.channel !== undefined) data.channel = dto.channel;
    if (dto.scheduledAt !== undefined) {
      data.scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
      data.status = dto.scheduledAt ? 'scheduled' : 'draft';
    }
    if (dto.abConfig !== undefined) data.abConfig = dto.abConfig as object;
    if (dto.scheduleConfig !== undefined) data.scheduleConfig = dto.scheduleConfig as object | null;
    return this.prisma.campaign.update({
      where: { id },
      data: data as Prisma.CampaignUpdateInput,
      include: {
        segment: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
    });
  }

  async remove(id: string) {
    const campaign = await this.findOne(id);
    if (campaign.status === 'sending' || campaign.status === 'sent') {
      throw new BadRequestException('Cannot delete a campaign that has been sent or is sending');
    }
    await this.prisma.campaign.delete({ where: { id } });
    return { message: 'Campaign deleted' };
  }

  /** True if current time in the given timezone is within [start, end] (HH:mm 24h). */
  private isWithinSendWindow(window: { start: string; end: string; timezone: string }): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: window.timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const pad = (s: string) => s.replace(':', '').padStart(4, '0');
      const current = pad(formatter.format(now)); // "1430"
      const start = pad(window.start);
      const end = pad(window.end);
      return current >= start && current <= end;
    } catch {
      return true; // invalid TZ: allow send
    }
  }

  async sendNow(campaignId: string, userId: string) {
    const campaign = await this.findOne(campaignId);
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Only draft campaigns can be sent immediately');
    }
    const scheduleConfig = campaign.scheduleConfig as { sendWindow?: { start: string; end: string; timezone: string } } | null | undefined;
    if (scheduleConfig?.sendWindow && !this.isWithinSendWindow(scheduleConfig.sendWindow)) {
      throw new BadRequestException(
        'Send is only allowed during the configured time window. Current time is outside the window.',
      );
    }
    let recipients = await this.segmentsService.resolveRecipients(campaign.segmentId);
    const maxEmailsPerDay = this.config.get<number>('EMAIL_MAX_PER_CONTACT_PER_DAY');
    if (maxEmailsPerDay != null && maxEmailsPerDay > 0 && recipients.length > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sentCounts = await this.prisma.campaignSend.groupBy({
        by: ['contactId'],
        where: { contactId: { in: recipients.map((r) => r.contactId) }, sentAt: { gte: since } },
        _count: { id: true },
      });
      const overLimit = new Set(
        sentCounts.filter((c) => (c._count.id >= maxEmailsPerDay)).map((c) => c.contactId as string),
      );
      recipients = recipients.filter((r) => !overLimit.has(r.contactId));
    }
    const suppression = await this.prisma.suppressionEntry.findMany({ select: { type: true, value: true } });
    if (suppression.length > 0) {
      const blockedEmails = new Set(suppression.filter((s) => s.type === 'email').map((s) => s.value.toLowerCase()));
      const blockedDomains = new Set(suppression.filter((s) => s.type === 'domain').map((s) => s.value.toLowerCase()));
      recipients = recipients.filter((r) => {
        const emailLower = r.email.toLowerCase();
        if (blockedEmails.has(emailLower)) return false;
        const domain = emailLower.split('@')[1];
        if (domain && blockedDomains.has(domain)) return false;
        return true;
      });
    }
    if (recipients.length === 0) {
      throw new BadRequestException('Segment has no recipients (or all are over email frequency limit or on suppression list)');
    }
    const abConfig = campaign.abConfig as
      | { splitPercent?: number }
      | null
      | undefined;
    const splitPercent = abConfig?.splitPercent ?? 0;
    const variantACount =
      splitPercent > 0 ? Math.ceil(recipients.length * (splitPercent / 100)) : 0;

    const sends: { leadId: string; contactId: string; email: string; variant: string | null }[] = recipients.map(
      (r, i) => ({
        leadId: r.leadId,
        contactId: r.contactId,
        email: r.email,
        variant:
          variantACount > 0 ? (i < variantACount ? 'A' : 'B') : null,
      }),
    );

    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'sending', sentAt: new Date() },
    });

    const created: { id: string; trackingToken: string | null }[] = [];
    for (const s of sends) {
      const token = randomBytes(16).toString('hex');
      const c = await this.prisma.campaignSend.create({
        data: {
          campaignId,
          leadId: s.leadId,
          contactId: s.contactId,
          email: s.email,
          variant: s.variant,
          trackingToken: token,
        },
      });
      created.push(c);
    }

    await this.queue.addSendJobs(
      created.map((c) => ({ campaignSendId: c.id, userId })),
    );

    return {
      message: 'Campaign send started',
      recipientCount: created.length,
    };
  }

  async schedule(campaignId: string, scheduledAt: string, userId: string) {
    const campaign = await this.findOne(campaignId);
    if (campaign.status !== 'draft') {
      throw new BadRequestException('Only draft campaigns can be scheduled');
    }
    const at = new Date(scheduledAt);
    if (at <= new Date()) {
      throw new BadRequestException('Scheduled time must be in the future');
    }
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'scheduled', scheduledAt: at },
    });
    return { message: 'Campaign scheduled', scheduledAt: at.toISOString() };
  }

  /** Called by cron: process campaigns that are scheduled and due */
  async processScheduledCampaigns(userId: string) {
    const now = new Date();
    const due = await this.prisma.campaign.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: now } },
    });
    for (const c of due) {
      const scheduleConfig = c.scheduleConfig as { sendWindow?: { start: string; end: string; timezone: string } } | null | undefined;
      if (scheduleConfig?.sendWindow && !this.isWithinSendWindow(scheduleConfig.sendWindow)) {
        continue; // wait until next cron run when we're inside the send window
      }
      try {
        await this.sendNow(c.id, userId);
      } catch (e) {
        console.error(`Failed to send scheduled campaign ${c.id}:`, e);
      }
    }
  }

  /** Called by cron: mark campaigns as 'sent' when all sends have completed */
  async finalizeSendingCampaigns() {
    const sending = await this.prisma.campaign.findMany({
      where: { status: 'sending' },
      include: { segment: { select: { id: true, name: true } }, sends: { select: { id: true, sentAt: true } } },
    });
    for (const c of sending) {
      const allSent = c.sends.length > 0 && c.sends.every((s) => s.sentAt != null);
      if (allSent) {
        await this.prisma.campaign.update({
          where: { id: c.id },
          data: { status: 'sent' },
        });
        this.webhookOutbound
          .dispatch('campaign.sent', {
            campaignId: c.id,
            campaignName: c.name,
            segmentId: c.segment.id,
            segmentName: c.segment.name,
            recipientCount: c.sends.length,
            sentAt: new Date().toISOString(),
          })
          .catch((err) => console.error('Webhook campaign.sent failed:', err));
      }
    }
  }

  /** Clone campaign as new draft with same segment, template, and settings */
  async clone(campaignId: string) {
    const campaign = await this.findOne(campaignId);
    if (campaign.status !== 'draft' && campaign.status !== 'scheduled' && campaign.status !== 'sent') {
      throw new BadRequestException('Can only clone draft, scheduled, or sent campaigns');
    }
    return this.prisma.campaign.create({
      data: {
        name: `Copy of ${campaign.name}`,
        segmentId: campaign.segmentId,
        templateId: campaign.templateId,
        channel: (campaign as { channel?: string }).channel ?? 'email',
        status: 'draft',
        scheduledAt: null,
        sentAt: null,
        abConfig: campaign.abConfig as object ?? undefined,
        scheduleConfig: (campaign as { scheduleConfig?: object }).scheduleConfig ?? undefined,
        fromName: (campaign as { fromName?: string | null }).fromName ?? undefined,
        fromEmail: (campaign as { fromEmail?: string | null }).fromEmail ?? undefined,
        replyTo: (campaign as { replyTo?: string | null }).replyTo ?? undefined,
      },
      include: {
        segment: { select: { id: true, name: true } },
        template: { select: { id: true, name: true } },
      },
    });
  }

  /** A/B summary: sent/open counts per variant and suggested winner by open rate */
  async getAbSummary(campaignId: string) {
    const campaign = await this.findOne(campaignId);
    const abConfig = campaign.abConfig as { splitPercent?: number; winner?: string } | null | undefined;
    if (!abConfig?.splitPercent) {
      return { data: { hasAb: false } };
    }
    const sends = await this.prisma.campaignSend.findMany({
      where: { campaignId, sentAt: { not: null } },
      select: { id: true, variant: true },
    });
    const openIds = new Set(
      (
        await this.prisma.emailTrackingEvent.findMany({
          where: { campaignSendId: { in: sends.map((s) => s.id) }, type: 'open' },
          select: { campaignSendId: true },
        })
      ).map((e) => e.campaignSendId),
    );
    const a = sends.filter((s) => s.variant === 'A');
    const b = sends.filter((s) => s.variant === 'B');
    const aOpened = a.filter((s) => openIds.has(s.id)).length;
    const bOpened = b.filter((s) => openIds.has(s.id)).length;
    const aOpenRate = a.length ? Math.round((aOpened / a.length) * 100) : 0;
    const bOpenRate = b.length ? Math.round((bOpened / b.length) * 100) : 0;
    const winner = aOpenRate >= bOpenRate ? 'A' : 'B';
    return {
      data: {
        hasAb: true,
        variantA: { sent: a.length, opened: aOpened, openRate: aOpenRate },
        variantB: { sent: b.length, opened: bOpened, openRate: bOpenRate },
        winner,
        appliedWinner: abConfig.winner ?? null,
      },
    };
  }

  /** Set A/B winner on campaign (by open rate); used before send-remainder */
  async applyAbWinner(campaignId: string) {
    const campaign = await this.findOne(campaignId);
    if (campaign.status !== 'sent') {
      throw new BadRequestException('Only sent campaigns can have winner applied');
    }
    const summary = await this.getAbSummary(campaignId);
    const winner = (summary.data as { winner?: string }).winner;
    if (!winner) {
      throw new BadRequestException('Campaign has no A/B test');
    }
    const abConfig = (campaign.abConfig as Record<string, unknown>) ?? {};
    abConfig.winner = winner;
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { abConfig: abConfig as Prisma.InputJsonValue },
    });
    return { data: { winner } };
  }

  /** Send winning variant to non-openers (recipients who received the losing variant and did not open) */
  async sendRemainderToNonOpeners(campaignId: string, userId: string) {
    const campaign = await this.findOne(campaignId);
    if (campaign.status !== 'sent') {
      throw new BadRequestException('Only sent campaigns can send remainder');
    }
    const abConfig = campaign.abConfig as { splitPercent?: number; winner?: string } | null | undefined;
    const winner = abConfig?.winner;
    if (!winner) {
      throw new BadRequestException('Apply A/B winner first (POST /campaigns/:id/apply-ab-winner)');
    }
    const loser = winner === 'A' ? 'B' : 'A';
    const sends = await this.prisma.campaignSend.findMany({
      where: { campaignId, variant: loser, sentAt: { not: null } },
      include: { contact: true, lead: true },
    });
    const openSendIds = new Set(
      (
        await this.prisma.emailTrackingEvent.findMany({
          where: { campaignSendId: { in: sends.map((s) => s.id) }, type: 'open' },
          select: { campaignSendId: true },
        })
      ).map((e) => e.campaignSendId),
    );
    const nonOpeners = sends.filter((s) => !openSendIds.has(s.id));
    if (nonOpeners.length === 0) {
      return { message: 'No remainder to send', recipientCount: 0 };
    }
    const created: { id: string; trackingToken: string }[] = [];
    for (const s of nonOpeners) {
      const token = randomBytes(16).toString('hex');
      const c = await this.prisma.campaignSend.create({
        data: {
          campaignId,
          leadId: s.leadId,
          contactId: s.contactId,
          email: s.email,
          variant: winner,
          trackingToken: token,
        },
      });
      created.push({ id: c.id, trackingToken: token });
    }
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'sending' },
    });
    await this.queue.addSendJobs(created.map((c) => ({ campaignSendId: c.id, userId })));
    return { message: 'Remainder send started', recipientCount: created.length };
  }

  /** Export campaign send log (recipients, sent at, variant, opened, clicked) as JSON or CSV */
  async getSendLog(campaignId: string, format: 'json' | 'csv' = 'json') {
    const campaign = await this.findOne(campaignId);
    const sends = await this.prisma.campaignSend.findMany({
      where: { campaignId },
      orderBy: { sentAt: 'asc' },
      include: {
        trackingEvents: { select: { type: true } },
      },
    });
    const openIds = new Set(
      sends.flatMap((s) => (s.trackingEvents.some((e) => e.type === 'open') ? [s.id] : [])),
    );
    const clickIds = new Set(
      sends.flatMap((s) => (s.trackingEvents.some((e) => e.type === 'click') ? [s.id] : [])),
    );
    const rows = sends.map((s) => ({
      email: s.email,
      sentAt: s.sentAt?.toISOString() ?? '',
      variant: s.variant ?? '',
      opened: openIds.has(s.id),
      clicked: clickIds.has(s.id),
    }));
    if (format === 'csv') {
      const headers = ['email', 'sentAt', 'variant', 'opened', 'clicked'];
      const lines = [
        headers.join(','),
        ...rows.map((r) =>
          [r.email, r.sentAt, r.variant, r.opened ? 'yes' : 'no', r.clicked ? 'yes' : 'no']
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(','),
        ),
      ];
      return { data: lines.join('\n'), contentType: 'text/csv' };
    }
    return { data: { campaignName: campaign.name, sends: rows } };
  }

  /** Link tracking report: which links were clicked, click count, and by whom (email, clickedAt) */
  async getLinkClicks(campaignId: string) {
    const campaign = await this.findOne(campaignId);
    const links = await this.prisma.trackingLink.findMany({
      where: { campaignSend: { campaignId } },
      include: {
        campaignSend: { select: { id: true, email: true, contactId: true } },
        events: {
          where: { type: 'click' },
          orderBy: { createdAt: 'asc' },
          include: { campaignSend: { select: { email: true, contactId: true } } },
        },
      },
    });
    const byUrl = new Map<string, { url: string; clickCount: number; clicks: { email: string; contactId: string | null; clickedAt: string }[] }>();
    for (const link of links) {
      const key = link.url;
      if (!byUrl.has(key)) {
        byUrl.set(key, { url: key, clickCount: 0, clicks: [] });
      }
      const entry = byUrl.get(key)!;
      for (const ev of link.events) {
        entry.clickCount += 1;
        entry.clicks.push({
          email: ev.campaignSend?.email ?? '',
          contactId: ev.campaignSend?.contactId ?? null,
          clickedAt: ev.createdAt.toISOString(),
        });
      }
    }
    const linksArray = Array.from(byUrl.values()).sort((a, b) => b.clickCount - a.clickCount);
    return { data: { campaignName: campaign.name, links: linksArray } };
  }

  /** Failed sends for a campaign (failedAt and lastError set after job retries exhausted) */
  async getFailedSends(campaignId: string) {
    await this.findOne(campaignId);
    const sends = await this.prisma.campaignSend.findMany({
      where: { campaignId, failedAt: { not: null } },
      orderBy: { failedAt: 'desc' },
      select: { id: true, email: true, variant: true, failedAt: true, lastError: true },
    });
    return { data: sends };
  }
}
