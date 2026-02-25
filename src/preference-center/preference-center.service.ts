import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { randomBytes } from 'crypto';

@Injectable()
export class PreferenceCenterService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  /** Find contact by email for public preference center (no auth) */
  async findByEmail(email: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        unsubscribedAt: true,
        preferenceCenterFrequency: true,
        topicPreferences: true,
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return {
      ...contact,
      topicPreferences: (contact.topicPreferences as Record<string, unknown>) ?? {},
    };
  }

  /** Update preferences (frequency, topic preferences); does not change unsubscribe */
  async updatePreferences(email: string, data: { frequency?: string; topicPreferences?: Record<string, unknown> }) {
    const contact = await this.prisma.contact.findFirst({
      where: { email: email.trim().toLowerCase() },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(data.frequency !== undefined && { preferenceCenterFrequency: data.frequency || null }),
        ...(data.topicPreferences !== undefined && { topicPreferences: data.topicPreferences as object }),
      },
    });
    return { success: true };
  }

  /** Unsubscribe by email (e.g. from preference center form) */
  async unsubscribeByEmail(email: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { email: email.trim().toLowerCase() },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    await this.prisma.contact.update({
      where: { id: contact.id },
      data: { unsubscribedAt: new Date() },
    });
    return { success: true, unsubscribed: true };
  }

  /** One-click unsubscribe by token (no email required) */
  async unsubscribeByToken(token: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { unsubscribeToken: token },
    });
    if (!contact) throw new NotFoundException('Invalid or expired link');
    await this.prisma.contact.update({
      where: { id: contact.id },
      data: { unsubscribedAt: new Date() },
    });
    return { success: true, unsubscribed: true };
  }

  /** Ensure contact has an unsubscribe token; return token */
  async ensureUnsubscribeToken(contactId: string): Promise<string> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { unsubscribeToken: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (contact.unsubscribeToken) return contact.unsubscribeToken;
    const token = randomBytes(24).toString('hex');
    await this.prisma.contact.update({
      where: { id: contactId },
      data: { unsubscribeToken: token },
    });
    return token;
  }

  /** Build one-click unsubscribe URL for a contact (must point to API so backend can verify token) */
  getUnsubscribeUrl(token: string): string {
    const base = this.config.get('API_PUBLIC_URL') || this.config.get('FRONTEND_URL') || 'http://localhost:3001';
    return `${base.replace(/\/$/, '')}/api/v1/preference/unsubscribe/${token}`;
  }

  /** Preference center URL for email footer */
  getPreferenceCenterUrl(): string {
    const url = this.config.get('PREFERENCE_CENTER_URL');
    if (url) return url;
    return `${this.getFrontendBaseUrl()}/preference`;
  }

  getFrontendBaseUrl(): string {
    return (this.config.get('FRONTEND_URL') || this.config.get('API_PUBLIC_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
  }
}
