import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

function parseDeviceType(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad|ipod|webos|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  if (/tablet|ipad/i.test(ua)) return 'tablet';
  return 'desktop';
}

@Injectable()
export class TrackingPageEventService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async recordPageView(data: {
    visitorId: string;
    contactId?: string;
    leadId?: string;
    url: string;
    title?: string;
    referrer?: string;
    userAgent?: string;
    ip?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  }) {
    const deviceType = parseDeviceType(data.userAgent);
    let geo: Record<string, unknown> | null = null;
    if (data.ip && data.ip !== '::1' && data.ip !== '127.0.0.1') {
      try {
        const res = await fetch(`https://ipapi.co/${data.ip}/json/`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const j = (await res.json()) as Record<string, unknown>;
          geo = {
            city: j.city,
            region: j.region,
            country: j.country_code ?? j.country,
            timezone: j.timezone,
          };
        }
      } catch {
        // ignore geo failure
      }
    }
    return this.prisma.pageView.create({
      data: {
        visitorId: data.visitorId,
        contactId: data.contactId ?? undefined,
        leadId: data.leadId ?? undefined,
        url: data.url,
        title: data.title ?? undefined,
        referrer: data.referrer ?? undefined,
        userAgent: data.userAgent ?? undefined,
        deviceType,
        ip: data.ip ?? undefined,
        geo: geo as object ?? undefined,
        utmSource: data.utmSource ?? undefined,
        utmMedium: data.utmMedium ?? undefined,
        utmCampaign: data.utmCampaign ?? undefined,
      },
    });
  }

  async recordEvent(data: {
    visitorId: string;
    contactId?: string;
    leadId?: string;
    name: string;
    properties?: Record<string, unknown>;
  }) {
    return this.prisma.visitorEvent.create({
      data: {
        visitorId: data.visitorId,
        contactId: data.contactId ?? undefined,
        leadId: data.leadId ?? undefined,
        name: data.name,
        properties: (data.properties as object) ?? undefined,
      },
    });
  }

  /** Link visitor to contact/lead (e.g. after form submit); update existing page_views and visitor_events */
  async identifyVisitor(visitorId: string, contactId: string, leadId?: string) {
    await Promise.all([
      this.prisma.pageView.updateMany({
        where: { visitorId },
        data: { contactId, leadId: leadId ?? undefined },
      }),
      this.prisma.visitorEvent.updateMany({
        where: { visitorId },
        data: { contactId, leadId: leadId ?? undefined },
      }),
    ]);
  }
}
