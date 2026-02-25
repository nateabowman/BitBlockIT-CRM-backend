import { Controller, Post, Body, Get, Req, Res, Headers } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { TrackingPageEventService } from './tracking-page-event.service';
import { TrackPageDto } from './dto/track-page.dto';
import { TrackEventDto } from './dto/track-event.dto';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

function getClientIp(req: Request): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0]?.trim();
  if (Array.isArray(xff) && xff[0]) return String(xff[0]).split(',')[0]?.trim();
  return req.socket?.remoteAddress;
}

@Controller('tracking')
@Public()
export class TrackingPageEventController {
  constructor(
    private tracking: TrackingPageEventService,
    private config: ConfigService,
  ) {}

  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @Post('page')
  async page(@Body() dto: TrackPageDto, @Req() req: Request) {
    const ip = getClientIp(req);
    const userAgent = req.headers['user-agent'];
    await this.tracking.recordPageView({
      visitorId: dto.visitorId,
      contactId: dto.contactId,
      leadId: dto.leadId,
      url: dto.url,
      title: dto.title,
      referrer: dto.referrer,
      userAgent: userAgent ?? dto.userAgent,
      ip,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
    });
    return { ok: true };
  }

  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @Post('event')
  async event(@Body() dto: TrackEventDto) {
    await this.tracking.recordEvent({
      visitorId: dto.visitorId,
      contactId: dto.contactId,
      leadId: dto.leadId,
      name: dto.name,
      properties: dto.properties,
    });
    return { ok: true };
  }

  @Get('script.js')
  async script(@Res() res: Response, @Headers('host') host: string | undefined) {
    const base = this.config.get('API_PUBLIC_URL') || (host ? `https://${host}` : 'http://localhost:3001');
    const apiBase = `${base.replace(/\/$/, '')}/api/v1`;
    const script = `(function(){
  var api = "${apiBase}";
  var key = "bb_visitor_id";
  function id() {
    var v = document.cookie.match(new RegExp("(?:^|;\\\\s*)" + key + "=([^;]*)"));
    if (v) return v[1];
    v = "v_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
    document.cookie = key + "=" + v + "; path=/; max-age=63072000; SameSite=Lax";
    return v;
  }
  function send(method, path, body) {
    var x = new XMLHttpRequest();
    x.open(method, api + path);
    x.setRequestHeader("Content-Type", "application/json");
    x.send(JSON.stringify(body));
  }
  window.bbTrackPage = function(url, title) {
    send("POST", "/tracking/page", {
      visitorId: id(),
      url: url || location.href,
      title: title || document.title,
      referrer: document.referrer || undefined,
      utmSource: (new URLSearchParams(location.search)).get("utm_source") || undefined,
      utmMedium: (new URLSearchParams(location.search)).get("utm_medium") || undefined,
      utmCampaign: (new URLSearchParams(location.search)).get("utm_campaign") || undefined
    });
  };
  window.bbTrackEvent = function(name, properties) {
    send("POST", "/tracking/event", { visitorId: id(), name: name, properties: properties || {} });
  };
  if (typeof window !== "undefined") window.bbTrackPage();
})();
`;
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(script);
  }
}
