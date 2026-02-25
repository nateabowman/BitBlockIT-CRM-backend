import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private isTokenExpired(sentAt: Date | null): boolean {
    if (!sentAt) return false;
    const days = this.config.get<number>('TRACKING_TOKEN_EXPIRY_DAYS');
    if (days == null || days <= 0) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return sentAt < cutoff;
  }

  async recordOpen(trackingToken: string, _ip?: string): Promise<boolean> {
    const send = await this.prisma.campaignSend.findFirst({
      where: { trackingToken },
      select: { id: true, contactId: true, leadId: true, sentAt: true },
    });
    if (!send) return false;
    if (this.isTokenExpired(send.sentAt)) return true;
    const existing = await this.prisma.emailTrackingEvent.findFirst({
      where: { campaignSendId: send.id, type: 'open' },
    });
    if (existing) return true;
    await this.prisma.emailTrackingEvent.create({
      data: {
        type: 'open',
        campaignSendId: send.id,
        contactId: send.contactId ?? undefined,
        leadId: send.leadId ?? undefined,
      },
    });
    return true;
  }

  async recordClick(linkId: string, _ip?: string): Promise<string | null> {
    const link = await this.prisma.trackingLink.findUnique({
      where: { id: linkId },
      include: { campaignSend: { select: { contactId: true, leadId: true, sentAt: true } } },
    });
    if (!link) return null;
    if (this.isTokenExpired(link.campaignSend?.sentAt ?? null)) return link.url;
    await this.prisma.emailTrackingEvent.create({
      data: {
        type: 'click',
        campaignSendId: link.campaignSendId,
        trackingLinkId: link.id,
        contactId: link.campaignSend.contactId ?? undefined,
        leadId: link.campaignSend.leadId ?? undefined,
      },
    });
    return link.url;
  }
}
