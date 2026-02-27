import { Controller, Post, Body, Headers, Req, Get, Patch, Delete, Param, UnauthorizedException, NotFoundException, BadRequestException, UseGuards } from '@nestjs/common';
import { createHmac } from 'crypto';
import { Request } from 'express';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WebhookLeadDto } from './dto/webhook-lead.dto';
import { CreateWebhookSubscriptionDto } from './dto/create-webhook-subscription.dto';
import { UpdateWebhookSubscriptionDto } from './dto/update-webhook-subscription.dto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { WebhookOutboundService } from './webhook-outbound.service';
import { WebhookLeadsLogService } from './webhook-leads-log.service';
import { ApolloQueueService } from '../apollo/apollo-queue.service';
import { LoggerService } from '../common/logger.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private webhookOutbound: WebhookOutboundService,
    private webhookLeadsLog: WebhookLeadsLogService,
    private apolloQueue: ApolloQueueService,
    private logger: LoggerService,
  ) {}

  @Public()
  @Post('leads')
  @ApiOperation({
    summary: 'Zapier/Make catch hook',
    description:
      'Create a lead from an external trigger (Zapier, Make, or any HTTP client). Send name, email, and optional company, phone, source, UTM params. If WEBHOOK_LEADS_SECRET is set, send it in the x-webhook-token header.',
  })
  @ApiBody({ type: WebhookLeadDto })
  @ApiHeader({ name: 'x-webhook-token', required: true, description: 'Must match WEBHOOK_LEADS_SECRET (required)' })
  @ApiResponse({ status: 201, description: 'Lead created' })
  @ApiResponse({ status: 401, description: 'Invalid webhook token' })
  async createLeadFromWebhook(
    @Body() dto: WebhookLeadDto,
    @Headers('x-webhook-token') token?: string,
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('x-real-ip') realIp?: string,
    @Req() req?: Request,
  ) {
    const secret = this.config.get('WEBHOOK_LEADS_SECRET');
    if (!secret?.trim()) {
      this.logger.warn('Webhook leads: WEBHOOK_LEADS_SECRET not configured', 'WebhooksController');
      throw new UnauthorizedException('Webhook leads endpoint requires WEBHOOK_LEADS_SECRET to be configured');
    }
    if (token !== secret) {
      this.logger.warn('Webhook leads: invalid or missing x-webhook-token', 'WebhooksController');
      throw new UnauthorizedException('Invalid webhook token');
    }
    const name = (dto.name ?? '').trim() || [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim();
    if (!name) {
      this.logger.warn('Webhook leads: missing name and firstName/lastName', 'WebhooksController');
      throw new BadRequestException(
        'Either "name" or both "firstName" and "lastName" are required. See docs/BITBLOCK_WEBSITE_LEAD_INTEGRATION_PROMPT.md',
      );
    }
    const defaultPipeline = await this.prisma.pipeline.findFirst({
      where: { isDefault: true },
      include: { stages: { orderBy: { order: 'asc' }, take: 1 } },
    });
    if (!defaultPipeline || !defaultPipeline.stages.length) {
      this.logger.error('Webhook leads: no default pipeline or stages configured', undefined, 'WebhooksController');
      throw new BadRequestException(
        'No default pipeline or stages configured in CRM. Add a pipeline and set one as default in Settings → Pipelines.',
      );
    }
    const firstStageId = defaultPipeline.stages[0].id;
    const [firstName, ...lastParts] = name.split(/\s+/);
    const lastName = lastParts.join(' ') || (dto.lastName ?? '') || 'Contact';

    let organizationId: string | null = null;
    if (dto.company) {
      const existing = await this.prisma.organization.findFirst({
        where: { name: { equals: dto.company, mode: 'insensitive' } },
      });
      if (existing) {
        organizationId = existing.id;
      } else {
        const org = await this.prisma.organization.create({
          data: { name: dto.company },
        });
        organizationId = org.id;
      }
    }

    let primaryContactId: string | null = null;
    const contactData = {
      organizationId,
      firstName: firstName || 'Unknown',
      lastName: lastName || 'Contact',
      email: dto.email,
      phone: dto.phone,
      isPrimary: true,
    };
    if (organizationId) {
      const contact = await this.prisma.contact.create({
        data: { ...contactData, organizationId },
      });
      primaryContactId = contact.id;
    } else {
      const org = await this.prisma.organization.create({
        data: { name: dto.company || 'Unknown' },
      });
      const contact = await this.prisma.contact.create({
        data: { ...contactData, organizationId: org.id },
      });
      organizationId = org.id;
      primaryContactId = contact.id;
    }

    const ip =
      dto.ip ??
      (typeof dto.custom?.ip === 'string' ? dto.custom.ip : undefined) ??
      realIp ??
      (forwardedFor ? forwardedFor.split(',')[0]?.trim() : undefined) ??
      (req?.socket?.remoteAddress ?? undefined);
    const userAgent =
      dto.user_agent ?? (typeof dto.custom?.user_agent === 'string' ? dto.custom.user_agent : undefined);
    const referrer =
      dto.referrer ?? (typeof dto.custom?.referrer === 'string' ? dto.custom.referrer : undefined);
    const geoSource =
      dto.geo && Object.keys(dto.geo).length > 0
        ? dto.geo
        : dto.custom?.geo && typeof dto.custom.geo === 'object' && !Array.isArray(dto.custom.geo) && Object.keys(dto.custom.geo as object).length > 0
          ? (dto.custom.geo as object)
          : undefined;
    const submissionMeta = geoSource ?? undefined;
    const customMerged =
      dto.message || (dto.custom && Object.keys(dto.custom).length > 0)
        ? { ...(dto.custom ?? {}), ...(dto.message ? { message: dto.message } : {}) }
        : undefined;
    const lead = await this.prisma.lead.create({
      data: {
        title: dto.company ? `${dto.company} - ${name}` : name,
        pipelineId: defaultPipeline.id,
        currentStageId: firstStageId,
        organizationId,
        primaryContactId,
        source: dto.source || 'Website',
        sourceDetail: 'Webhook',
        utmSource: dto.utm_source,
        utmMedium: dto.utm_medium,
        utmCampaign: dto.utm_campaign,
        ip: ip ?? undefined,
        userAgent: userAgent ?? undefined,
        referrer: referrer ?? undefined,
        submissionMeta,
        customFields: customMerged as object | undefined,
        status: 'new',
      },
      include: {
        currentStage: true,
        organization: true,
        primaryContact: true,
      },
    });

    if (dto.sequence_id?.trim()) {
      try {
        await this.prisma.sequenceEnrollment.create({
          data: {
            sequenceId: dto.sequence_id.trim(),
            leadId: lead.id,
            contactId: primaryContactId!,
            state: 'active',
          },
        });
        this.logger.log(`Webhook lead enrolled in sequence: ${dto.sequence_id}`, 'WebhooksController');
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
          // unique (sequenceId, leadId) - already enrolled
        } else {
          this.logger.warn(`Webhook lead: could not enroll in sequence ${dto.sequence_id}: ${String(err)}`, 'WebhooksController');
        }
      }
    }
    const tagIds = Array.isArray(dto.tag_ids) ? dto.tag_ids.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : [];
    if (tagIds.length > 0) {
      for (const tagId of tagIds) {
        try {
          await this.prisma.leadTag.upsert({
            where: { leadId_tagId: { leadId: lead.id, tagId } },
            create: { leadId: lead.id, tagId },
            update: {},
          });
        } catch {
          // tag may not exist; skip
        }
      }
    }

    this.webhookLeadsLog.record({
      timestamp: new Date().toISOString(),
      statusCode: 201,
      message: 'Lead created',
      details: [lead.id],
    });
    this.logger.log(`Webhook lead created: ${lead.id} (${dto.email})`, 'WebhooksController');

    const enrichInbound = this.config.get('APOLLO_ENRICH_INBOUND_LEADS');
    if (enrichInbound === 'true' || enrichInbound === '1') {
      this.apolloQueue.addEnrichJob(lead.id).catch((err) => {
        this.logger.warn(`Failed to queue Apollo enrich for lead ${lead.id}: ${err?.message}`, 'WebhooksController');
      });
    }

    return { data: lead, message: 'Lead created' };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('leads/last-attempt')
  @ApiOperation({ summary: 'Last webhook lead attempt (for debugging)' })
  getLastWebhookLeadAttempt() {
    const last = this.webhookLeadsLog.getLast();
    return { data: last ?? { message: 'No webhook lead attempt recorded yet.' } };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('subscriptions')
  async listSubscriptions() {
    const data = await this.webhookOutbound.findSubscriptions();
    return { data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('subscriptions')
  async createSubscription(@Body() dto: CreateWebhookSubscriptionDto) {
    const data = await this.webhookOutbound.createSubscription({
      url: dto.url,
      events: dto.events,
      secret: dto.secret ?? undefined,
    });
    return { data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('subscriptions/:id')
  async getSubscription(@Param('id') id: string) {
    const data = await this.prisma.webhookSubscription.findFirst({ where: { id } });
    if (!data) throw new NotFoundException('Subscription not found');
    return { data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Patch('subscriptions/:id')
  async updateSubscription(@Param('id') id: string, @Body() dto: UpdateWebhookSubscriptionDto) {
    const data = await this.webhookOutbound.updateSubscription(id, {
      url: dto.url,
      events: dto.events,
      secret: dto.secret,
      isActive: dto.isActive,
    });
    return { data };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Delete('subscriptions/:id')
  async deleteSubscription(@Param('id') id: string) {
    return this.webhookOutbound.deleteSubscription(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Get('subscriptions/:id/logs')
  async getSubscriptionLogs(@Param('id') id: string) {
    const data = await this.webhookOutbound.getDeliveryLogs(id);
    return { data };
  }

  @Public()
  @Post('billing')
  @ApiOperation({
    summary: 'Bitblock-billing webhook',
    description: 'Handles billing events: invoice.paid, invoice.overdue, subscription.cancelled, subscription.created, payment.failed, trial.ending',
  })
  async billingWebhook(
    @Body() payload: { event?: string; timestamp?: string; data?: Record<string, unknown> },
    @Headers('x-webhook-signature') signature?: string,
  ) {
    const secret = this.config.get('BILLING_WEBHOOK_SECRET');
    // Item 446: Constant-time comparison to prevent timing attacks
    if (secret?.trim() && signature) {
      const body = JSON.stringify(payload);
      const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
      const expected = createHmac('sha256', secret).update(body).digest('hex');
      // Constant-time comparison
      if (sig.length !== expected.length) throw new UnauthorizedException('Invalid webhook signature');
      let diff = 0;
      for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff !== 0) throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = payload?.event;
    const data = payload?.data ?? {};
    const billingCustomerId = data.customerId as string | undefined;

    this.logger.log(`Billing webhook received: ${event}`, 'WebhooksController');

    if (!billingCustomerId) return { received: true };

    const org = await this.prisma.organization.findFirst({
      where: { billingCustomerId },
      include: {
        leads: {
          where: { deletedAt: null, status: { not: 'won' } },
          include: { currentStage: true, pipeline: { include: { stages: true } } },
          orderBy: { updatedAt: 'desc' },
        },
      },
    });

    if (!org) return { received: true };

    if (event === 'invoice.paid') {
      await this.prisma.organization.update({ where: { id: org.id }, data: { type: 'customer' } });
      const wonStage = org.leads[0]?.pipeline?.stages?.find((s) => s.isWon);
      if (wonStage && org.leads.length > 0) {
        await this.prisma.lead.update({
          where: { id: org.leads[0].id },
          data: { currentStageId: wonStage.id, status: 'won', closedAt: new Date() },
        });
        this.logger.log(`Billing: marked lead ${org.leads[0].id} as won`, 'WebhooksController');
      }
      // Item 342: Create billing activity
      try {
        await this.prisma.activity.create({
          data: {
            leadId: org.leads[0]?.id ?? undefined,
            typeId: await this.getOrCreateActivityTypeId('billing_event'),
            subject: `Invoice paid — $${((data.amount as number ?? 0) / 100).toFixed(2)}`,
            status: 'completed',
            completedAt: new Date(),
          } as Parameters<typeof this.prisma.activity.create>[0]['data'],
        });
      } catch { /* activity type may not exist */ }
    }

    // Item 338: invoice.overdue → create follow-up activity
    if (event === 'invoice.overdue') {
      try {
        await this.prisma.activity.create({
          data: {
            leadId: org.leads[0]?.id ?? undefined,
            typeId: await this.getOrCreateActivityTypeId('billing_event'),
            subject: `Invoice overdue — follow up required`,
            dueDate: new Date(),
            status: 'pending',
          } as Parameters<typeof this.prisma.activity.create>[0]['data'],
        });
        this.logger.log(`Billing: created overdue follow-up activity for org ${org.id}`, 'WebhooksController');
      } catch (err) {
        this.logger.warn(`Could not create activity: ${err}`, 'WebhooksController');
      }
    }

    // Item 339: subscription.cancelled → update org, alert sales rep
    if (event === 'subscription.cancelled') {
      await this.prisma.organization.update({ where: { id: org.id }, data: { type: 'prospect' } });
      try {
        await this.prisma.inAppNotification.create({
          data: {
            message: `Subscription cancelled for ${org.name}`,
            userId: org.leads[0]?.assignedToId ?? undefined,
            resourceType: 'organization',
            resourceId: org.id,
          } as Parameters<typeof this.prisma.inAppNotification.create>[0]['data'],
        });
      } catch { /* field may differ */ }
    }

    // Item 341: payment.failed → in-app notification
    if (event === 'payment.failed') {
      try {
        await this.prisma.inAppNotification.create({
          data: {
            message: `Payment failed for ${org.name} — action required`,
            userId: org.leads[0]?.assignedToId ?? undefined,
            resourceType: 'organization',
            resourceId: org.id,
          } as Parameters<typeof this.prisma.inAppNotification.create>[0]['data'],
        });
      } catch { /* best effort */ }
    }

    // Item 342: subscription.created → log activity
    if (event === 'subscription.created') {
      try {
        await this.prisma.activity.create({
          data: {
            leadId: org.leads[0]?.id ?? undefined,
            typeId: await this.getOrCreateActivityTypeId('billing_event'),
            subject: `Subscription created`,
            status: 'completed',
            completedAt: new Date(),
          } as Parameters<typeof this.prisma.activity.create>[0]['data'],
        });
      } catch { /* best effort */ }
    }

    return { received: true };
  }

  private async getOrCreateActivityTypeId(name: string): Promise<string> {
    const type = await this.prisma.activityType.findFirst({ where: { name } });
    if (type) return type.id;
    const created = await this.prisma.activityType.create({ data: { name, color: '#6366f1', icon: 'billing' } });
    return created.id;
  }
}
