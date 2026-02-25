import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export type WebhookEvent = 'lead.created' | 'lead.updated' | 'lead.stage_changed' | 'campaign.sent' | 'form.submitted' | 'form.confirmed';

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

@Injectable()
export class WebhookOutboundService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async dispatch(event: WebhookEvent, data: Record<string, unknown>) {
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: { isActive: true, events: { has: event } },
    });
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };
    for (const sub of subscriptions) {
      await this.deliverWithRetry(sub.id, sub.url, sub.secret ?? undefined, event, payload);
    }
    this.notifySlack(event, data).catch(() => {});
  }

  private async notifySlack(event: WebhookEvent, data: Record<string, unknown>) {
    const url = this.config.get('SLACK_WEBHOOK_URL');
    if (!url) return;
    if (event !== 'lead.created' && event !== 'lead.stage_changed') return;
    const lead = data.lead as Record<string, unknown> | undefined;
    const title = lead?.title ?? (data.lead as Record<string, unknown>)?.title ?? 'Lead';
    const text =
      event === 'lead.created'
        ? `New lead: *${String(title)}*`
        : `Stage change: *${String(title)}* → ${String(data.toStageName ?? '')}`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }

  private async deliverWithRetry(
    subscriptionId: string,
    url: string,
    secret: string | undefined,
    event: string,
    payload: WebhookPayload,
  ) {
    const body = JSON.stringify(payload);
    let lastError: string | null = null;
    let lastStatusCode: number | null = null;
    let lastResponseBody: string | null = null;

    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'User-Agent': 'BitBlockIT-CRM-Webhook/1.0',
        };
        if (secret) {
          headers['X-Webhook-Signature'] = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
        }
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(15000),
        });
        lastStatusCode = res.status;
        lastResponseBody = await res.text().catch(() => null);
        const success = res.ok;
        await this.logDelivery(subscriptionId, event, success, res.status, lastResponseBody, null, retry);
        if (success) return;
        if (res.status < 500 && res.status >= 400) break; // don't retry 4xx
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        await this.logDelivery(subscriptionId, event, false, null, null, lastError, retry);
      }
      if (retry < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[retry]));
      }
    }
  }

  private async logDelivery(
    subscriptionId: string,
    event: string,
    success: boolean,
    statusCode: number | null,
    responseBody: string | null,
    error: string | null,
    retryCount: number,
  ) {
    await this.prisma.webhookDeliveryLog.create({
      data: {
        subscriptionId,
        event,
        success,
        statusCode,
        responseBody: responseBody?.slice(0, 2000) ?? undefined,
        error: error?.slice(0, 2000) ?? undefined,
        retryCount,
      },
    });
  }

  async findSubscriptions() {
    return this.prisma.webhookSubscription.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { deliveries: true } },
      },
    });
  }

  async createSubscription(data: { url: string; events: string[]; secret?: string | null }) {
    return this.prisma.webhookSubscription.create({
      data: {
        url: data.url,
        events: data.events,
        secret: data.secret ?? undefined,
      },
    });
  }

  async updateSubscription(id: string, data: { url?: string; events?: string[]; secret?: string | null; isActive?: boolean }) {
    return this.prisma.webhookSubscription.update({
      where: { id },
      data: {
        ...(data.url !== undefined && { url: data.url }),
        ...(data.events !== undefined && { events: data.events }),
        ...(data.secret !== undefined && { secret: data.secret ?? undefined }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async deleteSubscription(id: string) {
    await this.prisma.webhookSubscription.delete({ where: { id } });
    return { message: 'Deleted' };
  }

  async getDeliveryLogs(subscriptionId: string, limit = 50) {
    return this.prisma.webhookDeliveryLog.findMany({
      where: { subscriptionId },
      orderBy: { attemptedAt: 'desc' },
      take: limit,
    });
  }
}
