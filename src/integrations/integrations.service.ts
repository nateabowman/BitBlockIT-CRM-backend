import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type IntegrationConfig = {
  slack?: { webhookUrl?: string; enabled: boolean; events: string[] };
  calendly?: { username?: string; url?: string };
  docusign?: { enabled: boolean; templateId?: string };
  stripe?: { publishableKey?: string; paymentLinkPrefix?: string };
  zapier?: { webhookUrl?: string; enabled: boolean };
};

const SETTINGS_KEY = '_integrations_config';

@Injectable()
export class IntegrationsService {
  constructor(private prisma: PrismaService) {}

  private async getConfig(): Promise<IntegrationConfig> {
    const setting = await this.prisma.optionList.findFirst({
      where: { type: '_settings', value: SETTINGS_KEY },
    });
    if (!setting?.label) return {};
    try { return JSON.parse(setting.label); } catch { return {}; }
  }

  private async saveConfig(config: IntegrationConfig) {
    await this.prisma.optionList.upsert({
      where: { type__value: { type: '_settings', value: SETTINGS_KEY } },
      update: { label: JSON.stringify(config) },
      create: { type: '_settings', value: SETTINGS_KEY, label: JSON.stringify(config), order: 0 },
    });
  }

  async getAll() {
    return this.getConfig();
  }

  async update(section: keyof IntegrationConfig, data: Record<string, unknown>) {
    const config = await this.getConfig();
    config[section] = { ...(config[section] ?? {} as Record<string, unknown>), ...data } as IntegrationConfig[typeof section];
    await this.saveConfig(config);
    return config[section];
  }

  async testSlack(webhookUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '✅ BitBlockIT CRM: Slack integration connected successfully!',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '✅ *BitBlockIT CRM* — Slack integration is now active! You\'ll receive notifications here for important CRM events.',
              },
            },
          ],
        }),
      });
      if (res.ok) return { ok: true, message: 'Test message sent successfully' };
      return { ok: false, message: `Slack returned ${res.status}: ${res.statusText}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Connection failed' };
    }
  }

  async sendSlackNotification(event: {
    type: string;
    title: string;
    description?: string;
    url?: string;
    emoji?: string;
    color?: string;
  }) {
    const config = await this.getConfig();
    if (!config.slack?.enabled || !config.slack.webhookUrl) return;
    if (config.slack.events?.length > 0 && !config.slack.events.includes(event.type)) return;

    const emoji = event.emoji ?? '🔔';
    const payload = {
      text: `${emoji} ${event.title}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${emoji} *${event.title}*${event.description ? `\n${event.description}` : ''}`,
          },
          ...(event.url ? {
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'View in CRM' },
              url: event.url,
            },
          } : {}),
        },
      ],
    };

    await fetch(config.slack.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }
}
